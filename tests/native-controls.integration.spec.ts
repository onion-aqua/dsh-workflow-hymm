import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import SubagentRuntime from '@deepseek-ai/dsh-subagent';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DshNativeRuntime } from '../src/host/native-runtime.ts';
import { NativeControls } from '../src/host/native-controls.ts';

const archive='C:/Users/cheny/AppData/Local/Programs/DeepSeek Harness/resources/app.asar';
type ArchiveEntry={files?:Record<string,ArchiveEntry>;size:number;offset:string;unpacked?:boolean};
function installedFile(relative:string):Buffer{
  const fd=openSync(archive,'r');try{const first=Buffer.alloc(16);readSync(fd,first,0,16,0);const header=Buffer.alloc(first.readUInt32LE(12));readSync(fd,header,0,header.length,16);let entry=JSON.parse(header.toString()) as ArchiveEntry;for(const part of relative.split('/'))entry=entry.files![part]!;if(entry.unpacked)return readFileSync(`${archive}.unpacked/${relative}`);const bytes=Buffer.alloc(entry.size);readSync(fd,bytes,0,bytes.length,8+first.readUInt32LE(4)+Number(entry.offset));return bytes;}finally{closeSync(fd);}
}
async function copyInstalledPackage(directory:string,name:string,seen=new Set<string>()){
  if(seen.has(name))return;seen.add(name);const prefix=`dsh/node_modules/${name}/`,root=join(directory,'node_modules',name),metadata=JSON.parse(installedFile(`${prefix}package.json`).toString());
  const fd=openSync(archive,'r');try{const first=Buffer.alloc(16);readSync(fd,first,0,16,0);const header=Buffer.alloc(first.readUInt32LE(12));readSync(fd,header,0,header.length,16);let entry=JSON.parse(header.toString()) as ArchiveEntry;for(const part of prefix.slice(0,-1).split('/'))entry=entry.files![part]!;async function visit(node:ArchiveEntry,relative=''){for(const [leaf,value] of Object.entries(node.files??{})){const next=relative?`${relative}/${leaf}`:leaf;if(value.files)await visit(value,next);else if(!next.endsWith('.d.ts')){const target=join(root,next);await mkdir(dirname(target),{recursive:true});await writeFile(target,installedFile(prefix+next));}}}await visit(entry);}finally{closeSync(fd);}
  for(const dependency of Object.keys({...metadata.dependencies,...metadata.peerDependencies}))if(!existsSync(join(process.cwd(),'node_modules',dependency)))await copyInstalledPackage(directory,dependency,seen);
  return pathToFileURL(join(root,metadata.main??'index.js')).href;
}
class ExactReadQuery extends SessionQueryEngine {async searchSessions():Promise<never>{throw new Error('unused');}async searchEvents():Promise<never>{throw new Error('unused');}}
class ApprovalModel extends LlmAdapter {
  readonly calls:GenerateOptions[]=[];
  async listModels(provider='fixture'){return [{provider,id:'default',name:'Controlled approval model'}];}
  async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
    options.signal?.throwIfAborted();this.calls.push(options);
    if(options.messages.at(-1)?.role!=='tool'){
      const block={type:'tool-call' as const,id:ToolCallId(`native-sensitive-${this.calls.length}`),name:'fixture_sensitive',arguments:JSON.stringify({command:'echo verified native approval'})};
      yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;
    }
    const text='Native approval result observed';yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
  }
}
const opened:Array<{ctx:Context;controls:NativeControls;runtime:DshNativeRuntime;directory:string}>=[];
afterEach(async()=>{for(const item of opened.splice(0).reverse()){await item.controls.dispose();await item.runtime.disposeSubagents();await item.ctx.fiber.dispose();await rm(item.directory,{recursive:true,force:true});}});
async function open(permissions=false,child=false,restoreDirectory?:string){
  const directory=await mkdtemp(join(process.cwd(),'artifacts','native-controls-')),ctx=new Context();
  if(restoreDirectory)await cp(restoreDirectory,join(directory,'sessions'),{recursive:true});
  await ctx.plugin(TypertRegistry);await ctx.plugin(SessionStore);await ctx.plugin(AgentRegistry);await ctx.plugin(SessionProjections);await ctx.plugin(LlmRuntime);await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false});await ctx.plugin(Tools,{mode:'native'});await ctx.plugin(JsonlPersistence,{root:join(directory,'sessions'),compression:'none'});await ctx.plugin(ExactReadQuery);await ctx.plugin(AgentDefaultModel,{provider:'fixture',model:'default'});await ctx.plugin(ApprovalService,{policy:'ask'});
  const model=new ApprovalModel();ctx.llm.registerAdapter(['fixture'],model);
  // Desktop/HTTP boundaries are unused. Agent, approval waterfall, permission
  // service, durable events, controller and persistence are real rc.3 components.
  ctx.provide('attachments',{imageLimits:{maxImageBytes:1e6,maxImagesPerMessage:10,maxMessageImageBytes:1e7,maxImagePixels:1e7,maxImageDimension:10000,mediaTypes:['image/png']},admitPromptContent:async(content:unknown)=>content});ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{},bindPrompt:()=>({commit(){},[Symbol.dispose](){}}),retirePrompt(){}});if(child){await ctx.plugin(LocalFileSystem,{cwd:directory});await ctx.plugin(WorkingDirectoryService,{defaultDirectory:directory});}else ctx.provide('fs',{});ctx.provide('remoteAccess',{allows:()=>true});ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[],get:()=>undefined});
  if(permissions){ctx.provide('shell',{sandboxMode:'workspace-write'});const url=await copyInstalledPackage(directory,'@deepseek-ai/dsh-permission-presets');const module=await import(/* @vite-ignore */url!);await ctx.plugin(module.default,{defaultPreset:'workspace-write',presets:{'read-only':{sandbox:'read-only',approval:'ask'},'workspace-write':{sandbox:'workspace-write',approval:'ask'},'danger-full-access':{sandbox:'danger-full-access',approval:'never'}}});}
  if(child){await ctx.plugin(SandboxPolicy,{mode:'workspace-write',workspaceRoot:directory});const url=await copyInstalledPackage(directory,'@deepseek-ai/dsh-subagent-fork-in-process'),provider=await import(/* @vite-ignore */url!);await ctx.plugin(SubagentRuntime,{});await ctx.plugin(provider,{providerName:'fork'});}
  await ctx.plugin(AgentLoop,{});await ctx.plugin(SessionController,{nativeOpen:false});const runtime=new DshNativeRuntime(ctx),controls=new NativeControls(ctx),bodies={count:0};opened.push({ctx,controls,runtime,directory});
  ctx.on('tools/pre-execute',async(exec,next)=>exec.name==='fixture_sensitive'?{kind:'ask',reason:'Review this exact native command'}:next());ctx.tools.register({name:'fixture_sensitive',description:'Controlled native approval boundary',parameters:{type:'object',properties:{command:{type:'string'}}},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:String(value)}]},execute:async()=>{bodies.count++;return 'native tool completed';}});
  return {ctx,controls,runtime,directory,model,bodies};
}
async function pending(controls:NativeControls,sessionId:string){let result:Awaited<ReturnType<NativeControls['approvals']>>[number]|undefined;await vi.waitFor(async()=>{result=(await controls.approvals(sessionId))[0];expect(result?.actionable).toBe(true);},{timeout:5000,interval:20});return result!;}

