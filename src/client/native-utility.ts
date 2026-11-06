/** Structural public rc.3 service faces. No native sidebar component or private store is reused. */
export interface UtilitySource<T> { getSnapshot():T; subscribe(listener:()=>void):()=>void }
export interface UtilityDirectory { path:string; entries:readonly {name:string;type:'file'|'directory'|'other';size?:number}[]; truncated:boolean }
export interface UtilityFileText { absolutePath:string;version:string;text:string;offset:number;lines:number;eof:boolean;bytes?:number }
export interface UtilityFileBytes { absolutePath:string;version:string;data:Uint8Array;offset:number;eof:boolean;bytes?:number }
type NativeResult<T>={ok:true;value:T}|{ok:false;error:{message:string;code?:string}};
export interface UtilityTerminalBinding {id:string;sessionId:string;contentId:string}
export interface UtilityTerminalInfo {id:string;title:string;cols:number;rows:number;state:'running'|'exited'|'failed';cwd:string;exitCode:number|null;error?:string}
export interface UtilityTerminalState {
  phase:'idle'|'loading'|'creating'|'connecting'|'connected'|'disconnected'|'closing'|'closed'|'failed';writable:boolean;
  title?:string;info?:UtilityTerminalInfo;error?:string;issue?:string;
  environment?:{cwd:string;maxCols:number;maxRows:number;scrollback:number};
  render?:{revision:number;frame:{type:'snapshot';screen:string;info:UtilityTerminalInfo}|{type:'output';data:string}};
}
export interface UtilityTerminalView {
  readonly id:string;readonly state:UtilitySource<UtilityTerminalState>;
  mount():()=>void;refresh():Promise<void>;connect():void;acknowledge(revision:number):void;
  write(data:string):void;resize(cols:number,rows:number):void;close():Promise<void>;
}
export interface UtilityShell {path:string;name:string;args:readonly string[]}
interface NativeTerminalTab {sessionId:string;tabId:string;contentId:string;kind?:string}
export interface NativeUtilityServices {
  workspaceFiles?:{
    list(sessionId:string,path:string,signal?:AbortSignal):Promise<NativeResult<UtilityDirectory>>;
    read(sessionId:string,path:string,range:{offset?:number;limit?:number},signal?:AbortSignal):Promise<NativeResult<UtilityFileText>>;
    readBytes(sessionId:string,path:string,options:{range?:{offset?:number;length?:number}},signal?:AbortSignal):Promise<NativeResult<UtilityFileBytes>>;
    changes?(sessionId:string,path:string,signal?:AbortSignal):AsyncIterable<{kind:'ready'}|{kind:'change';change:unknown}>;
  };
  webTerminals?:{
    view(sessionId:string,key:string,contentId:string,terminalId?:string,shellPath?:string):UtilityTerminalView;
    launchShells(sessionId:string,signal:AbortSignal):Promise<{shells:readonly UtilityShell[];selectedShell:string|undefined}>;
    selectShell(path:string):void;
    close(sessionId:string,key:string,contentId:string,terminalId?:string):void;
    retainTabs(tabs:readonly NativeTerminalTab[]):void;
  };
  sidebarRight?:{openTabs:UtilitySource<readonly NativeTerminalTab[]>};
  sidebarRightTabs?:{guide():readonly {id:string;kind:string;title():string;description?:()=>string}[];subscribe(listener:()=>void):()=>void};
  openNativeResource?:(sessionId:string,address:string)=>Promise<void>|void;
  openNativeTool?:(sessionId:string,kind:string)=>Promise<void>|void;
  openNativeBrowser?:(sessionId:string,url:string)=>Promise<void>|void;
}
export interface UtilityToolEntry {id:string;kind:string;title:string;description?:string;inline:'files'|'terminal'|'browser'|null}
export interface NativeUtilityBridge {
  readonly filesAvailable:boolean;readonly terminalAvailable:boolean;
  list(sessionId:string,path:string,signal:AbortSignal):Promise<UtilityDirectory>;
  read(sessionId:string,path:string,offset:number,signal:AbortSignal):Promise<UtilityFileText>;
  readBytes(sessionId:string,path:string,signal:AbortSignal):Promise<UtilityFileBytes>;
  watch(sessionId:string,path:string,changed:()=>void,signal:AbortSignal):void;
  shells(sessionId:string,signal:AbortSignal):Promise<{shells:readonly UtilityShell[];selectedShell:string|undefined}>;
  terminal(sessionId:string,key:string,contentId:string,binding?:UtilityTerminalBinding,shellPath?:string):UtilityTerminalView;
  closeTerminal(sessionId:string,key:string,contentId:string,view:UtilityTerminalView):Promise<void>;
  tools():readonly UtilityToolEntry[];subscribeTools(listener:()=>void):()=>void;
  openNativeResource?:NativeUtilityServices['openNativeResource'];openNativeTool?:NativeUtilityServices['openNativeTool'];
  openNativeBrowser?:NativeUtilityServices['openNativeBrowser'];
  refreshCapabilities():void;
  dispose():void;
}

