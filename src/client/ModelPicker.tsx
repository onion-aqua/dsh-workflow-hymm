import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent } from 'react';
import type { ModelOption } from './ui-contract.ts';
import type { Translate } from './locales.ts';
import type { ReasoningStep } from './ReasoningSlider.tsx';
import { ModelReasoningPopover } from './ModelReasoningPopover.tsx';
import { Icon } from './icons.tsx';
import './model-picker.css';

export const MODEL_PICKER_VIEWPORT_EVENT='visual-workflow:viewport-move';
export interface ModelReasoningOption {
  steps: readonly ReasoningStep[];
  value?: string;
  availability?: 'available' | 'unsupported' | 'unknown';
  unavailableMessage?: string;
  highlightLastStep?: boolean;
  disabled?: boolean;
  label?: string;
  isDefault?: boolean;
}
export interface ModelReasoningControls {
  /** Returns verified native reasoning controls for a catalog option. `undefined` means no metadata. */
  reasoningForOption?: (id: string | undefined) => ModelReasoningOption | undefined;
  /** Persists a native effort value. The picker remains open while this promise settles. */
  onReasoningChange?: (id: string | undefined, value: string | undefined) => void | Promise<void>;
}
export function modelOptionKey(model:{provider:string;model:string}|undefined):string|undefined{return model?JSON.stringify([model.provider,model.model]):undefined;}
export function modelOptionLabel(options:readonly ModelOption[],id:string|undefined,fallback:string):string{return id?options.find(option=>option.id===id)?.label??fallback:fallback;}
export function modelChoiceAvailable(model:{provider:string;model:string}|undefined,options:readonly ModelOption[]|undefined,inheritedAvailable:boolean|undefined):boolean{
  return model&&options?options.some(option=>option.id===modelOptionKey(model)&&!option.disabled):inheritedAvailable!==false;
}
function optionLabel(option:ModelOption):string {
  return option.provider&&!option.label.toLocaleLowerCase().includes(option.provider.toLocaleLowerCase())?`${option.label} · ${option.provider}`:option.label;
}

