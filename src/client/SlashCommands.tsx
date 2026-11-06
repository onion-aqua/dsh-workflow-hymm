import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowSkillOption } from '../shared/model.ts';
import type { Translate } from './locales.ts';
import { Icon } from './icons.tsx';
import './slash-commands.css';

const copy={
  zh:{commands:'斜杠命令',compact:'压缩当前上下文',compactHint:'只压缩当前目标，不发送任务',skills:'搜索原生技能',skillsHint:'输入 /skills 名称筛选已安装技能',loading:'正在读取原生技能…',empty:'没有匹配的原生技能',noCommands:'未找到命令或原生技能',reload:'重新读取技能',tooLong:'插入后会超过输入长度上限，请先缩短正文。',unavailable:'当前没有可压缩的会话',working:'正在压缩上下文…',failed:'命令执行失败',compactArguments:'/compact 不接受参数，请单独输入一行。',searchHint:'输入名称或描述搜索；Enter 选择，Esc 关闭'},
  en:{commands:'Slash commands',compact:'Compact current context',compactHint:'Compact the current target without sending a task',skills:'Search native skills',skillsHint:'Type /skills and a name to search installed skills',loading:'Reading native skills…',empty:'No matching native skills',noCommands:'No matching command or native skill',reload:'Reload skills',tooLong:'Insertion would exceed the input limit. Shorten the text first.',unavailable:'No Session is available to compact',working:'Compacting context…',failed:'Command failed',compactArguments:'/compact takes no arguments. Enter it on its own line.',searchHint:'Search names or descriptions; Enter selects, Esc closes'},
};
interface Match {start:number;end:number;command:string;query:string;mode:'commands'|'skills';key:string}
function lineAt(value:string,caret:number):Match|undefined{
  const start=value.lastIndexOf('\n',Math.max(0,caret-1))+1,following=value.indexOf('\n',caret),end=following<0?value.length:following;
  const line=value.slice(start,end),match=/^[ \t]*\/([^\s]*)(?:[ \t]+(.*))?$/.exec(line);
  if(!match)return;const command=match[1]!.toLowerCase();
  if(match[2]!==undefined&&!['skill','skills','compact'].includes(command))return;
  return {start,end,command,query:match[2]??'',mode:command==='skill'||command==='skills'?'skills':'commands',key:`${start}:${line}`};
}
interface Choice {id:string;label:string;description?:string;kind:'compact'|'skills'|'skill';skill?:WorkflowSkillOption;disabled?:boolean}
interface MenuProps {input:RefObject<HTMLTextAreaElement>;id:string;title:string;hint:string;choices:readonly Choice[];active:number;loading?:string;error?:string;empty:string;reloadLabel:string;onReload?:()=>void;onChoose:(choice:Choice)=>void;onActive:(index:number)=>void;onClose:()=>void}