describe('Released native permissions and approval controls',()=>{
  it.each(['allowed-once','rejected'] as const)('answers %s on the exact live native call and persists its original audit pair',async decision=>{
    const {controls,runtime,directory,bodies}=await open(),session=await runtime.create({cwd:directory}),notifications:string[]=[];controls.setApprovalOwner(async id=>id===session.sessionId);const stop=controls.subscribe(id=>notifications.push(id));
    await runtime.submit({sessionId:session.sessionId,requestId:`native-approval-${decision}`,text:'Run the controlled tool'});const approval=await pending(controls,session.sessionId);expect(approval.command).toBe('echo verified native approval');expect(approval.input).toContain('command');expect(bodies.count).toBe(0);
    expect(await controls.answerApproval('other-session',approval.approvalId,decision)).toBe(false);expect(await controls.answerApproval(session.sessionId,approval.approvalId,decision)).toBe(true);expect(await controls.answerApproval(session.sessionId,approval.approvalId,decision)).toBe(false);await runtime.waitForIdle(session.sessionId);await runtime.flush(session.sessionId);
    const log=await runtime.read(session.sessionId);expect(log.events.filter(event=>event.type==='approval/asked')).toHaveLength(1);expect(log.events.find(event=>event.type==='approval/decided')?.data).toEqual({id:approval.approvalId,outcome:decision});expect(bodies.count).toBe(decision==='allowed-once'?1:0);expect(await controls.approvals(session.sessionId)).toEqual([]);expect(notifications.length).toBeGreaterThanOrEqual(2);stop();
  });
  it('does not claim foreign approvals and never manufactures a grant when an owner changes',async()=>{
    const {ctx,controls,runtime,directory,bodies}=await open(),session=await runtime.create({cwd:directory});controls.setApprovalOwner(async()=>false);const fallback=vi.fn(async()=> 'rejected' as const);ctx.on('approval/request',fallback);
    await runtime.submit({sessionId:session.sessionId,requestId:'foreign-approval',text:'Foreign native request'});await runtime.waitForIdle(session.sessionId);expect(fallback).toHaveBeenCalledOnce();expect(bodies.count).toBe(0);expect(await controls.approvals(session.sessionId)).toEqual([]);
    controls.setApprovalOwner(async()=>true);await runtime.submit({sessionId:session.sessionId,requestId:'owner-changed',text:'Owned before navigation'});const approval=await pending(controls,session.sessionId);controls.setApprovalOwner(async()=>false);expect(await controls.answerApproval(session.sessionId,approval.approvalId,'allowed-once')).toBe(false);expect(bodies.count).toBe(0);await runtime.cancel(session.sessionId,'owner-changed');await runtime.waitForIdle(session.sessionId);expect(await controls.answerApproval(session.sessionId,approval.approvalId,'allowed-once')).toBe(false);
  });
  it('expires a withdrawn wait, keeps tool execution blocked and records native cancellation',async()=>{
    const {controls,runtime,directory,bodies}=await open(),session=await runtime.create({cwd:directory});controls.setApprovalOwner(async()=>true);await runtime.submit({sessionId:session.sessionId,requestId:'cancel-native-approval',text:'Cancel the controlled approval'});const approval=await pending(controls,session.sessionId);await runtime.cancel(session.sessionId,'cancel-native-approval');await runtime.waitForIdle(session.sessionId);expect(await controls.approvals(session.sessionId)).toEqual([]);expect(await controls.answerApproval(session.sessionId,approval.approvalId,'allowed-once')).toBe(false);expect(bodies.count).toBe(0);expect((await runtime.read(session.sessionId)).events.find(event=>event.type==='approval/decided')?.data.outcome).toBe('cancelled');
  });
  it('does not create an orphan approval resolver when ownership resolves after plugin disposal',async()=>{
    const {controls,runtime,directory,bodies}=await open(),session=await runtime.create({cwd:directory});let release!:()=>void,entered!:()=>void;
    const ownership=new Promise<void>(resolve=>{release=resolve;}),checking=new Promise<void>(resolve=>{entered=resolve;});controls.setApprovalOwner(async()=>{entered();await ownership;return true;});
    await runtime.submit({sessionId:session.sessionId,requestId:'approval-owner-dispose-race',text:'Review the tool while plugin is being unloaded'});await checking;await controls.dispose();release();
    await vi.waitFor(()=>expect(runtime.isRunning(session.sessionId)).toBe(false),{timeout:5000,interval:20});await runtime.flush(session.sessionId);const log=await runtime.read(session.sessionId),asked=log.events.find(event=>event.type==='approval/asked')!;expect(log.events.find(event=>event.type==='approval/decided')?.data).toEqual({id:asked.data.id,outcome:'unavailable'});expect(bodies.count).toBe(0);expect(await controls.approvals(session.sessionId)).toEqual([]);expect(await controls.answerApproval(session.sessionId,String(asked.data.id),'allowed-once')).toBe(false);expect((Reflect.get(controls,'waits') as Map<string,unknown>).size).toBe(0);
  });
  it('does not recover live resolvers or resume a cold Agent from native crash-tail approval history',async()=>{
    const first=await open(),session=await first.runtime.create({cwd:first.directory});first.controls.setApprovalOwner(async()=>true);await first.runtime.submit({sessionId:session.sessionId,requestId:'native-crash-wait',text:'Snapshot a real pending approval'});const approval=await pending(first.controls,session.sessionId);await first.runtime.flush(session.sessionId);
    const cold=await open(false,false,join(first.directory,'sessions'));cold.controls.setApprovalOwner(async()=>true);expect(cold.ctx.agents.get(SessionId(session.sessionId))).toBeUndefined();const restored=await cold.controls.approvals(session.sessionId);expect(restored.every(item=>!item.actionable)).toBe(true);expect(await cold.controls.answerApproval(session.sessionId,approval.approvalId,'allowed-once')).toBe(false);expect(cold.ctx.agents.get(SessionId(session.sessionId))).toBeUndefined();expect(cold.bodies.count).toBe(0);await first.runtime.cancel(session.sessionId,'native-crash-wait');await first.runtime.waitForIdle(session.sessionId);
  });
  it.each(['read-only','workspace-write'] as const)('pins %s on the exact real child before driving while retaining native delegated approval=never',async mode=>{
    const {ctx,controls,runtime,directory,model,bodies}=await open(true,true),parent=await runtime.create({cwd:directory});
    // A completed full-access seed must not override the later per-task sandbox.
    await controls.applyAccessMode(parent.sessionId,'danger-full-access');await runtime.submit({sessionId:parent.sessionId,requestId:`parent-seed-${mode}`,text:'Create completed old full-access history'});await runtime.waitForIdle(parent.sessionId);await runtime.flush(parent.sessionId);const parentBefore=await runtime.read(parent.sessionId),count=bodies.count,childId=`native-child-permission-${mode}`,ended=new Set<string>();ctx.on('subagent/end',info=>{ended.add(info.id);});
    await runtime.startSubagent({parentSessionId:parent.sessionId,childSessionId:childId,label:'Controlled scoped child',text:'Use the exact native child scope',accessMode:mode});await vi.waitFor(()=>expect(ended.has(childId)).toBe(true),{timeout:5000,interval:20});
    const childLog=await runtime.read(childId),own=childLog.events.filter(event=>event.seq>=childLog.inheritedEventCount);expect(childLog.events.findLast(event=>event.type==='sandbox/mode')?.data.mode).toBe(mode);expect(childLog.events.findLast(event=>event.type==='approval/policy')?.data.policy).toBe('never');expect(own.find(event=>event.type==='sandbox/mode'&&event.data.mode===mode)!.seq).toBeLessThan(own.find(event=>event.type==='turn/start')!.seq);expect(own.find(event=>event.type==='approval/decided')?.data.outcome).toBe('rejected');expect(bodies.count).toBe(count);expect(model.calls.some(call=>JSON.stringify(call.messages).includes('Use the exact native child scope'))).toBe(true);expect((await runtime.read(parent.sessionId)).events.filter(event=>event.type!=='subagent/catalog')).toEqual(parentBefore.events.filter(event=>event.type!=='subagent/catalog'));
    await expect(runtime.startSubagent({parentSessionId:parent.sessionId,childSessionId:`no-auto-${mode}`,label:'Unsupported child review',text:'Must never start',accessMode:'auto'})).rejects.toThrow(/ordinary Session/);expect(ctx.agents.get(SessionId(`no-auto-${mode}`))).toBeUndefined();
  });
  it('uses the actual native catalogue, exposes Auto only while registered, changes only one Session and permits running roots',async()=>{
    const {ctx,controls,runtime,directory}=await open(true),first=await runtime.create({cwd:directory}),other=await runtime.create({cwd:directory});const catalog=await controls.catalogAccessModes();expect(catalog.defaultPreset).toBe('workspace-write');expect(catalog.options.map(option=>option.id)).toEqual(['read-only','workspace-write','danger-full-access']);expect(catalog.options.find(option=>option.id==='danger-full-access')).toMatchObject({sandbox:'danger-full-access',approval:'never'});
    const service=ctx.get('permissionPresets') as {current:(session:unknown)=>string;catalog:()=>unknown;registerAuto:(admit:()=>void)=>()=>void};const before=service.catalog(),otherBefore=await runtime.read(other.sessionId);await controls.applyAccessMode(first.sessionId,'read-only');expect(service.current(ctx.sessions.get(SessionId(first.sessionId))!)).toBe('read-only');expect(await runtime.read(other.sessionId)).toEqual(otherBefore);expect(service.catalog()).toEqual(before);await expect(controls.applyAccessMode(first.sessionId,'auto')).rejects.toThrow(/not currently available/);
    const remove=service.registerAuto(()=>{});expect((await controls.catalogAccessModes()).options.find(option=>option.id==='auto')).toMatchObject({sandbox:'danger-full-access',approval:'ask'});remove();expect((await controls.catalogAccessModes()).options.some(option=>option.id==='auto')).toBe(false);
    controls.setApprovalOwner(async()=>true);await runtime.submit({sessionId:first.sessionId,requestId:'running-permission-switch',text:'Hold on native approval'});const approval=await pending(controls,first.sessionId);expect(runtime.isRunning(first.sessionId)).toBe(true);await controls.applyAccessMode(first.sessionId,'workspace-write');expect(service.current(ctx.sessions.get(SessionId(first.sessionId))!)).toBe('workspace-write');expect(await controls.answerApproval(first.sessionId,approval.approvalId,'rejected')).toBe(true);await runtime.waitForIdle(first.sessionId);expect(service.catalog()).toEqual(before);
  });
});
