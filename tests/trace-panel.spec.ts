// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TracePanel, type TracePanelProps, type TraceStepSummary } from '../src/client/TracePanel.tsx';

// These fixtures exercise the presentation component only; production data comes from native events.
const fixtureSteps: TraceStepSummary[] = [
  { id: 'test-only-step-a', title: 'TEST fixture command A', type: 'command', status: 'completed', input: 'echo test-only', output: 'test-only output A' },
  { id: 'test-only-step-b', title: 'TEST fixture file B', type: 'file_operation', status: 'running', input: 'test-only path' },
];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(props: Partial<TracePanelProps> = {}): Promise<void> {
  await act(async () => root.render(createElement(TracePanel, { nodeTitle: 'TEST fixture node', onClose: () => {}, ...props })));
}

function stepButton(title: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>('.wf-trace-step-heading')].find(element => element.textContent?.includes(title));
  if (!button) throw new Error(`Missing fixture step ${title}`);
  return button;
}

describe('TracePanel presentation without fabricated product executions', () => {
  it('renders truthful empty, loading and read-failure states', async () => {
    await render();
    expect(container.querySelector('[data-testid="trace-empty"]')).not.toBeNull();
    expect(container.textContent).toContain('0 条步骤');
    expect(container.querySelectorAll('.wf-trace-step')).toHaveLength(0);
    await render({ loading: true });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('正在加载执行记录');
    expect(container.querySelector('[data-testid="trace-empty"]')).toBeNull();
    await render({ error: 'TEST read failure' });
    expect(container.textContent).toContain('无法读取执行记录');
    expect(container.textContent).toContain('TEST read failure');
  });

  it('toggles steps independently and preserves expansion when the same run updates', async () => {
    await render({ runId: 'test-only-run-a', steps: fixtureSteps });
    expect(stepButton('command A').getAttribute('aria-expanded')).toBe('false');
    expect(stepButton('file B').getAttribute('aria-expanded')).toBe('false');
    await act(async () => stepButton('command A').click());
    expect(stepButton('command A').getAttribute('aria-expanded')).toBe('true');
    expect(stepButton('file B').getAttribute('aria-expanded')).toBe('false');
    await act(async () => stepButton('file B').click());
    expect(stepButton('command A').getAttribute('aria-expanded')).toBe('true');
    expect(stepButton('file B').getAttribute('aria-expanded')).toBe('true');
    await act(async () => stepButton('command A').click());
    expect(stepButton('command A').getAttribute('aria-expanded')).toBe('false');
    expect(stepButton('file B').getAttribute('aria-expanded')).toBe('true');
    await render({ runId: 'test-only-run-a', steps: fixtureSteps.map(step => step.id === 'test-only-step-b' ? { ...step, status: 'completed' } : step) });
    expect(stepButton('file B').getAttribute('aria-expanded')).toBe('true');
    await render({ runId: 'test-only-run-b', steps: fixtureSteps });
    expect(stepButton('command A').getAttribute('aria-expanded')).toBe('false');
    expect(stepButton('file B').getAttribute('aria-expanded')).toBe('false');
  });

  it('copies the displayed output and closes through the existing controls', async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const onClose = vi.fn();
    await render({ runId: 'test-only-run-a', steps: fixtureSteps, onClose });
    await act(async () => stepButton('command A').click());
    const copy = container.querySelector<HTMLButtonElement>('[aria-label="复制输出"]');
    expect(copy).not.toBeNull();
    await act(async () => copy!.click());
    expect(writeText).toHaveBeenCalledWith('test-only output A');
    const close = container.querySelector<HTMLButtonElement>('[data-testid="trace-close"]');
    await act(async () => close!.click());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('reads details only on expansion and keeps retained output visible when native events truncated it', async () => {
    const onReadStep=vi.fn();
    const step:TraceStepSummary={id:'test-only-lazy-step',title:'TEST lazy detail',type:'tool_call',status:'completed'};
    await render({runId:'test-only-lazy-run',steps:[step],onReadStep});
    expect(onReadStep).not.toHaveBeenCalled();
    await act(async()=>stepButton('TEST lazy detail').click());
    expect(onReadStep).toHaveBeenCalledWith(step.id);
    await render({runId:'test-only-lazy-run',steps:[{...step,output:'TEST retained native output',truncated:true}],onReadStep});
    expect(container.querySelector('pre')?.textContent).toBe('TEST retained native output');
    expect(container.textContent).toContain('输出已截断');
    await render({runId:'test-only-lazy-run',steps:[{...step,unavailable:'TEST temporary read error'}],onReadStep});
    const retry=[...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent==='读取详情');
    expect(retry).toBeDefined();
    await act(async()=>retry!.click());
    expect(onReadStep).toHaveBeenCalledTimes(2);
  });
  it('refreshes an open step after its native event range invalidates cached details without closing it',async()=>{
    const onReadStep=vi.fn();
    const step:TraceStepSummary={id:'test-only-streaming-step',title:'TEST streaming command',type:'command',status:'running',eventStartSeq:10};
    await render({runId:'test-only-streaming-run',steps:[step],onReadStep});
    await act(async()=>stepButton(step.title).click());
    expect(onReadStep).toHaveBeenCalledTimes(1);
    await render({runId:'test-only-streaming-run',steps:[{...step,eventName:'process_output',output:'TEST early output'}],onReadStep});
    expect(onReadStep).toHaveBeenCalledTimes(1);
    await render({runId:'test-only-streaming-run',steps:[{...step,status:'completed',eventEndSeq:18}],onReadStep});
    expect(stepButton(step.title).getAttribute('aria-expanded')).toBe('true');
    expect(onReadStep).toHaveBeenCalledTimes(2);
    await render({runId:'test-only-streaming-run',steps:[{...step,status:'completed',eventEndSeq:18,eventName:'process_exit',output:'TEST latest native output'}],onReadStep});
    expect(container.querySelector('pre')?.textContent).toBe('TEST latest native output');
    expect(onReadStep).toHaveBeenCalledTimes(2);
  });

  it('shows concrete action targets as compact rows without duplicate Agent-step containers',async()=>{
    const steps:TraceStepSummary[]=[
      {id:'test-only-agent-1',title:'Agent step 1',type:'agent_step',status:'completed'},
      {id:'test-only-read',title:'Call read_file',type:'file_operation',status:'completed',toolName:'read_file',actionKind:'read',target:'src/client/TracePanel.tsx',parentStepId:'test-only-agent-1'},
      {id:'test-only-agent-2',title:'Agent step 2',type:'agent_step',status:'completed'},
      {id:'test-only-command',title:'Call Shell',type:'command',status:'completed',actionKind:'command',target:'npm run build',parentStepId:'test-only-agent-2'},
      {id:'test-only-ptc',title:'PTC read',type:'file_operation',status:'running',actionKind:'read',target:'package.json',parentStepId:'test-only-command'},
    ];
    await render({runId:'test-only-compact-run',steps});
    expect(container.querySelectorAll('.wf-trace-step')).toHaveLength(3);
    expect(container.textContent).not.toContain('Agent step');
    expect([...container.querySelectorAll('.wf-trace-action')].map(element=>element.textContent)).toEqual(['已读取','已运行','正在读取']);
    expect([...container.querySelectorAll('.wf-trace-target')].map(element=>element.textContent)).toEqual(['client/TracePanel.tsx','npm run build','package.json']);
    expect(container.querySelector<HTMLElement>('.wf-trace-step.is-child')?.style.getPropertyValue('--trace-depth')).toBe('1');
    expect(container.querySelector('.wf-trace-count')?.textContent).toBe('3');
    expect(container.querySelector('.wf-trace-footer')).toBeNull();
    expect(container.querySelector('[data-testid="execution-select"]')).toBeNull();
    await render({runId:'test-only-agent-only-run',steps:steps.filter(step=>step.type==='agent_step')});
    expect(container.querySelectorAll('.wf-trace-step')).toHaveLength(1);
    expect(container.textContent).not.toContain('Agent step');
  });

  it('combines the actual Shell command and output once, puts event metadata behind more information, and copies only output',async()=>{
    const writeText=vi.fn(async(_text:string)=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
    const step:TraceStepSummary={id:'test-only-shell',title:'Shell',type:'command',status:'completed',actionKind:'command',target:'npm run build',command:'npm run build',input:'{"command":"npm run build","cwd":"C:/test"}',output:'TEST build succeeded',toolName:'shell',eventName:'tool/call',time:1700000000000,eventStartSeq:12,eventEndSeq:18};
    await render({runId:'test-only-shell-run',steps:[step]});
    await act(async()=>stepButton('npm run build').click());
    expect(container.querySelectorAll('.wf-trace-shell')).toHaveLength(1);
    expect(container.querySelector('.wf-trace-shell pre')?.textContent).toBe('$ npm run build\nTEST build succeeded');
    expect(container.querySelectorAll('.wf-trace-step-details>.wf-trace-code-block')).toHaveLength(0);
    expect(container.querySelectorAll('h5')).toHaveLength(0);
    const more=container.querySelector<HTMLDetailsElement>('.wf-trace-more')!;
    expect(more.open).toBe(false);expect(more.textContent).toContain('tool/call');
    expect(container.querySelector<HTMLDetailsElement>('.wf-trace-raw-input')?.open).toBe(false);
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="复制输出"]')!.click());
    expect(writeText).toHaveBeenCalledWith('TEST build succeeded');
  });

  it('keeps history selection compact and presents real approval/error details',async()=>{
    const onSelectExecution=vi.fn();const writeText=vi.fn(async(_text:string)=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
    const executions=[{runId:'test-history-a',nodeId:'test-node',nodeRevision:1,branchId:'test-branch',sessionId:'test-session',status:'completed',createdAt:1,updatedAt:2},{runId:'test-history-b',nodeId:'test-node',nodeRevision:2,branchId:'test-branch',sessionId:'test-session-b',status:'failed',createdAt:3,updatedAt:4}];
    await render({runId:'test-history-b',status:'failed',executions,onSelectExecution,steps:[{id:'test-only-approval',title:'Approval: shell',type:'approval',status:'waiting_approval',toolName:'shell',eventName:'approval/asked'},{id:'test-only-error',title:'Execution error',type:'error',status:'failed',error:'TEST native failure'}]});
    expect(container.querySelector('.wf-trace-header .wf-trace-meta .wf-tag')?.textContent).toBe('失败');
    const history=container.querySelector<HTMLSelectElement>('[data-testid="execution-select"]')!;
    await act(async()=>{history.value='test-history-a';history.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(onSelectExecution).toHaveBeenCalledWith('test-history-a');
    await act(async()=>stepButton('等待审批').click());expect(container.querySelector('.wf-trace-approval')?.textContent).toContain('原生审批界面');
    await act(async()=>stepButton('执行失败').click());expect(container.querySelector('pre.is-error')?.textContent).toBe('TEST native failure');
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="复制错误"]')!.click());expect(writeText).toHaveBeenCalledWith('TEST native failure');
  });
  it('keeps file names visible while preserving full native paths in tooltips and secondary metadata',async()=>{
    const target='C:\\Users\\test-only\\workspaces\\fixture\\trace-sample.txt';
    await render({runId:'test-only-file-path-run',steps:[{id:'test-only-file-path',title:'read_file',type:'file_operation',status:'completed',toolName:'read_file',actionKind:'read',target}]});
    const heading=stepButton('fixture/trace-sample.txt');
    expect(heading.title).toContain(target);expect(heading.getAttribute('aria-label')).toContain(target);
    expect(container.querySelector('.wf-trace-target')?.textContent).toBe('fixture/trace-sample.txt');
    await act(async()=>heading.click());
    expect(container.querySelector('.wf-trace-more')?.textContent).toContain(target);
  });
  it('treats the production blocked approval DTO as waiting until its native end sequence exists',async()=>{
    const step:TraceStepSummary={id:'test-only-production-approval',title:'Approval: shell',type:'approval',status:'blocked',toolName:'shell',eventName:'approval/asked',eventStartSeq:21};
    await render({runId:'test-only-production-approval-run',steps:[step]});
    await act(async()=>stepButton('等待审批').click());
    expect(container.querySelector('.wf-trace-approval')?.textContent).toContain('原生审批界面');
    await render({runId:'test-only-production-approval-run',steps:[{...step,eventEndSeq:24,output:'rejected'}]});
    expect(stepButton('审批已停止').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.wf-trace-approval')).toBeNull();
  });

});
