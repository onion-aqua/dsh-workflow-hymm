import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowAccessOption } from '../shared/model.ts';
import { MODEL_PICKER_VIEWPORT_EVENT } from './ModelPicker.tsx';
import { Icon } from './icons.tsx';
import { translateZh, type Translate } from './locales.ts';
import './access-mode-picker.css';

export interface AccessModePickerProps {
  options:readonly WorkflowAccessOption[];value?:string;defaultPreset?:string;
  loading?:boolean;error?:string;disabled?:boolean;
  onChange?:(id:string|undefined)=>void|Promise<void>;onReload?:()=>void;t?:Translate;
}

/** Native product labels apply to shipped presets; names configured by the host remain intact. */
export function accessModeLabel(option:WorkflowAccessOption,t:Translate):string{
  if(option.id==='auto')return t('accessAutoReview');
  const builtin={
    'read-only':{key:'accessReadOnly',names:['read-only','read only']},
    'workspace-write':{key:'accessWorkspaceWrite',names:['workspace-write','workspace write']},
    'danger-full-access':{key:'accessFullAccess',names:['danger-full-access','full access']},
  } as const;
  const preset=builtin[option.id as keyof typeof builtin];
  return preset&&preset.names.some(name=>name===option.label.toLowerCase())?t(preset.key):option.label;
}

const shield='M6.59624 2.14853C7.50155 1.80917 8.49914 1.80919 9.40444 2.14859L13.9245 3.84317V7.11961C13.9245 11.6089 10.5565 13.5975 8.00035 14.5779C5.44423 13.5975 2.07544 11.6089 2.07544 7.11961V3.84317L6.59624 2.14853Z';
/** Shipped shield/check, shield/write and shield/alert artwork follows the native permission picker. */
function AccessModeGlyph({preset}:{preset?:string}){
  return <svg aria-hidden="true" data-access-icon={preset??'custom'} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
    {preset==='workspace-write'?<>
      <path d="M6.4209 1.68067C7.43922 1.299 8.56177 1.29898 9.58008 1.68067L14.0996 3.375C14.2946 3.44811 14.4236 3.63455 14.4238 3.84278V6.89063C14.1115 6.71853 13.7761 6.58312 13.4238 6.48926V4.18946L9.22852 2.61621C8.43657 2.31947 7.56341 2.31939 6.77148 2.61621L2.5752 4.18946V7.11914C2.5752 11.1796 5.52369 13.056 8 14.0391C8.27653 13.9293 8.55827 13.8067 8.8418 13.6729C9.07101 13.9468 9.33228 14.1929 9.62012 14.4053C9.12409 14.6579 8.63578 14.8696 8.17871 15.0449C8.0637 15.0889 7.93628 15.0889 7.82129 15.0449C5.22011 14.0472 1.5752 11.9381 1.5752 7.11914V3.84278C1.57541 3.63469 1.70463 3.44821 1.89941 3.375L6.4209 1.68067Z" fill="currentColor" stroke="none"/>
      <path d="M5.26392 6.60339H10.7361M5.26392 9.86902H8.32833"/>
      <path d="M10.0317 13.2229L10.7256 13.733L14.7826 8.64495L13.6777 7.83268L10.0317 13.2229ZM12.6516 12.6696V13.4359L15.2651 13.5527V12.5527L12.6516 12.6696Z" fill="currentColor" stroke="none"/>
    </>:<><path d={shield}/>{preset==='read-only'?<path d="M5.08545 8.13775L7.18455 10.2368C7.26636 10.3187 7.4003 10.3142 7.47649 10.2271L11.5148 5.61194"/>:preset==='danger-full-access'?<path d="M8 4.39209V9.89209M8 10.8081V11.8081"/>:preset==='auto'?<path d="M5.7 10.9L8 5.1L10.3 10.9M6.4 9.2H9.6"/>:null}</>}
  </svg>;
}

