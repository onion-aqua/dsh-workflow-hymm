import { useEffect, useId, useRef, useState } from 'react';
import type { WorkflowRuntimeProps } from './ui-contract.ts';
import type { Translate } from './locales.ts';
import { Icon } from './icons.tsx';
import './context-capacity.css';

interface Props extends Pick<WorkflowRuntimeProps,'contextUsage'|'contextLoading'|'contextError'|'compacting'|'onCompactContext'> { t:Translate }
const copy={
  zh:{title:'上下文容量',unknown:'—',loading:'正在读取容量…',target:'当前目标',tokens:'已使用 / 总容量',projected:'估计值 · 原生 Session 事件投影',pressure:'原生上下文容量统计',unavailable:'容量暂不可用',compact:'压缩当前上下文',compacting:'正在压缩…',readOnly:'原始来源会话只读',configuration:'模型配置诊断',summaryModel:'摘要模型',lastCompacted:'上次压缩',noTarget:'当前没有可压缩的会话',close:'关闭',failed:'压缩失败',automatic:'原生自动压缩',manual:'主动压缩',available:'可用',unavailableCapability:'不可用'},
  en:{title:'Context capacity',unknown:'—',loading:'Reading capacity…',target:'Current target',tokens:'Used / capacity',projected:'Estimated from native Session events',pressure:'Native context capacity statistics',unavailable:'Capacity unavailable',compact:'Compact current context',compacting:'Compacting…',readOnly:'The source Session is read only',configuration:'Model configuration',summaryModel:'Summary model',lastCompacted:'Last compacted',noTarget:'No Session is available to compact',close:'Close',failed:'Compaction failed',automatic:'Native automatic compaction',manual:'Manual compaction',available:'Available',unavailableCapability:'Unavailable'},
};

/** Capacity is a native observation; absent measurements never become a made-up percentage. */
export function ContextCapacity({contextUsage:usage,contextLoading=false,contextError,compacting=false,onCompactContext,t}:Props){
  const c=t('workspace')==='Workflow'?copy.en:copy.zh;
  const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[actionError,setActionError]=useState('');
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),latch=useRef(false),mounted=useRef(true);const id=useId();
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{setActionError('');},[usage?.sessionId]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[open]);
  const used=usage?.usedTokens,capacity=usage?.capacityTokens;
  const known=Number.isFinite(used)&&used!>=0&&Number.isFinite(capacity)&&capacity!>0;
  const percentage=known?used!/capacity!*100:undefined;
  const number=(value:number|undefined)=>Number.isFinite(value)&&value!>=0?Math.round(value!).toLocaleString():c.unknown;
  const label=percentage===undefined?c.unknown:`${Math.round(percentage)}%`;
  const working=pending||compacting||Boolean(usage?.compacting);
  const source=usage?.source==='projected'?c.projected:usage?.source==='pressure'?c.pressure:c.unavailable;
  const explanation=contextError??usage?.configurationIssue??usage?.unavailableReason;
  const canCompact=Boolean(onCompactContext&&usage?.sessionId&&usage.canCompact&&!usage.readOnly&&!working&&!contextLoading);
  const compact=async()=>{if(!canCompact||latch.current)return;latch.current=true;setPending(true);setActionError('');try{await onCompactContext!();}catch(error){if(mounted.current)setActionError(error instanceof Error?error.message:c.failed);}finally{latch.current=false;if(mounted.current)setPending(false);}};
  const summary=usage?.summaryModel;
  const summaryLabel=typeof summary==='string'?summary:summary?`${summary.provider} / ${summary.model}`:undefined;
  return <div className="wf-context-capacity" ref={root} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();setOpen(false);trigger.current?.focus();}}}>
    <button ref={trigger} type="button" className={`wf-context-trigger ${working?'is-compacting':''} ${contextError?'is-error':''}`} data-testid="context-capacity-trigger" aria-label={`${c.title} · ${label}`} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" aria-busy={working||contextLoading} title={`${c.title} · ${label}\n${usage?.label??c.noTarget}\n${contextLoading?c.loading:source}${explanation?`\n${explanation}`:''}`} onClick={()=>setOpen(value=>!value)}>
      <svg viewBox="0 0 36 36" aria-hidden="true"><circle className="wf-context-track" cx="18" cy="18" r="15"/><circle className="wf-context-progress" cx="18" cy="18" r="15" pathLength="100" strokeDasharray={`${percentage===undefined?0:Math.min(100,Math.max(0,percentage))} 100`}/></svg><span data-testid="context-capacity-value">{working?<Icon name="retry" size={13}/>:label}</span>
    </button>
    {open&&<section className="wf-context-popover" role="dialog" aria-label={c.title} id={id} data-testid="context-capacity-popover">
      <header><strong>{c.title}</strong><button type="button" className="wf-icon-button" aria-label={c.close} onClick={()=>{setOpen(false);trigger.current?.focus();}}><Icon name="close" size={14}/></button></header>
      <dl><dt>{c.target}</dt><dd data-testid="context-target-label">{usage?.label??c.noTarget}</dd><dt>{c.tokens}</dt><dd data-testid="context-token-count">{number(used)} / {number(capacity)}</dd></dl>
      <p className="wf-context-source" data-testid="context-usage-source">{contextLoading?c.loading:source}</p>
      {usage?.readOnly&&<p className="wf-context-note">{c.readOnly}</p>}
      {usage?.unavailableReason&&<p className="wf-context-note" data-testid="context-unavailable">{usage.unavailableReason}</p>}
      {usage?.configurationIssue&&<p className="wf-context-diagnostic" data-testid="context-configuration"><b>{c.configuration}</b>{usage.configurationIssue}</p>}
      {usage?.autoAvailable!==undefined&&<p className="wf-context-note">{c.automatic} · {usage.autoAvailable?c.available:c.unavailableCapability}</p>}
      {usage?.capabilitiesKnown===false&&<p className="wf-context-note">{c.automatic} · {c.unknown}</p>}
      {usage?.manualAvailable!==undefined&&<p className="wf-context-note">{c.manual} · {usage.manualAvailable?c.available:c.unavailableCapability}</p>}
      {summaryLabel&&<p className="wf-context-note">{c.summaryModel} · {summaryLabel}</p>}
      {usage?.lastCompactedAt&&<p className="wf-context-note">{c.lastCompacted} · {new Date(usage.lastCompactedAt).toLocaleString()}</p>}
      {(contextError||actionError)&&<p className="wf-context-error" role="alert">{actionError||contextError}</p>}
      <button type="button" className="wf-button wf-context-compact" data-testid="compact-context" disabled={!canCompact} onClick={()=>void compact()}><Icon name={working?'retry':'collapse'} size={14}/>{working?c.compacting:c.compact}</button>
    </section>}
  </div>;
}
