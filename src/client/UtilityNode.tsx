import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {NodeResizeControl} from '@xyflow/react';
import type {Node,NodeProps} from '@xyflow/react';
import type {WorkflowUtilityNode} from '../shared/model.ts';
import type {SessionRootCard} from './ui-contract.ts';
import type {Translate} from './locales.ts';
import {Icon} from './icons.tsx';
import {utilityAbsolutePath,utilityBrowserUrl,utilityFileAddress} from './native-utility.ts';
import type {NativeUtilityBridge,UtilityDirectory,UtilityFileText,UtilityShell,UtilityTerminalBinding,UtilityTerminalState,UtilityTerminalView} from './native-utility.ts';
import './utility-node.css';
import '@xterm/xterm/css/xterm.css';

type UtilityNodeModel=WorkflowUtilityNode&{terminal?:UtilityTerminalBinding};
type Tool='files'|'terminal'|'browser'|'tools';
export interface UtilityNodeData extends Record<string,unknown> {
  utility:UtilityNodeModel;workflowId:string;sessions:readonly SessionRootCard[];defaultSessionId?:string;
  bridge?:NativeUtilityBridge;busy?:boolean;t?:Translate;
  focused?:boolean;
  onFocusUtility?:(id:string)=>void;
  onChangeUtility:(id:string,patch:Partial<UtilityNodeModel>)=>void;
  onRemoveUtility:(id:string)=>void;
  onMenu?:(id:string,point:{clientX:number;clientY:number})=>void;
}
export type UtilityFlowNode=Node<UtilityNodeData,'utility'>;
const copy={
  zh:{files:'工作区文件',terminal:'终端',browser:'浏览器',tools:'更多工具',utility:'多功能节点',title:'多功能节点名称',remove:'移除多功能节点',session:'Session',selectSession:'请选择 Session',sessionRequired:'选择已有 Session 后使用工作区工具。',sessionLocked:'终端已绑定此 Session；结束终端后可切换。',missing:'当前 DSH 未提供此原生服务。',refresh:'刷新',up:'上一级',loading:'正在加载…',empty:'此目录为空。',truncated:'目录条目超出原生上限，请进入子目录查看。',openFile:'选择文件以预览。',readOnly:'原生 API 提供只读文件预览；写入请使用终端。',nextPage:'下一页',previousPage:'上一页',copy:'复制',native:'在原生资源查看器打开',startTerminal:'启动终端',restoreTerminal:'恢复终端',endTerminal:'结束终端',retry:'重试连接',shell:'Shell',terminalIdle:'启动真实系统 Shell，输入和输出通过 DSH 原生 PTY。',terminalContinue:'隐藏或切换画布会保留进程。',chooseShell:'加载 Shell',address:'网页地址',go:'前往',back:'后退',forward:'前进',browserNote:'部分站点禁止内嵌；仅在页面允许时显示内容。',browserEmpty:'输入 HTTP / HTTPS 地址以浏览网页。',nativeTools:'DSH 已注册工具',noTools:'当前没有已注册工具。',notEmbeddable:'当前原生插件没有公开节点内渲染 API。',openNative:'在原生界面打开',resize:'调整多功能节点大小',closePreview:'关闭预览',fileTooLarge:'图片超过 10 MiB，请在原生查看器中打开。'},
  en:{files:'Workspace files',terminal:'Terminal',browser:'Browser',tools:'More tools',utility:'Utility node',title:'Utility node title',remove:'Remove utility node',session:'Session',selectSession:'Select a Session',sessionRequired:'Select an existing Session to use workspace tools.',sessionLocked:'End this terminal before changing its Session.',missing:'This native service is unavailable in DSH.',refresh:'Refresh',up:'Parent directory',loading:'Loading…',empty:'This directory is empty.',truncated:'The native directory entry limit was reached. Open a subdirectory.',openFile:'Select a file to preview.',readOnly:'The native API provides read-only previews. Use the terminal to write files.',nextPage:'Next page',previousPage:'Previous page',copy:'Copy',native:'Open in native resource viewer',startTerminal:'Start terminal',restoreTerminal:'Restore terminal',endTerminal:'End terminal',retry:'Reconnect',shell:'Shell',terminalIdle:'Start a real system shell through the native DSH PTY.',terminalContinue:'Hiding or switching canvases keeps its process alive.',chooseShell:'Load shells',address:'Web address',go:'Go',back:'Back',forward:'Forward',browserNote:'Some sites block embedding. Content is shown only when the site permits it.',browserEmpty:'Enter an HTTP / HTTPS address to browse.',nativeTools:'Registered DSH tools',noTools:'No registered tools are available.',notEmbeddable:'This native plugin has no public API for rendering inside a node.',openNative:'Open in native UI',resize:'Resize utility node',closePreview:'Close preview',fileTooLarge:'Image exceeds 10 MiB. Open it in the native viewer.'},
};
type Copy=typeof copy.zh;
function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}

