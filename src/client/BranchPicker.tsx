import { useEffect, useId, useRef, useState } from 'react';
import type { BranchCard } from './ui-contract.ts';
import type { Translate } from './locales.ts';
import { Icon } from './icons.tsx';

/** Uses the same compact listbox behavior as model selection. */
export function BranchPicker({options,value,disabled,onSelect,t}:{options:readonly BranchCard[];value:string;disabled?:boolean;onSelect:(id:string)=>boolean|void;t:Translate}){
  const [open,setOpen]=useState(false),[active,setActive]=useState(0);const id=useId();
  const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const current=options.find(option=>option.id===value);
  const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
  const choose=(id:string)=>{if(!disabled&&onSelect(id)!==false)close(true);};
  useEffect(()=>{if(open)root.current?.querySelector<HTMLButtonElement>(`[data-branch-index="${active}"]`)?.focus();},[open,active]);
  useEffect(()=>{if(disabled)close();},[disabled]);
  useEffect(()=>{if(!open)return;const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))close();};document.addEventListener('pointerdown',outside,true);return()=>document.removeEventListener('pointerdown',outside,true);},[open]);
  const show=(last=false)=>{if(disabled||!options.length)return;setActive(last?options.length-1:Math.max(0,options.findIndex(option=>option.id===value)));setOpen(true);};
  return <div className="wf-branch-picker nodrag nopan nowheel" ref={root} onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
    <button ref={trigger} type="button" className="wf-branch-trigger" role="combobox" data-testid="branch-picker-trigger" aria-label={t('branches')} aria-controls={id} aria-haspopup="listbox" aria-expanded={open} disabled={disabled||!options.length} title={current?.label}
      onClick={()=>open?close():show()} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show(event.key==='ArrowUp');}else if(event.key==='Escape'){event.preventDefault();close();}}}><Icon name="branch" size={14}/><span>{current?.label??t('branches')}</span><Icon name="chevron" size={12} style={{transform:'rotate(90deg)'}}/></button>
    <select hidden aria-hidden="true" tabIndex={-1} data-testid="branch-select" value={value} disabled={disabled} onChange={event=>choose(event.target.value)}>{options.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}</select>
    {open&&<div className="wf-branch-menu" role="listbox" aria-label={t('branches')} id={id} data-testid="branch-picker-options" onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Escape'){event.preventDefault();close(true);}else if(event.key==='Tab')close();else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();setActive(index=>event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);}}}>{options.map((option,index)=><button type="button" key={option.id} role="option" aria-selected={option.id===value} tabIndex={active===index?0:-1} data-branch-index={index} data-value={option.id} data-testid={`branch-option-${option.id}`} className={option.id===value?'is-selected':undefined} onClick={()=>choose(option.id)}><Icon name="branch" size={14}/><span>{option.label}</span>{option.id===value&&<Icon name="check" size={13}/>}</button>)}</div>}
  </div>;
}
