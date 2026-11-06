/** Test-only local model transport. Never included in the installed plugin package. */
import { LlmAdapter, ToolCallId } from 'file:///C:/Users/cheny/AppData/Local/Programs/DeepSeek%20Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
export const inject=['llm','tools','workspaceRegistry','skills'];
const parallelBatches=new Map();
/** Keep a pair observable until both real native model requests have arrived.
 * A broken second admission still times out; tests cannot pass on a sleep race. */
async function waitForParallelPair(prompt,signal){
  const key=prompt.includes('CHILD_ONLY_')?'children':prompt.includes('AUTO_')?'auto':'parallel';
  let batch=parallelBatches.get(key);
  if(!batch){let release;const promise=new Promise(resolve=>{release=resolve});batch={promise,release,count:0,timer:setTimeout(()=>{parallelBatches.delete(key);release();},15000)};parallelBatches.set(key,batch);}
  batch.count++;
  if(batch.count===2){clearTimeout(batch.timer);parallelBatches.delete(key);batch.release();}
  await batch.promise;signal?.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,1000));
}
class LocalWorkflowModel extends LlmAdapter {
  async listModels(provider){return ['model-a','model-b'].map(id=>({provider,id,name:id==='model-a'?'Local Test Model A':'Local Test Model B'}));}
  async resolveModel(provider,model){return {...await super.resolveModel(provider,model),context:{contextWindow:128000},defaultMaxTokens:2000};}
  async *stream(options){
    options.signal?.throwIfAborted();
    if(options.purpose==='compaction'){
      const text='<compacted-summary>LOCAL_COMPACTION_CHECKPOINT: preserve the user requirements and verified task results.</compacted-summary>';
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'usage',usage:{inputTokens:4000,outputTokens:40}};yield {type:'finish',reason:{kind:'stop'}};return;
    }
    const user=options.messages.findLast(message=>message.role==='user'&&'source' in message&&message.source?.kind==='user');
    const prompt=user?.content.filter(block=>block.type==='text').map(block=>block.text).join('')??'';
    if(prompt.includes('MODEL_FAILURE'))throw new Error('Intentional local model transport failure for Workflow UI regression');
    if(prompt.includes('WORKFLOW_APPROVAL_TEST')){
      const results=options.messages.slice(options.messages.findLastIndex(message=>message===user)+1).filter(message=>message.role==='tool');
      if(!results.length){
        const name='workflow_safe_approval_test',args={command:'echo controlled zero-side-effect fixture'},direct=options.tools?.some(tool=>tool.name===name);
        const block={type:'tool-call',id:ToolCallId(`workflow-approval-${options.messages.length}`),name:direct?name:'run_code',arguments:JSON.stringify(direct?args:{code:`console.log(await tools.${name}(${JSON.stringify(args)}));`,description:'Review the safe local Workflow approval fixture'})};
        yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};return;
      }
      const text=`WORKFLOW_APPROVAL_RESULT\n${results.flatMap(message=>message.content).filter(block=>block.type==='text').map(block=>block.text).join('\n')}`;
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};return;
    }
    if(prompt.includes('WORKFLOW_QUESTION_TEST')){
      const results=options.messages.slice(options.messages.findLastIndex(message=>message===user)+1).filter(message=>message.role==='tool');
      if(!results.length){
        const questions=[{id:'city-scope',header:'确认城市范围',question:'请选择本地测试的城市范围。',options:[{label:'仅杭州（推荐）',description:'只查询一个城市'},{label:'杭州 + 宁波',description:'查询两个城市'}]}];
        if(prompt.includes('MULTI'))questions.push({id:'output-fields',header:'选择字段',question:'需要哪些字段？可多选。',options:[{label:'温度'},{label:'湿度'},{label:'风力'}],multi_select:true});
        const direct=options.tools?.some(tool=>tool.name==='ask_user_question');
        const args=direct?{questions}:{code:`const result = await tools.ask_user_question(${JSON.stringify({questions})}); console.log(JSON.stringify(result));`,description:'Ask for the local Workflow test choices'};
        yield {type:'block-start',index:0,blockType:'tool-call'};
        yield {type:'block-end',index:0,block:{type:'tool-call',id:ToolCallId(`workflow-question-${options.messages.length}`),name:direct?'ask_user_question':'run_code',arguments:JSON.stringify(args)}};
        yield {type:'finish',reason:{kind:'tool-calls'}};return;
      }
      const text=`WORKFLOW_QUESTION_ANSWER_RECEIVED\n${results.flatMap(message=>message.content).filter(block=>block.type==='text').map(block=>block.text).join('\n')}`;
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};return;
    }
    let attachmentEvidence;
    if(prompt.startsWith('You are drafting')&&prompt.includes('PLAN_NATIVE_ATTACHMENT')){
      const userIndex=options.messages.findLastIndex(message=>message===user);
      const results=options.messages.slice(userIndex+1).filter(message=>message.role==='tool');
      if(!results.length){
        const paths=[...prompt.matchAll(/verbatim read-only copy saved at ("(?:\\.|[^"\\])*")/g)].map(match=>JSON.parse(match[1]));
        if(!paths.length)throw new Error('PLAN_NATIVE_ATTACHMENT needs real native uploaded file handles.');
        for(const [index,path] of paths.entries()){
          yield {type:'block-start',index,blockType:'tool-call'};
          yield {type:'block-end',index,block:{type:'tool-call',id:ToolCallId(`workflow-plan-read-${index}`),name:'read',arguments:JSON.stringify({file_path:path})}};
        }
        yield {type:'finish',reason:{kind:'tool-calls'}};return;
      }
      if(results.some(result=>result.isError))throw new Error('The real native planning attachment read failed.');
      attachmentEvidence=results.flatMap(message=>message.content).filter(block=>block.type==='text').map(block=>block.text).join('\n').slice(0,12000);
      if(!attachmentEvidence)throw new Error('Native planning file reads returned no text evidence.');
    }
    const text=prompt.startsWith('You are drafting')&&prompt.includes('PLAN_QUERY_OUTCOME')?JSON.stringify({tasks:[
      {id:'province-weather',title:'确认城市范围并查询天气',instruction:'LOCAL_FIXTURE：先确认浙江省“一线城市”的口径和名单，无法确定时先询问用户；确认后查询这些城市的当前天气，列出时间和来源。',dependsOn:[]},
      {id:'ningbo-weather',title:'查询宁波天气并汇总',instruction:'LOCAL_FIXTURE：上一步完成后查询宁波当前天气，返回时间、天气、温度及来源，并简要汇总两次查询。',dependsOn:['province-weather']},
    ]}):prompt.startsWith('You are drafting')&&prompt.includes('PLAN_OMITTED_DEPENDENCIES')?JSON.stringify({tasks:[
      {id:'research',title:'检查缺省依赖',instruction:'LOCAL_FIXTURE：模型有意漏写依赖字段，仅用于回归测试。'},
      {id:'report',title:'保留明确依赖',instruction:'LOCAL_FIXTURE：使用首个任务结果。',dependsOn:['research']},
    ]}):prompt.startsWith('You are drafting')?JSON.stringify({tasks:[
      {id:'research',title:'调研需求',instruction:attachmentEvidence?`PLAN_NATIVE_ATTACHMENT_READ：\n${attachmentEvidence}`:'LOCAL_FIXTURE：检查需求并记录验收点。',dependsOn:[]},
      {id:'implement',title:'实现与验收',instruction:'LOCAL_FIXTURE：根据调研结果完成实现并验收。',dependsOn:['research']},
    ]}):prompt.includes('WORKFLOW_CONTEXT_TEST')?`Local native model ${options.model}: task completed. ${'CONTROLLED_WORKFLOW_CONTEXT_EVIDENCE '.repeat(90)}`:`Local native model ${options.model}: task completed.`;
    if(prompt.includes('SUBAGENT_PARALLEL_TEST'))await waitForParallelPair(prompt,options.signal);
    else await new Promise(resolve=>setTimeout(resolve,150));
    options.signal?.throwIfAborted();
    yield {type:'block-start',index:0,blockType:'text'};
    yield {type:'text-delta',index:0,text};
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'usage',usage:{inputTokens:2000,outputTokens:500}};
    yield {type:'finish',reason:{kind:'stop'}};
  }
}
export async function apply(ctx){
  await ctx.workspaceRegistry.create('C:/Users/cheny/Documents/Codex/2026-11-03/dui/work/dsh-workflow-plugin/artifacts/magnetic-ports-home/utility-workspace','Workflow工具测试');
  ctx.llm.registerAdapter(['workflow-test'],new LocalWorkflowModel());
  ctx.skills.register({name:'workflow-browser-skill',description:'Controlled native skill for Workflow slash integration',source:'runtime',content:'WORKFLOW_NATIVE_SKILL_MARKER: preserve the selected task goal.',invocation:{userInvocable:true,modelInvocable:false}});
  ctx.on('tools/pre-execute',async(exec,next)=>exec.name==='workflow_safe_approval_test'?{kind:'ask',reason:'Review controlled zero-side-effect fixture'}:next());
  ctx.tools.register({name:'workflow_safe_approval_test',description:'Controlled native approval test',parameters:{type:'object',properties:{command:{type:'string'}}},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:String(value)}]},execute:async()=> 'WORKFLOW_APPROVAL_EXECUTED: verified zero-side-effect native tool'});
}
