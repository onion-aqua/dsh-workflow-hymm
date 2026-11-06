import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import SessionQueryEngine from '@deepseek-ai/dsh-session-query';
import SessionProjections from '@deepseek-ai/dsh-session-projection';
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Tools from '@deepseek-ai/dsh-tools';
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VisualWorkflowService from '../src/host/service.ts';
import { buildPlanningInstruction } from '../src/host/planning.ts';
import type { PlanTask } from '../src/shared/model.ts';

class ExactReadQuery extends SessionQueryEngine {
  async searchSessions():Promise<never>{throw new Error('Search is unused in the planning fixture');}
  async searchEvents():Promise<never>{throw new Error('Search is unused in the planning fixture');}
}

/** A transport/wiring contract, not an evaluation of a live model's reasoning.
 * Agent admission, event projection and JSONL persistence use released rc.3.
 * Only model replies and unused file/desktop boundaries are controlled here.
 */
class PlanningContractModel extends LlmAdapter {
  readonly calls:Array<{prompt:string;options:GenerateOptions}>=[];
  constructor(readonly goal:string,readonly tasks:PlanTask[]){super();}
  async listModels(provider='planning-contract'){return [{provider,id:'local-model',name:'Local planning contract'}];}
  async *stream(options:GenerateOptions):AsyncIterable<StreamChunk>{
    options.signal?.throwIfAborted();
    const prompt=options.messages.findLast(message=>message.role==='user'&&'source' in message&&message.source?.kind==='user')?.content.filter(block=>block.type==='text').map(block=>block.text).join('')??'';
    this.calls.push({prompt,options});
    if(!prompt.startsWith('You are drafting')||!prompt.endsWith(this.goal))throw new Error('Expected the original planning goal in the native model request');
    const text=JSON.stringify({tasks:this.tasks});
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text};
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:{kind:'stop'}};
  }
}

const contexts:Context[]=[],directories:string[]=[];
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});

async function open(goal:string,tasks:PlanTask[]){
  const directory=await mkdtemp(join(tmpdir(),'dsh-planning-intent-'));directories.push(directory);
  const ctx=new Context();contexts.push(ctx);
  await ctx.plugin(TypertRegistry);await ctx.plugin(SessionStore);await ctx.plugin(AgentRegistry);await ctx.plugin(SessionProjections);await ctx.plugin(LlmRuntime);
  await ctx.plugin(SystemPrompt,{includeHarnessIdentity:false});await ctx.plugin(Tools,{mode:'native'});
  await ctx.plugin(JsonlPersistence,{root:join(directory,'sessions'),compression:'none'});await ctx.plugin(ExactReadQuery);
  await ctx.plugin(AgentDefaultModel,{provider:'planning-contract',model:'local-model'});
  const model=new PlanningContractModel(goal,tasks);ctx.llm.registerAdapter(['planning-contract'],model);
  ctx.provide('attachments',{imageLimits:{maxImageBytes:1_000_000,maxImagesPerMessage:10,maxMessageImageBytes:10_000_000,maxImagePixels:10_000_000,maxImageDimension:10000,mediaTypes:['image/png']},admitPromptContent:async(content:unknown)=>content});
  ctx.provide('fileUploads',{registerAgentResolver:()=>()=>{},bindPrompt:()=>({commit(){},[Symbol.dispose](){}}),retirePrompt(){}});
  ctx.provide('fs',{});ctx.provide('remoteAccess',{allows:()=>true});ctx.provide('workspaceRegistry',{archivedSessionIds:[],list:()=>[],get:()=>undefined});
  await ctx.plugin(AgentLoop,{});await ctx.plugin(SessionController,{nativeOpen:false});
  await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:join(directory,'workflow-storage')});await ctx.plugin(StorageDomain,{backend:'json'});await ctx.plugin(VisualWorkflowService);
  const service=ctx.visualWorkflow;await vi.waitFor(async()=>expect((await service.catalog()).sessions).toBeInstanceOf(Array));
  return {directory,service,model};
}