/** One keyboard-accessible menu for global, inherited task and planning models. */
export function ModelPicker({options=[],value,defaultLabel,label,loading,error,disabled,onChange,onRetry,testId,compact=false,t,reasoningForOption,onReasoningChange}:{
  options?:readonly ModelOption[];value?:string;defaultLabel:string;label:string;loading?:boolean;error?:string;
  disabled?:boolean;onChange?:(id:string|undefined)=>void;onRetry?:()=>void;testId:string;compact?:boolean;t:Translate;
  reasoningForOption?:ModelReasoningControls['reasoningForOption'];onReasoningChange?:ModelReasoningControls['onReasoningChange'];
}){
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[active,setActive]=useState(0);
  const [position,setPosition]=useState({left:0,top:0,width:320,maxHeight:320});
  const [reasoning,setReasoning]=useState<{id:string|undefined;anchor:HTMLButtonElement}|null>(null);
  const id=useId(),blocked=Boolean(disabled||loading||!onChange);
  const unavailable=Boolean(value&&!options.some(option=>option.id===value));
  const choices=[{id:'',label:loading?t('modelsLoading'):defaultLabel,disabled:false},...(unavailable?[{id:value!,label:t('modelUnavailable'),disabled:true}]:[]),...options.map(option=>({...option,label:optionLabel(option)}))];
  const current=choices.find(choice=>choice.id===(value??''))??choices[0]!;
  const close=(restoreFocus=false)=>{setOpen(false);setReasoning(null);if(restoreFocus)trigger.current?.focus();};
  const show=(direction=0)=>{
    if(blocked)return;
    const selected=Math.max(0,choices.findIndex(choice=>choice.id===(value??'')));
    const enabled=choices.flatMap((choice,index)=>choice.disabled?[]:[index]);
    const cursor=enabled.indexOf(selected);
    setActive(direction?enabled[Math.max(0,Math.min(enabled.length-1,(cursor<0?0:cursor)+direction))]??0:choices[selected]?.disabled?enabled[0]??0:selected);
    setOpen(true);
  };
  const choose=(choice:string)=>{onChange?.(choice||undefined);close(true);};
  const closeReasoning=(restoreFocus=false)=>{setReasoning(null);if(restoreFocus)reasoning?.anchor.focus();};
  const navigate=(event:KeyboardEvent)=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==='Tab'){close(true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();
    const enabled=choices.flatMap((choice,index)=>choice.disabled?[]:[index]);
    const cursor=enabled.indexOf(active);
    setActive(event.key==='Home'?enabled[0]??0:event.key==='End'?enabled.at(-1)??0:enabled[(cursor+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length]??0);
  };
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
      const viewportWidth=document.documentElement.clientWidth||window.innerWidth,viewportHeight=document.documentElement.clientHeight||window.innerHeight;
      const width=Math.min(Math.max(290,rect.width),420,Math.max(180,viewportWidth-16));
      const below=viewportHeight-rect.bottom-14,above=rect.top-14;
      const upwards=below<Math.min(280,choices.length*40+16)&&above>below;
      const maxHeight=Math.max(48,Math.min(360,upwards?above:below));
      const height=Math.min(maxHeight,menu.current?.scrollHeight||choices.length*40+16);
      setPosition({left:Math.max(8,Math.min(rect.right-width,viewportWidth-width-8)),top:upwards?Math.max(8,rect.top-height-6):rect.bottom+6,width,maxHeight});
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,choices.length,current.label]);
  useEffect(()=>{
    if(!open)return;
    const item=menu.current?.querySelector<HTMLButtonElement>(`[data-model-index="${active}"]`);item?.focus();item?.scrollIntoView?.({block:'nearest'});
  },[open,active]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!root.current?.contains(target)&&!menu.current?.contains(target)&&!document.getElementById(`${id}-reasoning`)?.contains(target))close(false);};
    const moving=()=>close(false);
    document.addEventListener('pointerdown',outside,true);window.addEventListener(MODEL_PICKER_VIEWPORT_EVENT,moving);
    return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener(MODEL_PICKER_VIEWPORT_EVENT,moving);};
  },[open]);
  useEffect(()=>{if(blocked){setOpen(false);setReasoning(null);}},[blocked]);
  useEffect(()=>{
    if(reasoning&&!choices.some(choice=>choice.id===(reasoning.id??'')))setReasoning(null);
  },[reasoning,choices]);
  const openReasoning=(event:{currentTarget:EventTarget|null;preventDefault:()=>void;stopPropagation:()=>void})=>{
    event.preventDefault();event.stopPropagation();
    if(!reasoningForOption)return;
    const element=event.currentTarget as HTMLButtonElement|null;if(!element||element.disabled)return;
    setReasoning({id:(element.getAttribute('data-value')||undefined),anchor:element});
  };
  const reasoningOption=reasoningForOption&&reasoning?reasoningForOption(reasoning.id):undefined;
  return <div ref={root} className={`wf-model-picker nodrag nopan nowheel ${compact?'is-compact':''} ${error?'has-error':''}`} data-testid={`${testId}-container`} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-controls={id} aria-expanded={open} className="wf-model-trigger" data-testid={`${testId}-trigger`} title={error??current.label} disabled={blocked} onClick={()=>open?close(true):show()} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show(event.key==='ArrowDown'?1:-1);}else if(event.key==='Escape'){event.preventDefault();close(true);}}}>
      <Icon name="model" size={compact?12:14}/><span>{current.label}</span><Icon name="chevron" size={12} style={{transform:'rotate(90deg)'}}/>
    </button>
    {/* A non-interactive bridge for existing programmatic clients; the visible UI uses the menu above. */}
    <select hidden aria-hidden="true" tabIndex={-1} data-testid={testId} value={value??''} disabled={blocked} onChange={event=>onChange?.(event.target.value||undefined)}>{choices.map(choice=><option key={choice.id} value={choice.id} disabled={choice.disabled}>{choice.label}</option>)}</select>
    {onRetry&&!compact&&<button type="button" className="wf-icon-button" data-testid={`${testId}-retry`} aria-label={t('reloadModels')} title={error??t('reloadModels')} disabled={loading} onClick={onRetry}><Icon name="retry" size={12}/></button>}
    {open&&createPortal(<>
      <div ref={menu} id={id} role="listbox" aria-label={label} className="wf-model-menu nodrag nopan nowheel" data-testid={`${testId}-options`} style={position} onKeyDown={navigate} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>
        {choices.map((choice,index)=>{
          const canReason=Boolean(reasoningForOption);
          return <button key={choice.id} type="button" role="option" aria-selected={choice.id===(value??'')} aria-haspopup={canReason?'dialog':undefined} aria-keyshortcuts={canReason?'Shift+F10':undefined} disabled={choice.disabled} data-model-index={index} data-value={choice.id} data-testid={`${testId}-option-${index}`} tabIndex={active===index?0:-1} className={choice.id===(value??'')?'is-selected':undefined} title={canReason?`${choice.label} · ${t('reasoningContextMenu')}`:choice.label} onClick={()=>choose(choice.id)} onContextMenu={canReason?openReasoning:undefined} onKeyDown={event=>{if(canReason&&(event.key==='ContextMenu'||(event.key==='F10'&&event.shiftKey))){openReasoning(event);}}}><Icon name="model" size={15}/><span>{choice.label}</span>{choice.id===(value??'')&&<Icon name="check" size={14}/>}</button>;
        })}
      </div>
      {reasoning&&<ModelReasoningPopover key={reasoning.id??'default'} anchor={reasoning.anchor}
        modelLabel={choices.find(choice=>choice.id===(reasoning.id??''))?.label??defaultLabel}
        option={reasoningOption} onChange={onReasoningChange?next=>onReasoningChange(reasoning.id,next):undefined}
        onClose={closeReasoning} testId={testId} panelId={`${id}-reasoning`} t={t}/>}
    </>,document.body)}
  </div>;
}
