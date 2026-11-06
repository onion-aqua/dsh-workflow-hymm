import { describe, expect, it } from 'vitest';
import type { NativeSessionLog } from '../src/host/native-runtime.ts';
import { projectExecution } from '../src/host/trace-projector.ts';

const message=(rpcId:string)=>({id:rpcId,source:{kind:'user',rpcId},content:[{type:'text',text:rpcId}]});
const reply=(callId:string,outcome='answered',kind='user-question-reply')=>({id:`reply-${callId}-${outcome}-${kind}`,source:{kind,callId,outcome},content:[{type:'text',text:'Human answer'}]});
const assistant=(turn:number,text:string)=>({turn,step:1,message:{content:[{type:'reasoning',text:'PRIVATE_QUESTION_REASONING'},{type:'text',text}]}});
function log(events:Array<[string,Record<string,unknown>]>,inheritedEventCount=0):NativeSessionLog{return {sessionId:'question-projection',header:{id:'question-projection',createdAt:1,isSeeded:inheritedEventCount>0},inheritedEventCount,events:events.map(([type,data],seq)=>({type,data,seq,time:1000+seq}))};}
const question=(callId:string)=>({turn:1,step:1,callId,name:'ask_user_question',arguments:JSON.stringify({questions:[{id:'choice',question:'Choose a route'}]})});
const pending=(callId:string)=>({turn:1,step:1,message:{toolCallId:callId,content:[{type:'text',text:'{"pending":true}'}]}});
const end=(turn:number)=>({turn,reason:{kind:'completed'}});
const identity={runId:'question-run',requestId:'original-request',running:false};

describe('native question reply execution projection',()=>{
  it('extends only the original owned ask call into its explicit native reply turn without copying model reasoning',()=>{
    const native=log([['turn/start',{turn:1}],['user/message',message('original-request')],['step/start',{turn:1,step:1}],['tool/call',question('own-question')],['tool/result',pending('own-question')],['assistant/message',assistant(1,'Original useful work')],['turn/end',end(1)],['turn/start',{turn:2}],['user/message',reply('own-question')],['step/start',{turn:2,step:1}],['assistant/message',assistant(2,'Reply continuation result')],['turn/end',end(2)]]);
    const result=projectExecution(native,identity);expect(result).toMatchObject({turns:[1,2],status:'completed',endSeq:11,assistantText:'Original useful work\nReply continuation result'});expect(JSON.stringify(result)).not.toContain('PRIVATE_QUESTION_REASONING');
    native.events.splice(-1);const running=projectExecution(native,{...identity,running:true});expect(running).toMatchObject({turns:[1,2],status:'running'});expect(running.endSeq).toBeUndefined();
  });
  it('never extends ownership for a foreign call, wrong source kind or non-answered reply outcome',()=>{
    for(const bad of [reply('foreign-question'),reply('own-question','answered','plugin'),reply('own-question','cancelled')]){
      const native=log([['turn/start',{turn:1}],['user/message',message('original-request')],['tool/call',question('own-question')],['tool/result',pending('own-question')],['assistant/message',assistant(1,'Original')],['turn/end',end(1)],['turn/start',{turn:2}],['user/message',bad],['assistant/message',assistant(2,'FOREIGN_REPLY_OUTPUT')],['turn/end',end(2)]]);
      expect(projectExecution(native,identity)).toMatchObject({turns:[1],status:'completed',endSeq:5,assistantText:'Original'});expect(JSON.stringify(projectExecution(native,identity))).not.toContain('FOREIGN_REPLY_OUTPUT');
    }
  });
  it('does not treat a native reply to an inherited parent question as belonging to a child execution',()=>{
    const native=log([['turn/start',{turn:1}],['user/message',message('parent-request')],['tool/call',question('parent-question')],['tool/result',pending('parent-question')],['turn/end',end(1)],['turn/start',{turn:2}],['user/message',{id:'native-child-message',source:{kind:'user'},content:[{type:'text',text:'Child task'}]}],['tool/call',{...question('child-question'),turn:2}],['tool/result',{...pending('child-question'),turn:2}],['turn/end',end(2)],['turn/start',{turn:3}],['user/message',reply('parent-question')],['assistant/message',assistant(3,'PARENT_REPLY_ONLY')],['turn/end',end(3)],['turn/start',{turn:4}],['user/message',reply('child-question')],['assistant/message',assistant(4,'Child continuation')],['turn/end',end(4)]],5);
    const result=projectExecution(native,{runId:'child-run',requestId:'no-native-rpc',messageId:'native-child-message',running:false});expect(result).toMatchObject({turns:[2,4],status:'completed',endSeq:17,assistantText:'Child continuation'});expect(JSON.stringify(result)).not.toContain('PARENT_REPLY_ONLY');
  });
  it('attributes an explicitly answered PTC question sub-call to its owning request',()=>{
    const native=log([['turn/start',{turn:1}],['user/message',message('original-request')],['step/start',{turn:1,step:1}],['tool/call',{turn:1,step:1,callId:'ptc-parent',name:'ptc',arguments:'{}'}],['tool/ptc-dispatch-start',{turn:1,step:1,parentCallId:'ptc-parent',subCallId:'ptc-question',name:'ask_user_question',arguments:'{"questions":[{"id":"q","question":"Continue?"}]}'}],['tool/ptc-dispatch',{turn:1,step:1,parentCallId:'ptc-parent',subCallId:'ptc-question',name:'ask_user_question',content:[{type:'text',text:'{"pending":true}'}],isError:false}],['turn/end',end(1)],['turn/start',{turn:2}],['user/message',reply('ptc-question')],['assistant/message',assistant(2,'PTC question answered')],['turn/end',end(2)]]);
    const result=projectExecution(native,identity);expect(result).toMatchObject({turns:[1,2],status:'completed',assistantText:'PTC question answered'});expect(result.steps.find(step=>step.callId==='ptc-question')).toMatchObject({toolName:'ask_user_question'});
  });
  it('keeps multiple separately answered question calls inside the same execution identity',()=>{
    const native=log([['turn/start',{turn:1}],['user/message',message('original-request')],['tool/call',question('question-a')],['tool/result',pending('question-a')],['tool/call',question('question-b')],['tool/result',pending('question-b')],['turn/end',end(1)],['turn/start',{turn:2}],['user/message',reply('question-a')],['assistant/message',assistant(2,'First answer processed')],['turn/end',end(2)],['turn/start',{turn:3}],['user/message',reply('question-b')],['assistant/message',assistant(3,'Second answer processed')],['turn/end',end(3)]]);
    expect(projectExecution(native,identity)).toMatchObject({turns:[1,2,3],status:'completed',endSeq:14,assistantText:'First answer processed\nSecond answer processed'});
  });
});
