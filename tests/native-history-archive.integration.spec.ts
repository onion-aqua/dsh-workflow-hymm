import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import SessionStore,{SessionId,SessionLogOffset} from '@deepseek-ai/dsh-session';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import {afterEach,describe,it,expect,vi} from 'vitest';
import Service from '../src/host/service.ts';
import type {Workflow} from '../src/shared/model.ts';

const contexts:Context[]=[],directories:string[]=[];
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();for(const root of directories.splice(0))await rm(root,{recursive:true,force:true});});
async function open(existing?:string,registry=true){
  const root=existing??await mkdtemp(join(tmpdir(),'workflow-history-archive-'));if(!existing)directories.push(root);
  const ctx=new Context();contexts.push(ctx);await ctx.plugin(SessionStore);await ctx.plugin(JsonlPersistence,{root:join(root,'sessions'),compression:'none'});
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(root,'storages')});await ctx.plugin(Domain,{backend:'json'});
  if(registry)await ctx.plugin(WorkspaceRegistry);
  await ctx.plugin(Service);const service=ctx.visualWorkflow,running=new Set<string>();
  // Only catalogue projection is controlled. Archival and its activity gate,
  // durable workspace state and Session files are the real released services.
  const catalog=vi.fn(async()=>Promise.all((await ctx.sessionPersistence.list()).map(async item=>({sessionId:item.header.id,title:item.header.id,updatedAt:item.header.createdAt,blank:false,running:running.has(item.header.id),parentSessionId:item.header.parentSession,cwd:item.header.cwd}))));
  Reflect.set(service,'native',{catalog,isRunning:(id:string)=>running.has(id)});
  const session=async(id:string,parent?:string)=>{const value=ctx.sessions.create(SessionId(id),{meta:{cwd:root,...parent?{parentSession:SessionId(parent),isSeeded:true}:{}},...(parent?{seed:[],inheritedEventCount:SessionLogOffset(0)}:{})});const handle=await ctx.sessionPersistence.create(value.header,parent?{inheritedEventCount:SessionLogOffset(0)}:{});if(value.snapshotEvents().length)await handle.append(value.snapshotEvents());await handle.flush();await handle.close();return value;};
  const write=(id:string,change:(wf:Workflow)=>Workflow)=>(Reflect.get(service,'write') as (id:string,change:(wf:Workflow)=>Workflow)=>Promise<Workflow>).call(service,id,change);
  return{ctx,service,root,session,write,running,catalog};
}
async function owner(env:Awaited<ReturnType<typeof open>>,ids:string[],source?:string){
  for(const id of [...ids,...source?[source]:[]])if(!env.ctx.sessions.get(SessionId(id)))await env.session(id);
  const created=(await env.service.create({name:'History archive fixture'})).workflow;
  return env.write(created.id,w=>({...w,sourceSessionId:source,branches:ids.map((id,index)=>({id:`branch-${index}`,label:`Branch ${index}`,sessionId:id,sourceSessionId:source,nodeIds:[],createdAt:1}))}));
}
async function archiveWorkflow(env:Awaited<ReturnType<typeof open>>,workflow:Workflow){expect(await env.service.delete({workflowId:workflow.id,expectedRevision:workflow.revision})).toEqual({ok:true,workflowId:workflow.id});return env.service.previewSessionArchive({workflowId:workflow.id});}
async function fingerprints(root:string){const result:Record<string,string>={};async function visit(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())await visit(file);else result[relative(root,file)]=createHash('sha256').update(await readFile(file)).digest('hex');}}await visit(root);return result;}

