import { describe, expect, it, vi } from 'vitest';
import { isWorkflowRenameBeforeCommit, updateWorkflowMetadata } from '../src/host/storage-retry.ts';

const pendingRename=()=>Object.assign(new Error('Windows destination temporarily locked'),{code:'EPERM',syscall:'rename',path:'C:\\workflow-data\\.b4c346ef-2bbf-472a-91d3-b21d894a48e1.tmp',dest:'C:\\workflow-data\\visual_workflow.json'});
function tableWithFailures(failures:number,error:unknown=pendingRename()){
  let current={revision:7,name:'original'};
  const table={get:vi.fn(()=>current),update:vi.fn(async(_id:string,transform:(value:typeof current)=>typeof current)=>{const next=transform(current);if(failures-->0)throw error;current=next;return next;})};
  return {table,get current(){return current;},replace:(value:typeof current)=>{current=value;}};
}
const changed=(current:{revision:number;name:string})=>({...current,revision:current.revision+1,name:'saved'});

describe('strict pre-commit Workflow metadata retry',()=>{
  it('recognizes only Windows rename failures for the exact single-unit UUID temp path',()=>{
    for(const code of ['EPERM','EACCES','EBUSY'])expect(isWorkflowRenameBeforeCommit(Object.assign(pendingRename(),{code}),'win32')).toBe(true);
    expect(isWorkflowRenameBeforeCommit(pendingRename(),'linux')).toBe(false);
    for(const fields of [{code:'EIO'},{syscall:'open'},{syscall:'unlink'},{dest:'C:\\workflow-data\\other.json'},{dest:'C:\\other-directory\\visual_workflow.json'},{path:'C:\\workflow-data\\.not-a-uuid.tmp'},{path:'C:\\workflow-data\\.b4c346ef-2bbf-172a-91d3-b21d894a48e1.tmp'},{path:'relative\\.b4c346ef-2bbf-472a-91d3-b21d894a48e1.tmp'},{dest:undefined}])expect(isWorkflowRenameBeforeCommit(Object.assign(pendingRename(),fields),'win32')).toBe(false);
    expect(isWorkflowRenameBeforeCommit({...pendingRename()},'win32')).toBe(false);
  });
  it('retries one proven pre-commit rename and publishes exactly one revision after a short delay',async()=>{
    const fixture=tableWithFailures(1),wait=vi.fn(async()=>{}),transform=vi.fn(changed);
    expect(await updateWorkflowMetadata(fixture.table,'workflow',transform,{platform:'win32',wait})).toEqual({revision:8,name:'saved'});
    expect(fixture.table.update).toHaveBeenCalledTimes(2);expect(transform.mock.calls.map(([record])=>record.revision)).toEqual([7,7]);expect(wait.mock.calls).toEqual([[25]]);expect(fixture.current.revision).toBe(8);
  });
  it('limits persistent contention to three total metadata attempts and two bounded delays',async()=>{
    const failure=pendingRename(),fixture=tableWithFailures(Infinity,failure),wait=vi.fn(async()=>{});
    await expect(updateWorkflowMetadata(fixture.table,'workflow',changed,{platform:'win32',wait})).rejects.toBe(failure);
    expect(fixture.table.update).toHaveBeenCalledTimes(3);expect(wait.mock.calls).toEqual([[25],[75]]);expect(fixture.current).toEqual({revision:7,name:'original'});
  });
  it('does not retry an unknown failure, another file, or an error before the transform queue slot',async()=>{
    for(const failure of [new Error('unknown storage outcome'),Object.assign(pendingRename(),{dest:'C:\\workflow-data\\another.json'})]){
      const fixture=tableWithFailures(Infinity,failure),wait=vi.fn(async()=>{});await expect(updateWorkflowMetadata(fixture.table,'workflow',changed,{platform:'win32',wait})).rejects.toBe(failure);expect(fixture.table.update).toHaveBeenCalledTimes(1);expect(wait).not.toHaveBeenCalled();
    }
    const failure=pendingRename(),fixture=tableWithFailures(0),wait=vi.fn(async()=>{});fixture.table.update.mockImplementation(async()=>{throw failure;});
    await expect(updateWorkflowMetadata(fixture.table,'workflow',changed,{platform:'win32',wait})).rejects.toBe(failure);expect(fixture.table.update).toHaveBeenCalledTimes(1);expect(wait).not.toHaveBeenCalled();
  });
  it('never replays after a committed or concurrent revision, including during the delay',async()=>{
    for(const timing of ['already-committed','during-delay'] as const){
      const failure=pendingRename(),fixture=tableWithFailures(Infinity,failure),wait=vi.fn(async()=>{if(timing==='during-delay')fixture.replace({revision:8,name:'other writer'});});
      if(timing==='already-committed')fixture.table.update.mockImplementation(async(_id,transform)=>{fixture.replace(transform(fixture.current));throw failure;});
      await expect(updateWorkflowMetadata(fixture.table,'workflow',changed,{platform:'win32',wait})).rejects.toBe(failure);expect(fixture.table.update).toHaveBeenCalledTimes(1);expect(fixture.current.revision).toBe(8);
    }
  });
  it('checks the baseline again inside the retry queue slot before invoking the transform',async()=>{
    const failure=pendingRename(),fixture=tableWithFailures(1,failure),originalUpdate=fixture.table.update.getMockImplementation()!,wait=vi.fn(async()=>{}),transform=vi.fn(changed);
    let attempts=0;fixture.table.update.mockImplementation(async(id,apply)=>{if(++attempts===2)fixture.replace({revision:8,name:'queued competitor'});return originalUpdate(id,apply);});
    await expect(updateWorkflowMetadata(fixture.table,'workflow',transform,{platform:'win32',wait})).rejects.toBe(failure);expect(fixture.table.update).toHaveBeenCalledTimes(2);expect(transform).toHaveBeenCalledTimes(1);expect(fixture.current).toEqual({revision:8,name:'queued competitor'});
  });
});