interface AccessChoice {id:string;label:string;disabled?:boolean;description?:string;preset?:string;experimental?:boolean}
function AccessMenu({options,value,defaultPreset,loading,error,disabled,onChange,t}:{options:readonly WorkflowAccessOption[];value?:string;defaultPreset?:string;loading?:boolean;error?:string;disabled?:boolean;onChange?:(id:string|undefined)=>void;t:Translate}){
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[active,setActive]=useState(0),[position,setPosition]=useState({left:0,top:0,width:240,maxHeight:320});const id=useId();
  const blocked=Boolean(disabled||loading||!onChange||!options.length),native=options.find(option=>option.id===defaultPreset);
  const nativeLabel=native?accessModeLabel(native,t):undefined;
  const choices:AccessChoice[]=[{id:'',label:t('accessFollowNative'),description:nativeLabel,preset:defaultPreset,experimental:native?.id==='auto'},...options.map(option=>({id:option.id,label:accessModeLabel(option,t),description:option.description,preset:option.id,experimental:option.id==='auto'})),...(value&&!options.some(option=>option.id===value)?[{id:value,label:t('accessUnavailable'),disabled:true}]:[])];
  const current=choices.find(choice=>choice.id===(value??''))??choices[0]!;
  const shownLabel=loading?t('modelsLoading'):!options.length?t('accessUnavailable'):!value&&nativeLabel?nativeLabel:current.label;
  const title=error??(!value&&nativeLabel?`${t('accessFollowNative')} · ${nativeLabel}`:current.description??current.label);
  const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
  const show=(direction=0)=>{if(blocked)return;const enabled=choices.flatMap((choice,index)=>choice.disabled?[]:[index]),selected=Math.max(0,choices.findIndex(choice=>choice.id===(value??''))),cursor=enabled.indexOf(selected);setActive(enabled[Math.max(0,Math.min(enabled.length-1,(cursor<0?0:cursor)+direction))]??0);setOpen(true);};
  const choose=(choice:AccessChoice)=>{if(choice.disabled||blocked)return;onChange?.(choice.id||undefined);close(true);};
  const navigate=(event:KeyboardEvent)=>{
    event.stopPropagation();if(event.nativeEvent.isComposing)return;
    if(event.key==='Escape'){event.preventDefault();close(true);return;}if(event.key==='Tab'){close();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const enabled=choices.flatMap((choice,index)=>choice.disabled?[]:[index]),cursor=enabled.indexOf(active);setActive(event.key==='Home'?enabled[0]??0:event.key==='End'?enabled.at(-1)??0:enabled[(cursor+(event.key==='ArrowDown'?1:-1)+enabled.length)%enabled.length]??0);
  };
  useLayoutEffect(()=>{
    if(!open)return;const place=()=>{const rect=trigger.current?.getBoundingClientRect();if(!rect)return;const vw=document.documentElement.clientWidth||window.innerWidth,vh=document.documentElement.clientHeight||window.innerHeight,width=Math.min(280,Math.max(180,vw-16)),below=vh-rect.bottom-14,above=rect.top-14,up=below<Math.min(280,choices.length*42+12)&&above>below,maxHeight=Math.max(48,Math.min(360,up?above:below)),height=Math.min(maxHeight,menu.current?.scrollHeight||choices.length*42+12);setPosition({left:Math.max(8,Math.min(rect.right-width,vw-width-8)),top:up?Math.max(8,rect.top-height-6):rect.bottom+6,width,maxHeight});};place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open,choices.length,current.label]);
  useEffect(()=>{if(open){const item=menu.current?.querySelector<HTMLButtonElement>(`[data-access-index="${active}"]`);item?.focus();item?.scrollIntoView?.({block:'nearest'});}},[open,active]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!root.current?.contains(target)&&!menu.current?.contains(target))close();},moving=()=>close();document.addEventListener('pointerdown',outside,true);window.addEventListener(MODEL_PICKER_VIEWPORT_EVENT,moving);return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener(MODEL_PICKER_VIEWPORT_EVENT,moving);};},[open]);
  useEffect(()=>{if(blocked)close();},[blocked]);
  return <div ref={root} className={`wf-access-menu-control nodrag nopan nowheel ${error?'has-error':''}`} data-testid="access-mode-picker-container" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
    <button ref={trigger} type="button" role="combobox" aria-label={t('accessMode')} aria-haspopup="listbox" aria-expanded={open} aria-controls={id} className="wf-access-trigger" data-testid="access-mode-picker-trigger" title={title} disabled={blocked} onClick={()=>open?close():show()} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show(event.key==='ArrowDown'?1:-1);}else if(event.key==='Escape'){event.preventDefault();close(true);}}}>
      <AccessModeGlyph preset={current.preset}/><span>{shownLabel}</span>{current.experimental&&<sup className="wf-access-badge">EXP</sup>}<Icon name="chevron" size={11} style={{transform:'rotate(90deg)'}}/>
    </button>
    <select hidden aria-hidden="true" tabIndex={-1} data-testid="access-mode-picker" value={value??''} disabled={blocked} onChange={event=>{const choice=choices.find(item=>item.id===event.target.value);if(choice&&!choice.disabled&&!blocked)onChange?.(choice.id||undefined);}}>{choices.map(choice=><option key={choice.id} value={choice.id} disabled={choice.disabled}>{choice.label}</option>)}</select>
    {open&&createPortal(<div ref={menu} id={id} role="listbox" aria-label={t('accessMode')} className="wf-access-menu nodrag nopan nowheel" data-testid="access-mode-picker-options" style={position} onKeyDown={navigate} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onWheel={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}>{choices.map((choice,index)=><button key={choice.id} type="button" role="option" aria-selected={choice.id===(value??'')} disabled={choice.disabled} data-access-index={index} data-value={choice.id} data-testid={`access-mode-picker-option-${index}`} tabIndex={active===index?0:-1} title={choice.description??choice.label} className={choice.id===(value??'')?'is-selected':undefined} onClick={()=>choose(choice)}><AccessModeGlyph preset={choice.preset}/><span>{choice.label}{choice.id===''&&choice.description&&<small>{choice.description}</small>}</span>{choice.experimental&&<sup className="wf-access-badge">EXP</sup>}{choice.id===(value??'')&&<Icon name="check" size={14}/>}</button>)}</div>,document.body)}
  </div>;
}
/** Session permissions use the native catalogue; following native never changes its global default. */
export function AccessModePicker({options,value,defaultPreset,loading,error,disabled,onChange,onReload,t=translateZh}:AccessModePickerProps){
  const [confirmation,setConfirmation]=useState<WorkflowAccessOption>(),[acknowledged,setAcknowledged]=useState(false),[pending,setPending]=useState(false),[localError,setLocalError]=useState('');
  const latch=useRef(false),heading=useId();
  const apply=async(id:string|undefined)=>{
    if(latch.current||!onChange)return;latch.current=true;setPending(true);setLocalError('');
    try{await onChange(id);setConfirmation(undefined);setAcknowledged(false);}catch(cause){setLocalError(cause instanceof Error?cause.message:String(cause));}finally{latch.current=false;setPending(false);}
  };
  const select=(id:string|undefined)=>{
    const option=options.find(item=>item.id===id);if(id&&!option)return;
    if(option?.sandbox==='danger-full-access'&&id!==value){setConfirmation(option);setAcknowledged(false);setLocalError('');return;}
    void apply(id);
  };
  return <div className="wf-access-picker" data-testid="access-mode-control">
    <AccessMenu options={options} value={value} defaultPreset={defaultPreset} loading={loading} error={localError||error} disabled={disabled||pending} onChange={onChange?select:undefined} t={t}/>
    {onReload&&<button type="button" className="wf-access-reload" aria-label={t('accessReload')} title={localError||error||t('accessReload')} data-testid="access-mode-picker-reload" disabled={loading||pending} onClick={()=>onReload()}><Icon name="retry" size={12}/></button>}
    {confirmation&&createPortal(<div className="wf-access-confirm-overlay nodrag nopan nowheel" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing&&!pending)setConfirmation(undefined);}}>
      <section className="wf-access-confirm" role="dialog" aria-modal="true" aria-labelledby={heading} aria-busy={pending} data-testid="access-mode-confirm">
        <header><AccessModeGlyph preset={confirmation.id}/><h3 id={heading}>{t('accessConfirmTitle')} · {accessModeLabel(confirmation,t)}</h3></header>
        <p>{t('accessConfirmDescription')}</p>{confirmation.description&&<p>{confirmation.description}</p>}<p className="wf-access-scope">{t('accessScopeHint')}</p>
        <label><input type="checkbox" checked={acknowledged} disabled={pending} data-testid="access-mode-acknowledge" onChange={event=>setAcknowledged(event.target.checked)}/><span>{t('accessConfirmAcknowledge')}</span></label>
        {localError&&<p role="alert">{localError}</p>}
        <footer><button type="button" disabled={pending} onClick={()=>setConfirmation(undefined)}>{t('cancel')}</button><button type="button" disabled={!acknowledged||pending} data-testid="access-mode-confirm-apply" onClick={()=>void apply(confirmation.id)}>{pending?t('saving'):t('accessConfirmApply')}</button></footer>
      </section>
    </div>,document.body)}
  </div>;
}