/** The menu owns no native conversation draft or command store. */
export function SlashCommandMenu({input,id,title,hint,choices,active,loading,error,empty,reloadLabel,onReload,onChoose,onActive,onClose}:MenuProps){
  const root=useRef<HTMLDivElement>(null),[position,setPosition]=useState<{left:number;top:number;width:number;maxHeight:number}>();
  useLayoutEffect(()=>{
    const place=()=>{const rect=input.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(420,Math.max(240,rect.width),innerWidth-24),height=Math.min(290,innerHeight-24),above=rect.top-12,below=innerHeight-rect.bottom-12;const useAbove=above>=Math.min(height,180)||above>below;const maxHeight=Math.max(90,Math.min(height,useAbove?above:below));setPosition({left:Math.max(12,Math.min(rect.left,innerWidth-width-12)),top:useAbove?Math.max(12,rect.top-maxHeight-7):Math.min(innerHeight-maxHeight-12,rect.bottom+7),width,maxHeight});};
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[input]);
  useEffect(()=>{root.current?.querySelector(`[data-slash-index="${active}"]`)?.scrollIntoView?.({block:'nearest'});},[active]);
  useEffect(()=>{const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!root.current?.contains(target)&&target!==input.current)onClose();};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[input,onClose]);
  return createPortal(<div ref={root} className="wf-slash-menu" data-testid="slash-command-menu" id={id} role="listbox" aria-label={title} style={position??{visibility:'hidden'}} onPointerDown={event=>event.stopPropagation()} onMouseDown={event=>event.preventDefault()} onClick={event=>event.stopPropagation()}>
    <header><strong>{title}</strong><small>{hint}</small></header>
    {loading&&<p className="wf-slash-status" role="status">{loading}</p>}
    {error&&<p className="wf-slash-error" role="alert">{error}</p>}
    {choices.map((choice,index)=><button type="button" role="option" id={`${id}-${index}`} aria-selected={index===active} aria-disabled={choice.disabled||undefined} tabIndex={-1} key={choice.id} data-testid={`slash-option-${choice.id}`} data-slash-index={index} className={index===active?'is-active':undefined} onMouseMove={()=>onActive(index)} onClick={()=>onChoose(choice)}><Icon name={choice.kind==='compact'?'collapse':'sparkles'} size={15}/><span><b>{choice.label}</b>{choice.description&&<small>{choice.description}</small>}</span></button>)}
    {!loading&&!error&&!choices.length&&<p className="wf-slash-status">{empty}</p>}
    {onReload&&<button type="button" className="wf-slash-reload" onClick={onReload}><Icon name="retry" size={12}/>{reloadLabel}</button>}
  </div>,document.body);
}

