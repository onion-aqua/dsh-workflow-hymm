import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import * as JsonStorage from '@deepseek-ai/dsh-storage-json';
import * as Domain from '@deepseek-ai/dsh-storage-domain';
import { afterEach, describe, expect, it } from 'vitest';
import Service from '../src/host/service.ts';
import type { PlanTask, Workflow, WorkflowNode } from '../src/shared/model.ts';

const contexts:Context[]=[],roots:string[]=[];
async function open(directory?:string){
  directory??=await mkdtemp(join(tmpdir(),'workflow-plan-layout-'));if(!roots.includes(directory))roots.push(directory);
  const ctx=new Context();contexts.push(ctx);await ctx.plugin(Storage);await ctx.plugin(JsonStorage,{root:directory});await ctx.plugin(Domain,{backend:'json'});await ctx.plugin(Service);return {ctx,service:ctx.visualWorkflow,directory};
}
async function propose(service:Service,workflowId:string,id:string,tasks:PlanTask[]){
  const write=Reflect.get(service,'write') as (id:string,transform:(workflow:Workflow)=>Workflow)=>Promise<Workflow>;
  return write.call(service,workflowId,workflow=>({...workflow,plans:[...workflow.plans??[],{id,goal:'TEST accepted dependency geometry',sessionId:`session-${id}`,requestId:`request-${id}`,status:'proposed',tasks,createdAt:Date.now()}]}));
}
function overlaps(a:WorkflowNode,b:WorkflowNode){return a.position.x<b.position.x+(b.width??300)+40&&a.position.x+(a.width??300)+40>b.position.x&&a.position.y<b.position.y+(b.height??210)+80&&a.position.y+(a.height??210)+80>b.position.y;}
afterEach(async()=>{for(const ctx of contexts.splice(0).reverse())await ctx.fiber.dispose();for(const directory of roots.splice(0))await rm(directory,{recursive:true,force:true});});

describe('Accepted native plan dependency geometry and persistence',()=>{
  it('lays out only newly accepted tasks by dependencies and durably preserves manual nodes, content and edges',async()=>{
    const first=await open(),created=(await first.service.create({name:'TEST plan layout'})).workflow;
    const existing:WorkflowNode[]=[{id:'manual-a',title:'TEST manual A',instruction:'Keep this exact content',source:'user',status:'draft',revision:1,position:{x:100,y:100},width:700,height:440},{id:'manual-b',title:'TEST manual B',instruction:'Keep this location',source:'user',status:'draft',revision:1,position:{x:950,y:380},width:500,height:600}];
    const saved=await first.service.save({workflow:{...created,nodes:existing,edges:[{id:'manual-edge',source:'manual-a',target:'manual-b',type:'dependency'}]},expectedRevision:created.revision});if(!saved.ok)throw new Error('Expected initial manual graph save');
    const tasks:PlanTask[]=[{id:'finish',title:'Finish',instruction:'Finish exact text',dependsOn:['review']},{id:'start',title:'Start',instruction:'Start exact text',dependsOn:[]},{id:'left',title:'Left',instruction:'Left exact text',dependsOn:['start']},{id:'right',title:'Right',instruction:'Right exact text',dependsOn:['start']},{id:'review',title:'Review',instruction:'Review exact text',dependsOn:['left','right']}];
    const proposed=await propose(first.service,created.id,'layout-plan',tasks),before=structuredClone(proposed.nodes);
    const accepted=(await first.service.applyPlan({workflowId:created.id,planId:'layout-plan',accept:true})).workflow;
    expect(accepted.nodes.filter(node=>!node.originPlanId)).toEqual(before);expect(accepted.edges.find(edge=>edge.id==='manual-edge')).toEqual(saved.workflow.edges[0]);
    const added=accepted.nodes.filter(node=>node.originPlanId==='layout-plan'),byTitle=new Map(added.map(node=>[node.title,node]));expect(added).toHaveLength(tasks.length);
    for(const task of tasks){const actual=byTitle.get(task.title)!;expect(actual).toMatchObject({instruction:task.instruction,status:'draft',source:'agent',revision:1});for(const dependency of task.dependsOn){const parent=byTitle.get(tasks.find(item=>item.id===dependency)!.title)!;expect(actual.position.x).toBeGreaterThan(parent.position.x+300);expect(accepted.edges.some(edge=>edge.source===parent.id&&edge.target===actual.id)).toBe(true);}}
    expect(byTitle.get('Left')!.position.x).toBe(byTitle.get('Right')!.position.x);expect(byTitle.get('Left')!.position.y).not.toBe(byTitle.get('Right')!.position.y);
    for(const node of added)for(const manual of before)expect(overlaps(node,manual)).toBe(false);
    expect(accepted.executions).toEqual([]);expect(accepted.plans!.find(plan=>plan.id==='layout-plan')!.status).toBe('accepted');
    const stored=JSON.parse(await readFile(join(first.directory,'visual_workflow.json'),'utf8')).tables.workflows[created.id];expect(stored.nodes).toEqual(accepted.nodes);expect(stored.edges).toEqual(accepted.edges);
    await first.ctx.fiber.dispose();const resumed=await open(first.directory);expect((await resumed.service.get({id:created.id})).workflow!.nodes).toEqual(accepted.nodes);
  });
  it('places a later independent plan without moving earlier accepted nodes or stretching its roots horizontally',async()=>{
    const {service}=await open(),workflow=(await service.create({name:'TEST repeated plans'})).workflow;
    await propose(service,workflow.id,'first-plan',[{id:'a',title:'First A',instruction:'A',dependsOn:[]},{id:'b',title:'First B',instruction:'B',dependsOn:['a']}]);
    const first=(await service.applyPlan({workflowId:workflow.id,planId:'first-plan',accept:true})).workflow;
    await propose(service,workflow.id,'second-plan',Array.from({length:6},(_,index)=>({id:`root-${index}`,title:`Independent ${index}`,instruction:`Exact ${index}`,dependsOn:[]})));
    const second=(await service.applyPlan({workflowId:workflow.id,planId:'second-plan',accept:true})).workflow,added=second.nodes.filter(node=>node.originPlanId==='second-plan');
    expect(second.nodes.filter(node=>node.originPlanId==='first-plan')).toEqual(first.nodes);expect(new Set(added.map(node=>node.position.x)).size).toBe(1);
    for(const node of added)for(const earlier of first.nodes)expect(overlaps(node,earlier)).toBe(false);expect(second.executions).toEqual([]);
  });
});