describe('native Session history archival after Workflow deletion',()=>{
  it('keeps history by default, then archives only confirmed owned Sessions through the real registry and retains exact log bytes after restart',async()=>{
    const first=await open();let workflow=await owner(first,['task-owned'],'source-original');
    await first.session('plan-owned');await first.session('upload-owned');
    workflow=await first.write(workflow.id,w=>({...w,uploadSessionId:'upload-owned',plans:[{id:'plan-one',goal:'Fixture',sessionId:'plan-owned',requestId:'plan-request',status:'rejected',tasks:[],createdAt:1}]}));
    const bytes=await fingerprints(join(first.root,'sessions'));
    await expect(first.service.previewSessionArchive({workflowId:workflow.id})).rejects.toThrow(/Archive the workflow/);
    const preview=await archiveWorkflow(first,workflow);expect(first.ctx.workspaceRegistry.archivedSessionIds).toEqual([]);
    expect(preview).toMatchObject({available:true,sessionIds:['plan-owned','task-owned','upload-owned'],protectedCount:1,alreadyArchivedCount:0});
    const result=await first.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:preview.sessionIds});
    expect(result).toEqual({archivedSessionIds:preview.sessionIds,failedSessionIds:[],skippedSessionIds:[]});
    expect(first.ctx.workspaceRegistry.archivedSessionIds).not.toContain('source-original');
    expect((await first.service.catalog()).sessions.map(item=>item.sessionId)).toEqual(['source-original']);
    expect(await fingerprints(join(first.root,'sessions'))).toEqual(bytes);
    await first.ctx.fiber.dispose();const next=await open(first.root);
    expect([...next.ctx.workspaceRegistry.archivedSessionIds].sort()).toEqual(preview.sessionIds);
    expect(await next.service.previewSessionArchive({workflowId:workflow.id})).toMatchObject({sessionIds:[],alreadyArchivedCount:3,protectedCount:1});
    expect((await next.ctx.sessionPersistence.list()).map(item=>item.header.id).sort()).toEqual(['plan-owned','source-original','task-owned','upload-owned']);
  });
  it('protects native sources, other archived workflow references, active Sessions, and external descendants',async()=>{
    const env=await open(),workflow=await owner(env,['owned-shared','owned-active','owned-parent','owned-only'],'source-original');
    const other=(await env.service.create({name:'Another canvas'})).workflow;
    const borrowed=await env.write(other.id,w=>({...w,sourceSessionId:'owned-shared'}));await env.service.delete({workflowId:other.id,expectedRevision:borrowed.revision});
    await env.session('external-child','owned-parent');env.running.add('owned-active');
    const preview=await archiveWorkflow(env,workflow);expect(preview.sessionIds).toEqual(['owned-only']);expect(preview.protectedCount).toBe(4);
    await expect(env.service.archiveSessionHistory({...preview,sessionIds:['owned-shared']} as any)).rejects.toThrow(/Invalid workflow data/);
    await expect(env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:['owned-only','source-original']})).rejects.toThrow(/eligibility changed/);
    expect(env.ctx.workspaceRegistry.archivedSessionIds).toEqual([]);
  });
  it('requires the archived revision and exact current eligibility set, including duplicate rejection',async()=>{
    const env=await open(),workflow=await owner(env,['owned-a','owned-b']),preview=await archiveWorkflow(env,workflow);
    await expect(env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision-1,sessionIds:preview.sessionIds})).rejects.toThrow(/workflow changed/);
    await expect(env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:['owned-a']})).rejects.toThrow(/eligibility changed/);
    await expect(env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:['owned-a','owned-a','owned-b']})).rejects.toThrow(/eligibility changed/);
    env.running.add('owned-a');await expect(env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:preview.sessionIds})).rejects.toThrow(/eligibility changed/);
    expect(env.ctx.workspaceRegistry.archivedSessionIds).toEqual([]);
  });
  it('refuses activity that starts inside native archive admission and never requests stopActivity',async()=>{
    const env=await open(),workflow=await owner(env,['owned-active-race']),preview=await archiveWorkflow(env,workflow),registry=env.ctx.workspaceRegistry;
    const original=registry.archiveSession.bind(registry);const stop=vi.fn();env.ctx.on('workspace/session-stop',stop);
    const call=vi.spyOn(registry,'archiveSession').mockImplementation(async(id,options)=>{env.ctx.on('workspace/session-activity',async(request,next)=>request.sessionId===id?[...await next(),{kind:'turn',label:'New native activity'} as any]:next());return original(id,options);});
    expect(await env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:preview.sessionIds})).toEqual({archivedSessionIds:[],failedSessionIds:['owned-active-race'],skippedSessionIds:[]});
    expect(call).toHaveBeenCalledExactlyOnceWith(SessionId('owned-active-race'));expect(stop).not.toHaveBeenCalled();expect(registry.archivedSessionIds).toEqual([]);
  });
  it('protects idle completed history with a continued actionable question, a queued reply or pending approval',async()=>{
    const env=await open(),workflow=await owner(env,['owned-question','owned-reply','owned-approval','owned-clear']);
    const native=Reflect.get(env.service,'native');native.questions=vi.fn(async(id:string)=>id==='owned-question'?[{sessionId:id,callId:'continued-question',state:'continued',actionable:true,createdAt:1,questions:[]}]:[]);native.pendingQuestionReplies=(id:string)=>id==='owned-reply'?['reply-awaiting-claim']:[];
    Reflect.set(env.service,'controls',{approvals:async(id:string)=>id==='owned-approval'?[{sessionId:id,approvalId:'unsettled',actionable:true}]:[]});
    expect(env.running.size).toBe(0);const preview=await archiveWorkflow(env,workflow);expect(preview.sessionIds).toEqual(['owned-clear']);expect(preview.protectedCount).toBe(3);
    expect(env.ctx.workspaceRegistry.archivedSessionIds).toEqual([]);
  });
  it.each(['question','approval'] as const)('rechecks an actionable %s that appears at final native archive admission',async kind=>{
    const env=await open(),workflow=await owner(env,['owned-attention-race']),preview=await archiveWorkflow(env,workflow),native=Reflect.get(env.service,'native');let late=false;
    native.questions=async()=>late&&kind==='question'?[{sessionId:'owned-attention-race',callId:'late-question',state:'continued',actionable:true,createdAt:1,questions:[]}]:[];
    Reflect.set(env.service,'controls',{approvals:async()=>late&&kind==='approval'?[{approvalId:'late-approval',actionable:true}]:[]});
    const registry=env.ctx.workspaceRegistry,original=registry.archiveSession.bind(registry);vi.spyOn(registry,'archiveSession').mockImplementation(async id=>{late=true;return original(id);});
    expect(await env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:preview.sessionIds})).toEqual({archivedSessionIds:[],failedSessionIds:['owned-attention-race'],skippedSessionIds:[]});expect(registry.archivedSessionIds).toEqual([]);
  });
  it('blocks newly borrowing a Session while its native archival is in flight',async()=>{
    const env=await open(),workflow=await owner(env,['owned-flight']),preview=await archiveWorkflow(env,workflow),other=(await env.service.create({name:'Concurrent canvas'})).workflow;
    let ready!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>ready=resolve),hold=new Promise<void>(resolve=>release=resolve);
    const registry=env.ctx.workspaceRegistry,original=registry.archiveSession.bind(registry);vi.spyOn(registry,'archiveSession').mockImplementation(async id=>{ready();await hold;return original(id);});
    const flight=env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:preview.sessionIds});await entered;
    await expect(env.service.importSession({sessionId:'owned-flight'})).rejects.toThrow(/being archived/);
    await expect(env.service.save({workflow:{...other,utilityNodes:[{id:'utility-borrow',title:'Borrowed',position:{x:0,y:0},width:600,height:420,sessionId:'owned-flight'}]},expectedRevision:other.revision})).rejects.toThrow(/being archived/);
    release();expect((await flight).archivedSessionIds).toEqual(['owned-flight']);expect((await env.service.get({id:other.id})).workflow!.utilityNodes).toBeUndefined();await expect(env.service.importSession({sessionId:'owned-flight'})).rejects.toThrow(/already archived/);
  });
  it('returns partial outcomes once without blindly retrying already archived history',async()=>{
    const env=await open(),workflow=await owner(env,['owned-a','owned-b']),preview=await archiveWorkflow(env,workflow),registry=env.ctx.workspaceRegistry,original=registry.archiveSession.bind(registry);
    const call=vi.spyOn(registry,'archiveSession').mockImplementation(async id=>{if(id==='owned-b')throw new Error('Native storage failed');return original(id);});
    expect(await env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:preview.sessionIds})).toEqual({archivedSessionIds:['owned-a'],failedSessionIds:['owned-b'],skippedSessionIds:[]});expect(call).toHaveBeenCalledTimes(2);
    await expect(env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:preview.sessionIds})).rejects.toThrow(/eligibility changed/);expect(call).toHaveBeenCalledTimes(2);
    expect(await env.service.previewSessionArchive({workflowId:workflow.id})).toMatchObject({sessionIds:['owned-b'],alreadyArchivedCount:1});
  });
  it('reports archival unavailable in a profile without the native registry rather than deleting Session files',async()=>{
    const env=await open(undefined,false),workflow=await owner(env,['owned-retained']),preview=await archiveWorkflow(env,workflow);
    expect(preview).toMatchObject({available:false,sessionIds:[]});expect(preview.reason).toContain('Physical log deletion is not a released API');
    await expect(env.service.archiveSessionHistory({workflowId:workflow.id,expectedRevision:preview.expectedRevision,sessionIds:[]})).rejects.toThrow(/does not expose/);
    expect(await env.ctx.sessionPersistence.stat(SessionId('owned-retained'))).toBeDefined();
  });
});