function unavailable():never {throw new Error('当前 DSH 未提供此原生服务。');}
function unwrap<T>(result:NativeResult<T>):T {if(!result.ok)throw new Error(result.error.message);return result.value;}
/** Merge native tab inventory before adding utility occurrences: never drop native terminal holds. */
export function createNativeUtilityBridge(services:NativeUtilityServices):NativeUtilityBridge {
  const retained=new Map<string,NativeTerminalTab>();let disposed=false;let scheduled=false;
  let tabSource:UtilitySource<readonly NativeTerminalTab[]>|undefined,unsubscribeTabs:(()=>void)|undefined;
  let toolRegistry:NativeUtilityServices['sidebarRightTabs'],unsubscribeRegistry:(()=>void)|undefined;
  const toolListeners=new Set<()=>void>();
  const sync=()=>{if(!disposed)services.webTerminals?.retainTabs([
    ...(services.sidebarRight?.openTabs.getSnapshot()??[]).filter(tab=>tab.kind==='terminal'),...retained.values(),
  ]);};
  // Native's listener runs first; the microtask also handles registration ordering on plugin reload.
  const bindProviders=()=>{
    if(disposed)return;
    const nextTabs=services.sidebarRight?.openTabs;if(nextTabs!==tabSource){unsubscribeTabs?.();tabSource=nextTabs;unsubscribeTabs=nextTabs?.subscribe(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;sync();});});}
    const nextRegistry=services.sidebarRightTabs;if(nextRegistry!==toolRegistry){unsubscribeRegistry?.();toolRegistry=nextRegistry;unsubscribeRegistry=nextRegistry?.subscribe(()=>{for(const listener of toolListeners)listener();});}
    sync();
  };
  bindProviders();
  const bridge:NativeUtilityBridge={
    get filesAvailable(){return Boolean(services.workspaceFiles);},get terminalAvailable(){return Boolean(services.webTerminals&&services.sidebarRight);},
    async list(sessionId,path,signal){if(!services.workspaceFiles)return unavailable();return unwrap(await services.workspaceFiles.list(sessionId,path||'.',signal));},
    async read(sessionId,path,offset,signal){if(!services.workspaceFiles)return unavailable();return unwrap(await services.workspaceFiles.read(sessionId,path,{offset,limit:200},signal));},
    async readBytes(sessionId,path,signal){if(!services.workspaceFiles)return unavailable();return unwrap(await services.workspaceFiles.readBytes(sessionId,path,{},signal));},
    watch(sessionId,path,changed,signal){
      const changes=services.workspaceFiles?.changes;if(!changes)return;
      void(async()=>{try{for await(const frame of changes.call(services.workspaceFiles,sessionId,path,signal)){if(signal.aborted)break;if(frame.kind==='change')changed();}}catch{/* Listing still works when native watching is unsupported. */}})();
    },
    async shells(sessionId,signal){if(!services.webTerminals)return unavailable();return services.webTerminals.launchShells(sessionId,signal);},
    terminal(sessionId,key,contentId,binding,shellPath){
      if(!services.webTerminals||!services.sidebarRight)return unavailable();
      if(binding&&(binding.sessionId!==sessionId||binding.contentId!==contentId))throw new Error('终端引用与当前 Session 不匹配。');
      retained.set(key,{sessionId,tabId:key,contentId,kind:'terminal'});sync();
      if(shellPath)services.webTerminals.selectShell(shellPath);
      const view=services.webTerminals.view(sessionId,key,contentId,binding?.id,shellPath);sync();return view;
    },
    async closeTerminal(sessionId,key,contentId,view){
      if(!services.webTerminals)return unavailable();
      await view.close();services.webTerminals.close(sessionId,key,contentId,view.id);retained.delete(key);sync();
    },
    tools(){return(services.sidebarRightTabs?.guide()??[]).map(entry=>({id:entry.id,kind:entry.kind,title:entry.title(),description:entry.description?.(),inline:entry.kind==='files'?'files':entry.kind==='terminal'?'terminal':entry.kind==='browser'?'browser':null}));},
    subscribeTools(listener){toolListeners.add(listener);return()=>{toolListeners.delete(listener);};},
    get openNativeResource(){return services.openNativeResource;},get openNativeTool(){return services.openNativeTool;},
    get openNativeBrowser(){return services.sidebarRightTabs?.guide().some(entry=>entry.kind==='browser')?services.openNativeBrowser:undefined;},
    refreshCapabilities(){bindProviders();for(const listener of toolListeners)listener();},
    dispose(){if(disposed)return;unsubscribeTabs?.();unsubscribeRegistry?.();disposed=true;toolListeners.clear();retained.clear();services.webTerminals?.retainTabs((services.sidebarRight?.openTabs.getSnapshot()??[]).filter(tab=>tab.kind==='terminal'));},
  };return bridge;
}

