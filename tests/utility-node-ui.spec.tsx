// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const emulator=vi.hoisted(()=>({write:vi.fn(),resize:vi.fn(),onData:vi.fn(),mounted:0,disposed:0,input:undefined as undefined|((value:string)=>void)}));
vi.mock('@xyflow/react',()=>({NodeResizeControl:({children}:any)=>createElement('div',{'data-testid':'utility-resize-control'},children)}));
vi.mock('@xterm/xterm',()=>({Terminal:class{cols=80;rows=24;options:any={};loadAddon=vi.fn();open=vi.fn();reset=vi.fn();onData(handler:(value:string)=>void){emulator.input=handler;return{dispose:()=>{}}}resize(cols:number,rows:number){this.cols=cols;this.rows=rows;emulator.resize(cols,rows)}write(data:string,callback:()=>void){emulator.write(data);callback()}dispose(){emulator.disposed++}}}));
vi.mock('@xterm/addon-fit',()=>({FitAddon:class{proposeDimensions(){return{cols:100,rows:30}}}}));
import {UtilityNode,NativeTerminalScreen} from '../src/client/UtilityNode.tsx';
import type {UtilityNodeData} from '../src/client/UtilityNode.tsx';
import {createNativeUtilityBridge} from '../src/client/native-utility.ts';
import type {NativeUtilityBridge,UtilityTerminalState,UtilityTerminalView} from '../src/client/native-utility.ts';

let root:Root,container:HTMLDivElement;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);emulator.write.mockClear();emulator.resize.mockClear();emulator.mounted=0;emulator.disposed=0;emulator.input=undefined;});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
const sessions=[{sessionId:'branch-a',title:'Branch A',updatedAt:1,cwd:'D:\\workspace-a'},{sessionId:'branch-b',title:'Branch B',updatedAt:2,cwd:'D:\\workspace-b'}];
function props(extra:Partial<UtilityNodeData>={}):UtilityNodeData{return{utility:{id:'utility-1',title:'Resources',position:{x:1,y:2},width:560,height:440,sessionId:'branch-b',activeTool:'files'},workflowId:'workflow-1',sessions,focused:true,onChangeUtility:vi.fn(),onRemoveUtility:vi.fn(),...extra};}
async function render(data:UtilityNodeData){await act(async()=>{root.render(createElement(UtilityNode,{id:'utility-1',data,selected:false} as any));await Promise.resolve();});}
async function click(selector:string){const target=container.querySelector<HTMLElement>(selector);expect(target).toBeTruthy();await act(async()=>{target!.click();await Promise.resolve();});}
function view(state:UtilityTerminalState):UtilityTerminalView{const listeners=new Set<()=>void>();return{id:'pty-b',state:{getSnapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener)}}},mount:vi.fn(()=>{emulator.mounted++;return()=>{emulator.mounted--}}),refresh:vi.fn(async()=>{}),connect:vi.fn(),acknowledge:vi.fn(),write:vi.fn(),resize:vi.fn(),close:vi.fn(async()=>{})};}

