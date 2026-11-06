import {describe,it,expect,vi} from 'vitest';
import {createNativeUtilityBridge,openNativeUtilitySurface,utilityAbsolutePath,utilityBrowserUrl,utilityFileAddress} from '../src/client/native-utility.ts';
import type {NativeUtilityServices,UtilitySource,UtilityTerminalView} from '../src/client/native-utility.ts';

function source<T>(initial:T):UtilitySource<T>&{set(value:T):void}{let value=initial;const listeners=new Set<()=>void>();return{getSnapshot:()=>value,subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}},set(next){value=next;for(const listener of listeners)listener()}};}
function terminalView(id:string):UtilityTerminalView{return{id,state:source({phase:'idle',writable:false}),mount:vi.fn(()=>vi.fn()),refresh:vi.fn(async()=>{}),connect:vi.fn(),acknowledge:vi.fn(),write:vi.fn(),resize:vi.fn(),close:vi.fn(async()=>{})};}

describe('public native utility adapter',()=>{
  it('forwards only the selected Session and listed workspace path, native ranges, cancellation and failures',async()=>{
    const controller=new AbortController(),list=vi.fn(async()=>({ok:true as const,value:{path:'src',entries:[],truncated:false}})),read=vi.fn(async()=>({ok:true as const,value:{absolutePath:'D:\\project\\src\\a.ts',version:'v1',text:'native',offset:201,lines:1,eof:true}})),readBytes=vi.fn(async()=>({ok:false as const,error:{message:'Not a binary file'}}));
    const bridge=createNativeUtilityBridge({workspaceFiles:{list,read,readBytes}});
    expect(await bridge.list('branch-b','src',controller.signal)).toMatchObject({path:'src'});expect(list).toHaveBeenCalledExactlyOnceWith('branch-b','src',controller.signal);
    await bridge.list('branch-b','',controller.signal);expect(list).toHaveBeenLastCalledWith('branch-b','.',controller.signal);
    expect((await bridge.read('branch-b','D:\\project\\src\\a.ts',201,controller.signal)).text).toBe('native');expect(read).toHaveBeenCalledExactlyOnceWith('branch-b','D:\\project\\src\\a.ts',{offset:201,limit:200},controller.signal);
    await expect(bridge.readBytes('branch-b','D:\\project\\a.bin',controller.signal)).rejects.toThrow('Not a binary file');bridge.dispose();
  });
  it('starts no PTY during capability discovery and preserves native terminal holds when a utility is launched or native tabs change',async()=>{
    const nativeTab={sessionId:'native-s',tabId:'native-tab',contentId:'native-content',kind:'terminal'},tabs=source<readonly typeof nativeTab[]>([nativeTab]);
    const view=terminalView('pty-b'),service={view:vi.fn(()=>view),launchShells:vi.fn(async()=>({shells:[],selectedShell:undefined})),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()};
    const bridge=createNativeUtilityBridge({webTerminals:service,sidebarRight:{openTabs:tabs}});
    expect(bridge.terminalAvailable).toBe(true);expect(service.view).not.toHaveBeenCalled();
    bridge.terminal('branch-b','utility:b','utility-content:b',undefined,'pwsh');expect(service.view).toHaveBeenCalledExactlyOnceWith('branch-b','utility:b','utility-content:b',undefined,'pwsh');
    expect(service.retainTabs).toHaveBeenLastCalledWith([nativeTab,{sessionId:'branch-b',tabId:'utility:b',contentId:'utility-content:b',kind:'terminal'}]);
    tabs.set([{...nativeTab,tabId:'changed-tab'}]);await Promise.resolve();expect(service.retainTabs.mock.lastCall?.[0]).toContainEqual({...nativeTab,tabId:'changed-tab'});expect(service.retainTabs.mock.lastCall?.[0]).toContainEqual(expect.objectContaining({sessionId:'branch-b'}));
    await bridge.closeTerminal('branch-b','utility:b','utility-content:b',view);expect(view.close).toHaveBeenCalledOnce();expect(service.close).toHaveBeenCalledExactlyOnceWith('branch-b','utility:b','utility-content:b','pty-b');expect(service.retainTabs).toHaveBeenLastCalledWith([{...nativeTab,tabId:'changed-tab'}]);bridge.dispose();
  });
  it('restores the same terminal identity and rejects cross-Session or cross-content bindings before touching a native view',()=>{
    const view=vi.fn(()=>terminalView('pty-b'));const bridge=createNativeUtilityBridge({webTerminals:{view,launchShells:vi.fn(),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()},sidebarRight:{openTabs:source([])}});
    expect(()=>bridge.terminal('b','node-b','content-b',{id:'pty-a',sessionId:'a',contentId:'content-b'})).toThrow('Session');expect(view).not.toHaveBeenCalled();
    expect(()=>bridge.terminal('b','node-b','content-b',{id:'pty-a',sessionId:'b',contentId:'content-a'})).toThrow('Session');expect(view).not.toHaveBeenCalled();
    bridge.terminal('b','node-b','content-b',{id:'pty-b',sessionId:'b',contentId:'content-b'});expect(view).toHaveBeenCalledExactlyOnceWith('b','node-b','content-b','pty-b',undefined);bridge.dispose();
  });
  it('never closes a native process when the bridge or canvas is disposed',()=>{
    const view=terminalView('pty-b'),service={view:vi.fn(()=>view),launchShells:vi.fn(),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()};const bridge=createNativeUtilityBridge({webTerminals:service,sidebarRight:{openTabs:source([])}});
    bridge.terminal('b','node-b','content-b');bridge.dispose();expect(view.close).not.toHaveBeenCalled();expect(service.close).not.toHaveBeenCalled();expect(service.retainTabs).toHaveBeenLastCalledWith([]);
  });
  it('reports absent services and real registered tool capabilities without fabricating tools',async()=>{
    const bridge=createNativeUtilityBridge({sidebarRightTabs:{guide:()=>[{id:'new',kind:'browser',title:()=> 'Native browser'},{id:'extra',kind:'third-party',title:()=> 'Plugin'}],subscribe:()=>()=>{}}});
    expect(bridge.filesAvailable).toBe(false);expect(bridge.terminalAvailable).toBe(false);await expect(bridge.list('b','',new AbortController().signal)).rejects.toThrow('原生服务');expect(bridge.tools()).toEqual([{id:'new',kind:'browser',title:'Native browser',description:undefined,inline:'browser'},{id:'extra',kind:'third-party',title:'Plugin',description:undefined,inline:null}]);bridge.dispose();
  });
  it('offers native Browser fallback only when the native Browser kind is registered',()=>{
    const openNativeBrowser=vi.fn();const missing=createNativeUtilityBridge({openNativeBrowser});expect(missing.openNativeBrowser).toBeUndefined();let guides=[{id:'new',kind:'browser',title:()=> 'Browser'}];const bridge=createNativeUtilityBridge({openNativeBrowser,sidebarRightTabs:{guide:()=>guides,subscribe:()=>()=>{}}});expect(bridge.openNativeBrowser).toBe(openNativeBrowser);guides=[];expect(bridge.openNativeBrowser).toBeUndefined();bridge.dispose();missing.dispose();
  });
  it('adopts optional services that load after Workflow without disabling the canvas or keeping a stale unavailable snapshot',()=>{
    const services:NativeUtilityServices={};const bridge=createNativeUtilityBridge(services),changed=vi.fn();bridge.subscribeTools(changed);expect(bridge.filesAvailable).toBe(false);expect(bridge.terminalAvailable).toBe(false);
    const terminal=terminalView('late-pty'),nativeTabs=source([{sessionId:'native',tabId:'native-tab',contentId:'native-content',kind:'terminal'}]);services.workspaceFiles={list:vi.fn(),read:vi.fn(),readBytes:vi.fn()};services.webTerminals={view:vi.fn(()=>terminal),launchShells:vi.fn(),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()};services.sidebarRight={openTabs:nativeTabs};services.sidebarRightTabs={guide:()=>[{id:'new',kind:'terminal',title:()=> 'Terminal'}],subscribe:()=>()=>{}};
    bridge.refreshCapabilities();expect(bridge.filesAvailable).toBe(true);expect(bridge.terminalAvailable).toBe(true);expect(changed).toHaveBeenCalledOnce();bridge.terminal('late-session','late-node','late-content');expect(services.webTerminals.view).toHaveBeenCalledExactlyOnceWith('late-session','late-node','late-content',undefined,undefined);expect(services.webTerminals.retainTabs).toHaveBeenLastCalledWith([nativeTabs.getSnapshot()[0],{sessionId:'late-session',tabId:'late-node',contentId:'late-content',kind:'terminal'}]);bridge.dispose();
  });
  it('keeps file previews inside the selected Session workspace and constructs native file addresses',()=>{
    expect(utilityAbsolutePath('D:\\workspace','src/a b.ts')).toBe('D:\\workspace\\src\\a b.ts');expect(utilityAbsolutePath('/workspace','src/a.ts')).toBe('/workspace/src/a.ts');
    for(const path of ['../secrets','src/../../secrets','C:\\outside','/etc/passwd'])expect(()=>utilityAbsolutePath('D:\\workspace',path)).toThrow();
    expect(utilityFileAddress('session 1','D:\\workspace\\a b.ts')).toBe('dsh-resource://file/session/session%201/D%3A/workspace/a%20b.ts');
  });
  it('validates embedded browser URLs against the native Web carrier policy',()=>{
    expect(utilityBrowserUrl('example.com')).toBe('https://example.com/');expect(utilityBrowserUrl('localhost:3000/path')).toBe('http://localhost:3000/path');
    for(const url of ['javascript:alert(1)','file:///C:/secret','data:text/html,a','https://user:pass@example.com','blob:https://a/id','https://dsh.local'])expect(()=>utilityBrowserUrl(url,'https://dsh.local')).toThrow();
  });
  it('waits for the correct native Session before a public resource command and cancels on switching away',async()=>{
    vi.useFakeTimers();try{const mounted=source<string|undefined>(undefined),showSession=vi.fn(),open=vi.fn();const request=openNativeUtilitySurface('branch-b',{mounted,showSession},open);expect(showSession).toHaveBeenCalledExactlyOnceWith('branch-b');expect(open).not.toHaveBeenCalled();mounted.set('branch-b');await vi.advanceTimersByTimeAsync(100);await request;expect(open).toHaveBeenCalledOnce();
      const second=openNativeUtilitySurface('branch-b',{mounted,showSession},open);mounted.set('other');const rejected=expect(second).rejects.toThrow('Session 已切换');await vi.advanceTimersByTimeAsync(100);await rejected;expect(open).toHaveBeenCalledOnce();
    }finally{vi.useRealTimers();}
  });
});