/** A canvas utility is a resource surface, never an executable workflow task. Deliberately no Handles. */
export function UtilityNode({data,id,selected}:NodeProps<UtilityFlowNode>){
  const {utility,bridge}=data;const c:Copy=data.t?.('workspace')==='Workflow'?copy.en:copy.zh;
  const focused=data.focused===true;
  const tab=utility.activeTool??'files';const binding=utility.terminal;
  const sessionId=binding?.sessionId??utility.sessionId??data.defaultSessionId??'';
  const session=data.sessions.find(item=>item.sessionId===sessionId);
  const [resourceError,setResourceError]=useState('');
  useEffect(()=>{if(!binding||!bridge?.terminalAvailable)return;try{bridge.terminal(binding.sessionId,`workflow-utility:${data.workflowId}:${id}`,binding.contentId,binding);setResourceError('');}catch(error){setResourceError(errorMessage(error));}},[bridge,data.workflowId,id,binding?.id,binding?.sessionId,binding?.contentId]);
  const setTool=(tool:Tool)=>data.onChangeUtility(id,{activeTool:tool});
  return <article className={`wf-utility ${focused?'is-selected is-focused':'is-inactive'}`} data-testid={`utility-node-${id}`} data-node-id={id} data-focused={focused} tabIndex={focused?-1:0} aria-label={utility.title} onKeyDown={event=>{if(!focused&&(event.key==='Enter'||event.key===' ')&&!event.nativeEvent.isComposing){event.preventDefault();event.stopPropagation();data.onFocusUtility?.(id);}}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();data.onMenu?.(id,{clientX:event.clientX,clientY:event.clientY});}}>
    <header className="wf-utility-drag" data-testid={`utility-drag-${id}`}><Icon name="task" size={13}/><input aria-label={c.title} className="nodrag nopan" data-testid={`utility-title-${id}`} value={utility.title} disabled={data.busy||!focused} maxLength={120} onChange={event=>data.onChangeUtility(id,{title:event.target.value})} onKeyDown={event=>event.stopPropagation()}/><span className="wf-utility-drag-space" aria-hidden="true"/><button type="button" className="wf-icon-button nodrag nopan" aria-label={c.remove} title={c.remove} disabled={data.busy||!focused} onClick={event=>{event.stopPropagation();data.onRemoveUtility(id);}}><Icon name="close" size={15}/></button></header>
    <div className="wf-utility-content nodrag nopan nowheel" ref={element=>{if(element)element.inert=!focused;}} onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
      <nav className="wf-utility-tabs" aria-label={c.utility}>{(['files','terminal','browser','tools'] as const).map(tool=><button key={tool} type="button" data-testid={`utility-tab-${tool}-${id}`} aria-selected={tab===tool} role="tab" onClick={()=>setTool(tool)}><Icon name={tool==='files'?'file':tool==='browser'?'globe':tool==='tools'?'tool':'terminal'} size={13}/>{c[tool]}</button>)}</nav>
      <div className="wf-utility-session"><label>{c.session}<select aria-label={c.session} data-testid={`utility-session-${id}`} value={sessionId} disabled={Boolean(binding)||data.busy} onChange={event=>data.onChangeUtility(id,{sessionId:event.target.value||undefined})}><option value="">{c.selectSession}</option>{sessionId&&!session&&<option value={sessionId}>{sessionId}</option>}{data.sessions.map(item=><option key={item.sessionId} value={item.sessionId}>{item.title||item.sessionId}</option>)}</select></label>{binding&&<span title={c.sessionLocked}><Icon name="link" size={12}/></span>}</div>
      <div className="wf-utility-body">
        {resourceError&&<p className="wf-utility-error" role="alert">{resourceError}</p>}
        {tab==='files'&&(!sessionId?<p className="wf-utility-empty">{c.sessionRequired}</p>:!bridge?.filesAvailable?<p className="wf-utility-empty">{c.missing}</p>:<WorkspaceFiles key={sessionId} sessionId={sessionId} cwd={session?.cwd} bridge={bridge} c={c}/>)}
        {tab==='terminal'&&(!sessionId?<p className="wf-utility-empty">{c.sessionRequired}</p>:!bridge?.terminalAvailable?<p className="wf-utility-empty">{c.missing}</p>:<UtilityTerminal key={`${sessionId}:${binding?.id??'new'}`} sessionId={sessionId} occurrence={`workflow-utility:${data.workflowId}:${id}`} contentId={binding?.contentId??`dsh-workflow-utility:${data.workflowId}:${id}:${sessionId}`} binding={binding} bridge={bridge} interactive={focused} onBinding={terminal=>data.onChangeUtility(id,{terminal})} c={c}/>)}
        {tab==='browser'&&<UtilityBrowser sessionId={sessionId} bridge={bridge} c={c}/>}
        {tab==='tools'&&<UtilityTools bridge={bridge} sessionId={sessionId} onTool={setTool} c={c}/>}
      </div>
    </div>
    {!focused&&<div className="wf-utility-activation" data-testid={`utility-activation-${id}`} aria-hidden="true"/>}
    {focused&&<NodeResizeControl position="bottom-right" minWidth={360} minHeight={260} maxWidth={1800} maxHeight={1400} autoScale={false} className="wf-utility-resize nodrag nopan" onResizeEnd={(_event,size)=>data.onChangeUtility(id,{width:Math.round(size.width),height:Math.round(size.height)})}><span role="separator" aria-label={c.resize} title={c.resize}><Icon name="resize" size={17}/></span></NodeResizeControl>}
  </article>;
}

