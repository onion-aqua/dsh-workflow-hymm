import { win32 } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import type { KvTable } from '@deepseek-ai/dsh-storage-domain';

/** Exact pre-commit failure from rc.3 JSON's same-directory UUID temp rename. */
export function isWorkflowRenameBeforeCommit(error:unknown,platform:NodeJS.Platform=process.platform):boolean{
  if(platform!=='win32'||!(error instanceof Error))return false;
  const failure=error as NodeJS.ErrnoException & {dest?:unknown};
  if(!['EPERM','EACCES','EBUSY'].includes(failure.code??'')||failure.syscall!=='rename'||typeof failure.path!=='string'||typeof failure.dest!=='string')return false;
  if(!win32.isAbsolute(failure.path)||!win32.isAbsolute(failure.dest)||win32.basename(failure.dest)!=='visual_workflow.json')return false;
  if(!/^\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i.test(win32.basename(failure.path)))return false;
  return win32.normalize(win32.dirname(failure.path)).toLowerCase()===win32.normalize(win32.dirname(failure.dest)).toLowerCase();
}

/**
 * Only retries an uncommitted Workflow metadata transform, never a native
 * action. rc.3 JSON putRecord rolls back on this rename error, and Domain's
 * table publishes its value only after putRecord succeeds. Both the caller
 * and the next table queue slot must still observe the original revision.
 */
export async function updateWorkflowMetadata<T extends {revision:number}>(
  table:Pick<KvTable<string,T>,'get'|'update'>,id:string,transform:(current:T)=>T,
  options:{platform?:NodeJS.Platform;wait?:(milliseconds:number)=>Promise<void>}={},
):Promise<T>{
  let baseline:number|undefined,lastFailure:unknown;
  for(let attempt=0;;attempt++){
    try{
      return await table.update(id,current=>{
        if(baseline!==undefined&&current.revision!==baseline)throw lastFailure;
        baseline=current.revision;
        return transform(current);
      });
    }catch(error){
      if(attempt>=2||baseline===undefined||!isWorkflowRenameBeforeCommit(error,options.platform)||table.get(id)?.revision!==baseline)throw error;
      lastFailure=error;
      await (options.wait??pause)(attempt===0?25:75);
      if(table.get(id)?.revision!==baseline)throw error;
    }
  }
}
