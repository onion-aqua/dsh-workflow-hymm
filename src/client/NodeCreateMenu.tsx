import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {Translate} from './locales.ts';
import {Icon} from './icons.tsx';
import './node-create-menu.css';

/** Both canvas node types share one creation entry; the flyout escapes the scrolling dock. */
export function NodeCreateMenu({disabled,utilityDisabled,onTask,onUtility,resetKey,t}:{
  disabled:boolean;utilityDisabled:boolean;onTask:()=>void;onUtility:()=>void;resetKey:string;t:Translate;
}){
  const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null);
  const [open,setOpen]=useState(false),[present,setPresent]=useState(false);
  const [anchor,setAnchor]=useState<{container:HTMLElement;left:number;top:number;stacked:boolean}>();
  const menuId=useId();
  const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
  const show=()=>{if(!disabled){setPresent(true);setOpen(true);}};
  useEffect(()=>{close();},[resetKey,disabled]);
  useEffect(()=>{
    if(open||!present)return;
    const timer=setTimeout(()=>setPresent(false),180);return()=>clearTimeout(timer);
  },[open,present]);
  useLayoutEffect(()=>{
    if(!present)return;
    const button=trigger.current,container=button?.closest<HTMLElement>('.dsh-workflow');
    if(!button||!container)return;
    const measure=()=>{
      const root=container.getBoundingClientRect(),rect=button.getBoundingClientRect();
      const left=rect.right-root.left+12,stacked=root.width-left<302;
      setAnchor({container,left,top:Math.max(8,Math.min(rect.top-root.top,root.height-(stacked?100:44)-8)),stacked});
    };
    measure();const observer=new ResizeObserver(measure);observer.observe(container);
    button.closest('.wf-tool-dock')?.addEventListener('scroll',measure);
    return()=>{observer.disconnect();button.closest('.wf-tool-dock')?.removeEventListener('scroll',measure);};
  },[present]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{const target=event.target as Node;if(!trigger.current?.contains(target)&&!menu.current?.contains(target))close();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.isComposing){event.preventDefault();event.stopPropagation();close(true);}};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);};
  },[open]);
  const focusOption=(last=false)=>requestAnimationFrame(()=>{
    const choices=menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    choices?.[last?choices.length-1:0]?.focus();
  });
  return <>
    <button ref={trigger} type="button" className="wf-dock-add" aria-label={t('createNode')} title={t('createNode')} data-testid="node-create-toggle" disabled={disabled}
      aria-haspopup="menu" aria-expanded={open} aria-controls={present?menuId:undefined} onClick={()=>open?close():show()}
      onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(['ArrowRight','ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();if(open&&['Enter',' '].includes(event.key))close(true);else{show();focusOption(event.key==='ArrowUp');}}}}><Icon name="plus" size={26}/></button>
    {present&&anchor&&createPortal(<div ref={menu} id={menuId} role="menu" aria-label={t('createNode')} aria-hidden={!open} data-testid="node-create-menu"
      className={`wf-node-create-menu nodrag nopan ${anchor.stacked?'is-stacked':''}`} data-open={open} style={{left:anchor.left,top:anchor.top}}
      onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}}
      onKeyDown={event=>{
        event.stopPropagation();if(event.nativeEvent.isComposing)return;
        if(event.key==='Tab'){close();return;}
        if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        event.preventDefault();const choices=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current=choices.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(current+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+choices.length)%choices.length;
        choices[next]?.focus();
      }}>
      <button type="button" role="menuitem" data-testid="add-node" tabIndex={open?0:-1} disabled={disabled||!open} onClick={()=>{close();onTask();}}><Icon name="task" size={17}/><span>{t('taskNode')}</span></button>
      <button type="button" role="menuitem" data-testid="add-utility-node" tabIndex={open?0:-1} disabled={disabled||utilityDisabled||!open} onClick={()=>{close();onUtility();}}><Icon name="tool" size={17}/><span>{t('utilityNode')}</span></button>
    </div>,anchor.container)}
  </>;
}