function WorkspaceFiles({sessionId,cwd,bridge,c}:{sessionId:string;cwd?:string;bridge:NativeUtilityBridge;c:Copy}){
  const [directory,setDirectory]=useState('');const [listing,setListing]=useState<UtilityDirectory>();const [file,setFile]=useState<string>();
  const [text,setText]=useState<UtilityFileText>();const [image,setImage]=useState<string>();const [page,setPage]=useState(1);const [version,refresh]=useState(0);
  const [loading,setLoading]=useState(false);const [reading,setReading]=useState(false);const [error,setError]=useState('');const [fileError,setFileError]=useState('');
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    void bridge.list(sessionId,directory,controller.signal).then(value=>{if(!controller.signal.aborted)setListing(value);}).catch(error=>{if(!controller.signal.aborted)setError(errorMessage(error));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[bridge,sessionId,directory,version]);
  useEffect(()=>{if(!cwd)return;const controller=new AbortController();bridge.watch(sessionId,utilityAbsolutePath(cwd,directory),()=>refresh(value=>value+1),controller.signal);return()=>controller.abort();},[bridge,sessionId,cwd,directory]);
  useEffect(()=>{if(!file)return;const controller=new AbortController();let objectUrl:string|undefined;setReading(true);setFileError('');setText(undefined);setImage(undefined);
    void(async()=>{try{
      const path=utilityAbsolutePath(cwd??'',file);
      if(/\.(?:png|jpe?g|gif|webp|avif|svg|ico)$/i.test(file)){
        const entry=listing?.entries.find(entry=>file.endsWith(`/${entry.name}`)||file===entry.name);if((entry?.size??0)>10*1024*1024)throw new Error(c.fileTooLarge);
        const bytes=await bridge.readBytes(sessionId,path,controller.signal);if(bytes.data.byteLength>10*1024*1024)throw new Error(c.fileTooLarge);
        if(controller.signal.aborted)return;const extension=file.split('.').pop()?.toLowerCase();const type=extension==='svg'?'image/svg+xml':extension==='jpg'?'image/jpeg':`image/${extension}`;
        objectUrl=URL.createObjectURL(new Blob([bytes.data as Uint8Array<ArrayBuffer>],{type}));setImage(objectUrl);
      }else{const value=await bridge.read(sessionId,path,page,controller.signal);if(!controller.signal.aborted)setText(value);}
    }catch(error){if(!controller.signal.aborted)setFileError(errorMessage(error));}finally{if(!controller.signal.aborted)setReading(false);}})();
    return()=>{controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[bridge,sessionId,cwd,file,page,version]);
  const openNative=()=>{if(file&&cwd&&bridge.openNativeResource)void Promise.resolve(bridge.openNativeResource(sessionId,utilityFileAddress(sessionId,utilityAbsolutePath(cwd,file)))).catch(error=>setFileError(errorMessage(error)));};
  return <section className="wf-utility-files" data-testid="utility-workspace-files"><div className="wf-utility-toolbar"><button type="button" title={c.up} aria-label={c.up} disabled={!directory} onClick={()=>{setDirectory(directory.split('/').slice(0,-1).join('/'));setListing(undefined);}}><Icon name="arrow" size={14} style={{transform:'rotate(-90deg)'}}/></button><span title={cwd}>{directory?`./${directory}`:'./'}</span><button type="button" title={c.refresh} aria-label={c.refresh} onClick={()=>refresh(value=>value+1)}><Icon name="retry" size={14}/></button></div>
    <div className={`wf-utility-file-split ${file?'has-preview':''}`}><div className="wf-utility-file-list">{loading&&<p className="wf-utility-muted">{c.loading}</p>}{error&&<p className="wf-utility-error" role="alert">{error}</p>}{!loading&&!error&&listing?.entries.length===0&&<p className="wf-utility-muted">{c.empty}</p>}{[...(listing?.entries??[])].sort((a,b)=>Number(b.type==='directory')-Number(a.type==='directory')||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})).map(entry=><button type="button" className={file===(directory?`${directory}/`:'')+entry.name?'is-active':''} key={entry.name} disabled={entry.type==='other'} title={entry.name} onClick={()=>{const path=(directory?`${directory}/`:'')+entry.name;if(entry.type==='directory'){setDirectory(path);setListing(undefined);}else{setFile(path);setPage(1);}}}><Icon name={entry.type==='directory'?'list':'file'} size={14}/><span>{entry.name}</span></button>)}{listing?.truncated&&<p className="wf-utility-muted">{c.truncated}</p>}</div>
    {file&&<div className="wf-utility-file-preview"><div className="wf-utility-toolbar"><span title={file}>{file.split('/').pop()}</span><button type="button" disabled={!text?.text} title={c.copy} aria-label={c.copy} onClick={()=>void navigator.clipboard?.writeText(text?.text??'').catch(error=>setFileError(errorMessage(error)))}><Icon name="copy" size={12}/></button><button type="button" title={c.closePreview} aria-label={c.closePreview} onClick={()=>setFile(undefined)}><Icon name="close" size={12}/></button></div>{reading?<p className="wf-utility-muted">{c.loading}</p>:fileError?<p className="wf-utility-error" role="alert">{fileError}</p>:image?<div className="wf-utility-image"><img alt={file} src={image}/></div>:<pre tabIndex={0}>{text?.text}</pre>}<div className="wf-utility-file-pagination"><button type="button" disabled={reading||page<=1} onClick={()=>setPage(Math.max(1,page-200))}>{c.previousPage}</button><span>{page}–{page+Math.max(0,(text?.lines??0)-1)}</span><button type="button" disabled={reading||!text||text.eof} onClick={()=>setPage(page+200)}>{c.nextPage}</button></div>{bridge.openNativeResource&&<button type="button" className="wf-utility-text-button" onClick={openNative}>{c.native}</button>}</div>}</div><p className="wf-utility-footnote">{c.readOnly}</p>
  </section>;
}

const terminalEmpty:UtilityTerminalState={phase:'idle',writable:false};
function UtilityTerminal({sessionId,occurrence,contentId,binding,bridge,onBinding,c,interactive}:{sessionId:string;occurrence:string;contentId:string;binding?:UtilityTerminalBinding;bridge:NativeUtilityBridge;onBinding:(binding:UtilityTerminalBinding|undefined)=>void;c:Copy;interactive:boolean}){
  const [view,setView]=useState<UtilityTerminalView>();const [shells,setShells]=useState<readonly UtilityShell[]>([]);const [shell,setShell]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const shellRequest=useRef<AbortController>();const bindingRef=useRef(onBinding);bindingRef.current=onBinding;
  useEffect(()=>{if(binding){try{setView(bridge.terminal(sessionId,occurrence,contentId,binding));}catch(error){setError(errorMessage(error));}}return()=>shellRequest.current?.abort();},[bridge,sessionId,occurrence,contentId,binding?.id]);
  const state=useSyncExternalStore(listener=>view?.state.subscribe(listener)??(()=>{}),()=>view?.state.getSnapshot()??terminalEmpty);
  const chooseShell=async()=>{shellRequest.current?.abort();const request=new AbortController();shellRequest.current=request;setBusy(true);setError('');try{const choices=await bridge.shells(sessionId,request.signal);if(!request.signal.aborted){setShells(choices.shells);setShell(choices.selectedShell??'');}}catch(error){if(!request.signal.aborted)setError(errorMessage(error));}finally{if(!request.signal.aborted)setBusy(false);}};
  const launch=()=>{setError('');try{const terminal=bridge.terminal(sessionId,occurrence,contentId,undefined,shell||undefined);setView(terminal);bindingRef.current({id:terminal.id,sessionId,contentId});}catch(error){setError(errorMessage(error));}};
  const close=async()=>{if(!view)return;setBusy(true);setError('');try{await bridge.closeTerminal(sessionId,occurrence,contentId,view);setView(undefined);bindingRef.current(undefined);}catch(error){setError(errorMessage(error));}finally{setBusy(false);}};
  return <section className="wf-utility-terminal" data-testid="utility-native-terminal">{!view?<div className="wf-utility-terminal-guide"><Icon name="terminal" size={24}/><p>{c.terminalIdle}</p><div className="wf-utility-terminal-launch">{shells.length>0?<select aria-label={c.shell} value={shell} onChange={event=>setShell(event.target.value)}>{shells.map(item=><option key={item.path} value={item.path}>{item.name}</option>)}</select>:<button type="button" disabled={busy} onClick={()=>void chooseShell()}>{busy?c.loading:c.chooseShell}</button>}<button type="button" className="wf-utility-primary" disabled={busy} data-testid="utility-start-terminal" onClick={launch}>{c.startTerminal}</button></div><small>{c.terminalContinue}</small></div>:<><div className="wf-utility-toolbar"><span title={state.environment?.cwd}>{state.title??c.terminal} · {state.info?.state??state.phase}</span>{state.phase==='disconnected'||state.phase==='failed'?<button type="button" disabled={busy} title={c.retry} aria-label={c.retry} onClick={()=>{view.connect();void view.refresh().catch(error=>setError(errorMessage(error)));}}><Icon name="retry" size={13}/></button>:null}<button type="button" data-testid="utility-close-terminal" disabled={busy} onClick={()=>void close()}>{c.endTerminal}</button></div><NativeTerminalScreen view={view} state={state} interactive={interactive}/></>}{(error||state.error)&&<p className="wf-utility-error" role="alert">{error||state.error}</p>}</section>;
}

/** Native view controls transport, replay, ownership and flow control; xterm only renders its frames. */
export function NativeTerminalScreen({view,state,interactive=true}:{view:UtilityTerminalView;state:UtilityTerminalState;interactive?:boolean}){
  const element=useRef<HTMLDivElement>(null);const [loaded,setLoaded]=useState(false);const [error,setError]=useState('');
  const emulator=useRef<import('@xterm/xterm').Terminal>();const fitter=useRef<import('@xterm/addon-fit').FitAddon>();const lastRevision=useRef(0);const live=useRef(state);live.current=state;
  const inputEnabled=useRef(interactive);inputEnabled.current=interactive;
  useEffect(()=>{let cancelled=false;let dispose:(()=>void)|undefined;
    void Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit')]).then(([{Terminal},{FitAddon}])=>{if(cancelled||!element.current)return;
      const terminal=new Terminal({cursorBlink:true,fontSize:12,fontFamily:'Cascadia Code, Consolas, monospace',scrollback:Math.min(10000,state.environment?.scrollback??3000),theme:{background:'#151515',foreground:'#d5d5d5'},allowProposedApi:false});
      const fit=new FitAddon();terminal.loadAddon(fit);terminal.open(element.current);emulator.current=terminal;fitter.current=fit;lastRevision.current=0;
      const input=terminal.onData(value=>{if(inputEnabled.current&&live.current.writable)view.write(value);});const measure=()=>{const host=element.current;const current=live.current;if(!host||!host.clientWidth||!host.clientHeight||!current.writable)return;const size=fit.proposeDimensions();if(!size)return;const cols=Math.min(size.cols,current.environment?.maxCols??500),rows=Math.min(size.rows,current.environment?.maxRows??300);if(cols>=2&&rows>=1&&(terminal.cols!==cols||terminal.rows!==rows)){terminal.resize(cols,rows);view.resize(cols,rows);}};
      const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);observer?.observe(element.current);
      const detach=view.mount();setLoaded(true);measure();
      dispose=()=>{detach();observer?.disconnect();input.dispose();terminal.dispose();emulator.current=undefined;fitter.current=undefined;};
    }).catch(error=>{if(!cancelled)setError(errorMessage(error));});
    return()=>{cancelled=true;dispose?.();};
  },[view]);
  useEffect(()=>{if(!loaded||!emulator.current)return;const terminal=emulator.current;const render=state.render;if(!render||render.revision<=lastRevision.current)return;lastRevision.current=render.revision;if(render.frame.type==='snapshot'){terminal.reset();terminal.resize(render.frame.info.cols,render.frame.info.rows);}terminal.write(render.frame.type==='snapshot'?render.frame.screen:render.frame.data,()=>view.acknowledge(render.revision));},[view,state.render,loaded]);
  useEffect(()=>{const terminal=emulator.current;const host=element.current;if(!loaded||!terminal||!host)return;terminal.options.disableStdin=!state.writable||!interactive;if(state.writable&&host.clientWidth&&host.clientHeight){const size=fitter.current?.proposeDimensions();if(size){const cols=Math.min(size.cols,state.environment?.maxCols??500),rows=Math.min(size.rows,state.environment?.maxRows??300);if(cols>=2&&rows>=1){terminal.resize(cols,rows);view.resize(cols,rows);}}}},[view,state.writable,state.environment,loaded,interactive]);
  return <><div className="wf-utility-terminal-screen" ref={element} data-testid="utility-terminal-screen"/>{error&&<p className="wf-utility-error" role="alert">{error}</p>}</>;
}