describe('utility resource node',()=>{
  it('only exposes the resize control while the utility node is focused',async()=>{
    await render(props({focused:false}));
    expect(container.querySelector('[data-testid=utility-resize-control]')).toBeNull();
    await render(props({focused:true}));
    expect(container.querySelector('[data-testid=utility-resize-control]')).not.toBeNull();
  });
  it('has no connection ports and previews real files only in its selected Session',async()=>{
    const list=vi.fn(async()=>({ok:true as const,value:{path:'',entries:[{name:'a.ts',type:'file' as const,size:3}],truncated:false}}));const read=vi.fn(async()=>({ok:true as const,value:{absolutePath:'D:\\workspace-b\\a.ts',version:'v1',text:'native file text',offset:1,lines:1,eof:true}}));const bridge=createNativeUtilityBridge({workspaceFiles:{list,read,readBytes:vi.fn()}});
    await render(props({bridge}));expect(container.querySelector('.react-flow__handle')).toBeNull();expect(list.mock.calls[0]?.[0]).toBe('branch-b');await click('.wf-utility-file-list button');expect(read.mock.calls[0]?.slice(0,3)).toEqual(['branch-b','D:\\workspace-b\\a.ts',{offset:1,limit:200}]);expect(container.querySelector('pre')?.textContent).toBe('native file text');expect(container.textContent).toContain('只读');bridge.dispose();
  });
  it('does not allocate a terminal from opening the node; launch is explicit and persists only the native terminal reference',async()=>{
    const terminal=view({phase:'connected',writable:true});const native={view:vi.fn(()=>terminal),launchShells:vi.fn(),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()};const bridge=createNativeUtilityBridge({webTerminals:native,sidebarRight:{openTabs:{getSnapshot:()=>[],subscribe:()=>()=>{}}}});const data=props({bridge});data.utility={...data.utility,activeTool:'terminal'};await render(data);expect(native.view).not.toHaveBeenCalled();await click('[data-testid=utility-start-terminal]');expect(native.view).toHaveBeenCalledOnce();expect(data.onChangeUtility).toHaveBeenCalledWith('utility-1',{terminal:{id:'pty-b',sessionId:'branch-b',contentId:'dsh-workflow-utility:workflow-1:utility-1:branch-b'}});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});expect(terminal.mount).toHaveBeenCalledOnce();expect(terminal.close).not.toHaveBeenCalled();bridge.dispose();
  });
  it('restores its saved PTY without allocating a replacement, locks its Session, and detaches on unmount without killing the process',async()=>{
    const terminal=view({phase:'connected',writable:true});const native={view:vi.fn(()=>terminal),launchShells:vi.fn(),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()};const bridge=createNativeUtilityBridge({webTerminals:native,sidebarRight:{openTabs:{getSnapshot:()=>[],subscribe:()=>()=>{}}}});const data=props({bridge});data.utility={...data.utility,activeTool:'terminal',terminal:{id:'pty-b',sessionId:'branch-b',contentId:'persisted-content'}};await render(data);await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});expect(native.view).toHaveBeenCalledWith('branch-b','workflow-utility:workflow-1:utility-1','persisted-content','pty-b',undefined);expect(container.querySelector<HTMLSelectElement>('[aria-label=Session]')?.disabled).toBe(true);await render({...data,utility:{...data.utility,activeTool:'files'}});expect(emulator.mounted).toBe(0);expect(terminal.close).not.toHaveBeenCalled();bridge.dispose();
  });
  it('routes actual terminal input and native snapshot/output acknowledgement through the public view',async()=>{
    const state:UtilityTerminalState={phase:'connected',writable:true,render:{revision:7,frame:{type:'snapshot',screen:'native shell output',info:{id:'pty',title:'Shell',cwd:'D:\\w',cols:90,rows:22,state:'running',exitCode:null}}}};const terminal=view(state);await act(async()=>{root.render(createElement(NativeTerminalScreen,{view:terminal,state}));await new Promise(resolve=>setTimeout(resolve,0));});expect(emulator.write).toHaveBeenCalledWith('native shell output');expect(terminal.acknowledge).toHaveBeenCalledWith(7);emulator.input?.('echo hello\r');expect(terminal.write).toHaveBeenCalledExactlyOnceWith('echo hello\r');expect(emulator.resize).toHaveBeenCalledWith(90,22);
  });
  it('retains a saved terminal on reload while another resource tab is visible, without mounting its screen or creating a new identity',async()=>{
    const terminal=view({phase:'connected',writable:true});const native={view:vi.fn(()=>terminal),launchShells:vi.fn(),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()};const bridge=createNativeUtilityBridge({webTerminals:native,sidebarRight:{openTabs:{getSnapshot:()=>[],subscribe:()=>()=>{}}}});const data=props({bridge});data.utility={...data.utility,activeTool:'browser',terminal:{id:'pty-existing',sessionId:'branch-b',contentId:'saved-content'}};
    await render(data);expect(native.view).toHaveBeenCalledExactlyOnceWith('branch-b','workflow-utility:workflow-1:utility-1','saved-content','pty-existing',undefined);expect(terminal.mount).not.toHaveBeenCalled();expect(native.retainTabs).toHaveBeenLastCalledWith([{sessionId:'branch-b',tabId:'workflow-utility:workflow-1:utility-1',contentId:'saved-content',kind:'terminal'}]);expect(terminal.close).not.toHaveBeenCalled();bridge.dispose();
  });
  it('keeps the existing terminal mounted and rendering while unfocused but blocks input until focused again',async()=>{
    const state:UtilityTerminalState={phase:'connected',writable:true};const terminal=view(state);
    const native={view:vi.fn(()=>terminal),launchShells:vi.fn(),selectShell:vi.fn(),close:vi.fn(),retainTabs:vi.fn()};const bridge=createNativeUtilityBridge({webTerminals:native,sidebarRight:{openTabs:{getSnapshot:()=>[],subscribe:()=>()=>{}}}});
    const data=props({bridge});data.utility={...data.utility,activeTool:'terminal',terminal:{id:'pty-b',sessionId:'branch-b',contentId:'persisted-content'}};
    await render(data);await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});
    emulator.input?.('first');expect(terminal.write).toHaveBeenCalledExactlyOnceWith('first');
    await render({...data,focused:false});emulator.input?.('blocked');expect(terminal.write).toHaveBeenCalledTimes(1);expect(emulator.mounted).toBe(1);expect(terminal.close).not.toHaveBeenCalled();
    const content=container.querySelector<HTMLElement>('.wf-utility-content')!;expect(content.inert).toBe(true);expect(container.querySelector<HTMLInputElement>('[data-testid=utility-title-utility-1]')!.disabled).toBe(true);
    await render(data);emulator.input?.('again');expect(terminal.write).toHaveBeenLastCalledWith('again');expect(emulator.mounted).toBe(1);expect(emulator.disposed).toBe(0);expect(content.inert).toBe(false);bridge.dispose();
  });
  it('reports absent services and does not offer working-looking dummy native tools',async()=>{
    await render(props());expect(container.textContent).toContain('未提供此原生服务');const bridge=createNativeUtilityBridge({sidebarRightTabs:{guide:()=>[{id:'native-extra',kind:'native-extra',title:()=> 'Extra native tool'}],subscribe:()=>()=>{}}});const data=props({bridge});data.utility={...data.utility,activeTool:'tools'};await render(data);expect(container.textContent).toContain('Extra native tool');const action=container.querySelector<HTMLButtonElement>('.wf-utility-tool-entry button');expect(action?.disabled).toBe(true);expect(action?.title).toContain('没有公开节点内渲染 API');bridge.dispose();
  });
});