export function utilityAbsolutePath(cwd:string,relative:string):string {
  if(!cwd)throw new Error('当前 Session 尚未提供工作目录。');
  if(relative.split(/[\\/]/).some(part=>part==='..')||/^(?:[a-z]:|\/|\\)/i.test(relative))throw new Error('只能浏览当前工作区中的文件。');
  const separator=cwd.includes('\\')?'\\':'/';return cwd.replace(/[\\/]$/,'')+(relative?separator+relative.replace(/[\\/]/g,separator):'');
}
export function utilityFileAddress(sessionId:string,absolutePath:string):string {
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${absolutePath.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
}
/** Navigation uses only public on-screen Session commands, after its native surface renders. */
export async function openNativeUtilitySurface(sessionId:string,host:{mounted:UtilitySource<string|undefined>;showSession:(id:string)=>void},open:()=>void,signal?:AbortSignal):Promise<void>{
  if(signal?.aborted)throw new Error('Workflow 已关闭。');
  host.showSession(sessionId);
  await new Promise<void>((resolve,reject)=>{
    let unsubscribe=()=>{};let done=false;
    const finish=(error?:Error)=>{if(done)return;done=true;clearTimeout(timer);unsubscribe();signal?.removeEventListener('abort',abort);error?reject(error):resolve();};
    const abort=()=>finish(new Error('Workflow 已关闭。'));
    const timer=setTimeout(()=>finish(new Error('原生 Session 界面未能及时打开，请重试。')),3000);
    const check=()=>{if(host.mounted.getSnapshot()===sessionId)finish();};
    unsubscribe=host.mounted.subscribe(check);signal?.addEventListener('abort',abort,{once:true});check();
  });
  // mounted is published before the native Session store is minted by React.
  await new Promise<void>(resolve=>setTimeout(resolve,100));
  if(signal?.aborted||host.mounted.getSnapshot()!==sessionId)throw new Error('Session 已切换，已取消打开资源。');
  open();
}
/** Same carrier policy as native Web browser: HTTP(S), no credentials or app origin. */
export function utilityBrowserUrl(input:string,appOrigin?:string):string {
  const value=input.trim();if(!value)throw new Error('请输入网页地址。');
  const hasScheme=/^[a-z][a-z\d+.-]*:/i.test(value);
  const isHostPort=/^(?:localhost|127\.0\.0\.1|\[[\da-f:]+\]|[^\s/:]+\.[^\s/:]+):\d+(?:\/|$)/i.test(value);
  let url:URL;try{url=new URL(hasScheme&&!isHostPort?value:`${/^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value)?'http':'https'}://${value}`);}catch{throw new Error('网页地址无效。');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持不含登录凭据的 HTTP / HTTPS 地址。');
  if(appOrigin&&url.origin===appOrigin)throw new Error('无法在节点中嵌入 DSH 应用自身。');
  return url.href;
}