function UtilityBrowser({sessionId,bridge,c}:{sessionId:string;bridge?:NativeUtilityBridge;c:Copy}){
  const [input,setInput]=useState('');const [history,setHistory]=useState<string[]>([]);const [index,setIndex]=useState(-1);const [reload,setReload]=useState(0);const [error,setError]=useState('');const url=history[index];
  const navigate=()=>{try{const next=utilityBrowserUrl(input,globalThis.location?.origin);setHistory(history.slice(0,index+1).concat(next));setIndex(index+1);setInput(next);setError('');}catch(error){setError(errorMessage(error));}};
  const go=(next:number)=>{setIndex(next);setInput(history[next]);setError('');};
  const native=()=>{if(url&&sessionId&&bridge?.openNativeBrowser)void Promise.resolve(bridge.openNativeBrowser(sessionId,url)).catch(error=>setError(errorMessage(error)));};
  return <section className="wf-utility-browser"><form className="wf-utility-browser-address" onSubmit={event=>{event.preventDefault();navigate();}}><button type="button" title={c.back} aria-label={c.back} disabled={index<=0} onClick={()=>go(index-1)}><Icon name="chevron" size={13} style={{transform:'rotate(180deg)'}}/></button><button type="button" title={c.forward} aria-label={c.forward} disabled={index>=history.length-1} onClick={()=>go(index+1)}><Icon name="chevron" size={13}/></button><input aria-label={c.address} value={input} onChange={event=>setInput(event.target.value)} placeholder="https://example.com"/><button type="submit" title={c.go} aria-label={c.go}><Icon name="arrow" size={14}/></button><button type="button" disabled={!url} title={c.refresh} aria-label={c.refresh} onClick={()=>setReload(value=>value+1)}><Icon name="retry" size={13}/></button></form>{error&&<p className="wf-utility-error" role="alert">{error}</p>}{url?<iframe key={`${url}:${reload}`} src={url} title={c.browser} sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"/>:<p className="wf-utility-empty">{c.browserEmpty}</p>}<div className="wf-utility-browser-note"><span>{c.browserNote}</span>{url&&sessionId&&bridge?.openNativeBrowser&&<button type="button" onClick={native}>{c.openNative}</button>}</div></section>;
}
function UtilityTools({bridge,sessionId,onTool,c}:{bridge?:NativeUtilityBridge;sessionId:string;onTool:(tool:Tool)=>void;c:Copy}){
  const [,invalidate]=useState(0);const [error,setError]=useState('');useEffect(()=>bridge?.subscribeTools(()=>invalidate(value=>value+1)),[bridge]);const entries=bridge?.tools()??[];
  return <section className="wf-utility-tools"><h4>{c.nativeTools}</h4>{error&&<p className="wf-utility-error" role="alert">{error}</p>}{!entries.length&&<p className="wf-utility-muted">{c.noTools}</p>}{entries.map(entry=><div key={`${entry.kind}:${entry.id}`} className="wf-utility-tool-entry"><div><strong>{entry.title}</strong><span>{entry.description??(!entry.inline?c.notEmbeddable:'')}</span></div>{entry.inline?<button type="button" onClick={()=>onTool(entry.inline!)}><Icon name="arrow" size={14}/></button>:<button type="button" disabled={!sessionId||!bridge?.openNativeTool} title={!bridge?.openNativeTool?c.notEmbeddable:c.openNative} onClick={()=>void Promise.resolve(bridge?.openNativeTool?.(sessionId,entry.kind)).catch(error=>setError(errorMessage(error)))}>{c.openNative}</button>}</div>)}</section>;
}
