import type { NativeEvent, NativeSessionLog } from './native-runtime.ts';

interface Transaction {checkpoint:number;end:number;turn:number|null}
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const seq=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const same=(a:readonly unknown[],b:readonly unknown[])=>a.length===b.length&&a.every((item,index)=>item===b[index]);
const controlSources=new Set(['model-selection','runtime-context','working-directory','ptc-mode','tool-registry','user-approval','system-prompt','plan-mode','skill-catalog','time-context']);

/** Validate native transaction evidence rather than granting trust to a source label. */
function transactions(log:NativeSessionLog):Transaction[]{
  const events=log.events,bySeq=new Map(events.map(event=>[event.seq,event]));
  const starts=new Map<string,NativeEvent[]>(),ends=new Map<string,NativeEvent[]>(),summaries=new Map<string,NativeEvent[]>(),surfaceBefore=new Map<number,readonly number[]>();
  let nodes:number[]=[];
  for(const event of events){
    const id=event.data.compactionId,map=event.type==='compaction/start'?starts:event.type==='compaction/end'?ends:event.type==='compaction/summary'?summaries:undefined;if(map&&typeof id==='string'&&id)map.set(id,[...map.get(id)??[],event]);
    if(event.type==='user/message'&&object(event.data.source).kind==='compact-checkpoint')surfaceBefore.set(event.seq,nodes);
    const operation=object(event).surfaceOp;
    if(operation==='append')nodes=[...nodes,event.seq];
    else if(object(operation).op==='replace'){
      const start=nodes.indexOf(Number(object(operation).startSeq)),end=nodes.indexOf(Number(object(operation).endSeq));
      if(start<0||end<start)nodes=[];else nodes=[...nodes.slice(0,start),event.seq,...nodes.slice(end+1)];
    }
  }
  const valid:Transaction[]=[];
  for(let index=1;index<events.length;index++){
    const checkpoint=events[index]!,summary=events[index-1]!;
    if(checkpoint.type!=='user/message'||summary.type!=='compaction/summary'||checkpoint.seq!==summary.seq+1)continue;
    const source=object(checkpoint.data.source),id=source.compactionId;
    if(source.kind!=='compact-checkpoint'||typeof id!=='string'||summary.data.compactionId!==id)continue;
    const owners=starts.get(id),closers=ends.get(id);if(owners?.length!==1||closers?.length!==1||summaries.get(id)?.length!==1)continue;
    const start=owners[0]!,end=closers[0]!;
    if(start.seq>=summary.seq||end.seq<=checkpoint.seq||end.data.error!==undefined||start.data.turn!==end.data.turn||start.data.turn!==null&&!seq(start.data.turn))continue;
    if([start.data.sourceCommandId,summary.data.sourceCommandId,end.data.sourceCommandId].some(command=>command!==source.sourceCommandId))continue;
    const shadowed=summary.data.shadowedSeqs,range=object(summary.data.shadowedRange),surface=object(object(checkpoint).surfaceOp),references=object(checkpoint).sourceEventSeqs;
    if(!Array.isArray(shadowed)||!shadowed.length||!shadowed.every(seq)||new Set(shadowed).size!==shadowed.length||!seq(range.start)||!seq(range.end))continue;
    if(shadowed[0]!==range.start||shadowed.at(-1)!==range.end||shadowed.some(value=>value>=start.seq||!bySeq.has(value)))continue;
    const current=surfaceBefore.get(checkpoint.seq)??[],first=current.indexOf(range.start),last=current.indexOf(range.end);
    if(first<0||last<first||!same(shadowed,current.slice(first,last+1)))continue;
    if(surface.op!=='replace'||surface.startSeq!==range.start||surface.endSeq!==range.end||!Array.isArray(references)||!same(references,[start.seq,summary.seq,...shadowed]))continue;
    // A numbered automatic transaction must be inside its actual open turn;
    // standalone manual transactions cannot cross or manufacture a turn.
    let turn:number|undefined,validBracket=true;
    for(const event of events){
      if(event.seq> end.seq)break;
      if(event.type==='turn/start'){if(event.seq>start.seq)validBracket=false;turn=seq(event.data.turn)?event.data.turn:undefined;}
      if(event.seq===start.seq&&((start.data.turn===null&&turn!==undefined)||(start.data.turn!==null&&turn!==start.data.turn)))validBracket=false;
      if(event.type==='turn/end'){if(event.seq>start.seq&&event.seq<end.seq)validBracket=false;turn=undefined;}
    }
    if(!validBracket)continue;
    valid.push({checkpoint:checkpoint.seq,end:end.seq,turn:start.data.turn as number|null});
  }
  return valid;
}

/** Exact native user/message replacement seqs whose full compaction transaction closed successfully. */
export function verifiedCompactionCheckpoints(log:NativeSessionLog):ReadonlySet<number>{return new Set(transactions(log).map(item=>item.checkpoint));}

/** Keep a completed task's native idle compaction suffix when it contains no new task input. */
export function compactionContinuationBoundary(log:NativeSessionLog,completedTurnEndSeq:number):number{
  const boundary=log.events.find(event=>event.seq===completedTurnEndSeq);
  if(boundary?.type!=='turn/end'||object(boundary.data.reason).kind!=='completed')return completedTurnEndSeq;
  const validated=transactions(log),checkpoints=new Set(validated.map(item=>item.checkpoint)),ends=new Set(validated.filter(item=>item.turn===null).map(item=>item.end));
  let result=completedTurnEndSeq;
  for(const event of log.events){
    if(event.seq<=completedTurnEndSeq)continue;
    if(event.type==='turn/start')break;
    if(event.type==='user/message'&&!checkpoints.has(event.seq)&&!controlSources.has(String(object(event.data.source).kind)))break;
    if(ends.has(event.seq))result=event.seq;
  }
  return result;
}