async function propose(goal:string,tasks:PlanTask[]){
  const opened=await open(goal,tasks),workflow=(await opened.service.create({name:'Native planning intent contract'})).workflow;
  const requested=await opened.service.generatePlan({workflowId:workflow.id,goal,operationId:'intent-contract-plan'});
  await vi.waitFor(async()=>expect((await opened.service.get({id:workflow.id})).workflow!.plans!.find(plan=>plan.id===requested.planId)?.status).toBe('proposed'),{timeout:5000,interval:20});
  const proposed=(await opened.service.get({id:workflow.id})).workflow!,plan=proposed.plans!.find(item=>item.id===requested.planId)!;
  expect(opened.model.calls).toHaveLength(1);expect(opened.model.calls[0]!.prompt).toBe(buildPlanningInstruction(goal));expect(plan.goal).toBe(goal);expect(plan.tasks).toEqual(tasks);expect(proposed.nodes).toEqual([]);expect(proposed.executions).toEqual([]);
  const entries=await readdir(join(opened.directory,'sessions'),{recursive:true,withFileTypes:true}),log=entries.find(entry=>entry.isFile()&&entry.parentPath.endsWith(plan.sessionId)&&entry.name.endsWith('.jsonl'));
  expect(log).toBeDefined();const persisted=await readFile(join(log!.parentPath,log!.name),'utf8');expect(persisted).toContain(goal);expect(persisted).toContain('assistant/message');
  return {...opened,workflow:proposed,plan};
}

describe('native planning intent and language contracts',()=>{
  it('preserves a compact Chinese query plan with city clarification and an explicit then dependency',async()=>{
    const goal='帮我查一下本市今天的天气，然后整理明天出行建议。';
    const tasks:PlanTask[]=[
      {id:'weather',title:'确认城市并查询天气',instruction:'先确认“本市”所指城市，再查询当地今天的天气与明日预报；无法确认时明确写出可纠正的地点假设，不默认指定城市。',dependsOn:[]},
      {id:'advice',title:'整理明天出行建议',instruction:'根据前一步确认的城市和天气来源整理出行建议，并列出仍需用户确认的信息。',dependsOn:['weather']},
    ];
    const {service,model,workflow,plan}=await propose(goal,tasks),accepted=await service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true}),nodes=accepted.workflow.nodes;
    expect(nodes.map(node=>({title:node.title,instruction:node.instruction}))).toEqual(tasks.map(task=>({title:task.title,instruction:task.instruction})));
    const weather=nodes.find(node=>node.title===tasks[0]!.title)!,advice=nodes.find(node=>node.title===tasks[1]!.title)!;
    expect(accepted.workflow.edges.map(edge=>({source:edge.source,target:edge.target}))).toEqual([{source:weather.id,target:advice.id}]);expect(accepted.workflow.executions).toEqual([]);expect(model.calls).toHaveLength(1);
  },10000);

  it('preserves the original English research goal and its two returned executable steps',async()=>{
    const goal='Find recent laptop battery benchmark results, then compare the methods and summarize limitations.';
    const tasks:PlanTask[]=[
      {id:'sources',title:'Collect benchmark evidence',instruction:'Find recent battery benchmark results with dates, devices and test conditions; report gaps explicitly.',dependsOn:[]},
      {id:'compare',title:'Compare methods and limitations',instruction:'Compare the recorded test methods and summarize supported conclusions and limitations.',dependsOn:['sources']},
    ];
    const {plan}=await propose(goal,tasks);expect(plan.tasks.map(task=>task.title)).toEqual(['Collect benchmark evidence','Compare methods and limitations']);
  },10000);

  it('retains implementation, testing and documentation when those deliverables are explicitly requested',async()=>{
    const goal='实现一个天气查询页面，补上测试和使用说明。';
    const tasks:PlanTask[]=[
      {id:'implement',title:'实现天气查询页面',instruction:'检查现有项目后实现用户要求的页面和查询交互。',dependsOn:[]},
      {id:'test',title:'验证查询页面',instruction:'为已实现的主要交互和失败状态增加必要测试并执行验证。',dependsOn:['implement']},
      {id:'docs',title:'补充使用说明',instruction:'基于实际页面行为补充运行方法和使用说明。',dependsOn:['test']},
    ];
    const {plan}=await propose(goal,tasks);expect(plan.tasks).toHaveLength(3);expect(plan.tasks[2]!.dependsOn).toEqual(['test']);
  },10000);

  it('does not hard truncate a valid plan whose goal explicitly requires six separate deliverables',async()=>{
    const goal='请保留六个独立验收项：数据来源、采集、清洗、交叉核验、可视化和交付说明；每项都需要单独验收。';
    const titles=['确认数据来源','采集数据','清洗数据','交叉核验','制作可视化','编写交付说明'];
    const tasks:PlanTask[]=titles.map((title,index)=>({id:`deliverable-${index+1}`,title,instruction:`完成并记录“${title}”这一明确要求的独立验收项。`,dependsOn:index?[`deliverable-${index}`]:[]}));
    const {service,workflow,plan,model}=await propose(goal,tasks),accepted=await service.applyPlan({workflowId:workflow.id,planId:plan.id,accept:true});
    expect(accepted.workflow.nodes).toHaveLength(6);expect(accepted.workflow.edges).toHaveLength(5);expect(accepted.workflow.executions).toEqual([]);expect(model.calls).toHaveLength(1);
  },10000);
});