interface Options {value:string;onChange:(value:string)=>void;input:RefObject<HTMLTextAreaElement>;maxLength:number;disabled?:boolean;skills?:readonly WorkflowSkillOption[];skillsLoading?:boolean;skillsError?:string;onReloadSkills?:()=>Promise<void>;canCompact?:boolean;compacting?:boolean;compactUnavailable?:string;onCompact?:()=>Promise<void>;t:Translate}
export function useSlashCommands({value,onChange,input,maxLength,disabled=false,skills=[],skillsLoading=false,skillsError,onReloadSkills,canCompact=false,compacting=false,compactUnavailable,onCompact,t}:Options){
  const c=t('workspace')==='Workflow'?copy.en:copy.zh,id=useId();
  const [caret,setCaret]=useState(value.length),[focused,setFocused]=useState(false),[dismissed,setDismissed]=useState<string>(),[active,setActive]=useState(0),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const composing=useRef(false),latch=useRef(false),requested=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const match=lineAt(value,Math.min(caret,value.length)),open=Boolean(focused&&!disabled&&match&&dismissed!==match.key),working=compacting||pending;
  const close=()=>{setDismissed(match?.key);requested.current=false;};
  const reload=()=>{if(!onReloadSkills)return;setError('');void Promise.resolve().then(()=>onReloadSkills()).catch(cause=>{if(mounted.current)setError(cause instanceof Error?cause.message:c.failed);});};
  useEffect(()=>{if(!open){requested.current=false;return;}if(match?.mode==='skills'&&!requested.current){requested.current=true;reload();}},[open,match?.mode]);
  const query=(match?.mode==='skills'?match.query:match?.command??'').trim().toLocaleLowerCase();
  const choices:Choice[]=[];
  if(match?.mode!=='skills'){
    if('compact'.startsWith(query))choices.push({id:'compact',label:'/compact',description:working?c.working:canCompact?c.compactHint:compactUnavailable??c.unavailable,kind:'compact',disabled:!canCompact||working||!onCompact});
    if('skills'.startsWith(query)||'skill'.startsWith(query))choices.push({id:'skills',label:'/skills',description:c.skillsHint,kind:'skills'});
  }
  if(match?.mode==='skills'||query)for(const skill of skills){if(!skill.name||!`${skill.name} ${skill.description??''}`.toLocaleLowerCase().includes(query))continue;choices.push({id:`skill-${skill.name}`,label:`/${skill.name}`,description:skill.description,kind:'skill',skill});if(choices.length>=40)break;}
  const choiceKey=choices.map(choice=>choice.id).join('\n');
  useEffect(()=>setActive(0),[match?.mode,query,choiceKey]);
  const replace=(range:Match,text:string)=>{const next=value.slice(0,range.start)+text+value.slice(range.end);if(next.length>maxLength){setError(c.tooLong);return false;}onChange(next);setCaret(range.start+text.length);requestAnimationFrame(()=>{if(mounted.current){input.current?.focus();input.current?.setSelectionRange(range.start+text.length,range.start+text.length);}});return true;};
  const compact=async(range:Match)=>{
    if(disabled||latch.current||working)return;
    if(range.query.trim()){setError(c.compactArguments);return;}
    if(!canCompact||!onCompact){setError(compactUnavailable??c.unavailable);return;}
    if(!replace(range,''))return;
    setDismissed(range.key);setError('');latch.current=true;setPending(true);
    try{await onCompact();}catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:c.failed);}finally{latch.current=false;if(mounted.current)setPending(false);}
  };
  const choose=(choice:Choice)=>{if(!match||disabled)return;setError('');if(choice.kind==='compact'){void compact(match);return;}if(choice.kind==='skills'){if(replace(match,'/skills ')){setFocused(true);setDismissed(undefined);requested.current=false;}return;}if(choice.skill&&replace(match,`/${choice.skill.name} `))setDismissed(`${match.start}:/${choice.skill.name} `);};
  const onKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>):boolean=>{
    if(event.nativeEvent.isComposing||composing.current||event.keyCode===229)return true;
    if(open&&['ArrowDown','ArrowUp','Home','End','Escape','Enter'].includes(event.key)&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
      event.preventDefault();event.stopPropagation();
      if(event.key==='Escape')close();else if(event.key==='ArrowDown')setActive(index=>choices.length?(index+1)%choices.length:0);else if(event.key==='ArrowUp')setActive(index=>choices.length?(index-1+choices.length)%choices.length:0);else if(event.key==='Home')setActive(0);else if(event.key==='End')setActive(Math.max(0,choices.length-1));else if(!event.repeat&&choices[active])choose(choices[active]!);
      return true;
    }
    return false;
  };
  const interceptSubmit=():boolean=>{
    if(disabled)return false;
    const reserved=/(?:^|\n)[ \t]*\/(compact|skills?)(?:[ \t][^\n]*)?(?=\n|$)/i.exec(value);
    if(!reserved)return false;const start=reserved.index+(reserved[0]!.startsWith('\n')?1:0),range=lineAt(value,start+reserved[0]!.replace(/^\n/,'').length)!;
    setCaret(range.end);setFocused(true);setDismissed(undefined);
    if(range.command==='compact')void compact(range);
    return true;
  };
  return {
    working,
    onChange:(event:ChangeEvent<HTMLTextAreaElement>)=>{if(disabled)return;onChange(event.target.value.slice(0,maxLength));setCaret(event.target.selectionStart);setDismissed(undefined);setError('');},
    onSelect:()=>setCaret(input.current?.selectionStart??value.length),onFocus:()=>{setFocused(true);setCaret(input.current?.selectionStart??value.length);},onBlur:()=>setFocused(false),
    onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;setCaret(input.current?.selectionStart??value.length);},onKeyDown,interceptSubmit,
    aria:open?{'aria-controls':id,'aria-expanded':true,'aria-activedescendant':choices[active]?`${id}-${active}`:undefined}:{'aria-expanded':false},
    menu:open?<SlashCommandMenu input={input} id={id} title={match?.mode==='skills'?c.skills:c.commands} hint={c.searchHint} choices={choices} active={active} loading={match?.mode==='skills'&&skillsLoading?c.loading:undefined} error={error||(match?.mode==='skills'?skillsError:undefined)} empty={match?.mode==='skills'?c.empty:c.noCommands} reloadLabel={c.reload} onReload={match?.mode==='skills'&&onReloadSkills?reload:undefined} onChoose={choose} onActive={setActive} onClose={close}/>:null,
    feedback:error||working?<p className={`wf-slash-feedback ${error?'is-error':''}`} role={error?'alert':'status'} data-testid="slash-command-feedback">{error||c.working}</p>:null,
  };
}
