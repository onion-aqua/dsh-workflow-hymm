import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReasoningSlider } from '../../src/client/ReasoningSlider';
import { previewModels } from './models';
import './preview.css';

function Preview() {
  const [modelId, setModelId] = useState('sol');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const model = previewModels.find(item => item.id === modelId)!;
  const value = selections[model.id] ?? model.initialValue;
  const step = model.steps.find(item => item.value === value);
  const chooser = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (menuOpen) chooser.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }, [menuOpen]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!stage.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  return <main>
    <header>
      <p className="eyebrow">DSH WORKFLOW · COMPONENT PREVIEW</p>
      <h1>思考程度</h1>
      <p className="intro">独立样式预览，摆放位置待定。</p>
    </header>
    <section className="preview-surface" aria-label="滑条样式预览">
      <div className="control-stage" ref={stage} onKeyDown={event => {
        if (event.key === 'Escape') { setMenuOpen(false); stage.current?.querySelector<HTMLButtonElement>('.wf-reasoning-model')?.focus(); }
      }}>
        <ReasoningSlider modelLabel={model.label} steps={model.steps} value={value}
          label={model.controlLabel ?? '思考程度'} availability={model.availability}
          highlightLastStep={model.controlLabel !== '思考模式'}
          unavailableMessage={model.message} onOpenModel={() => setMenuOpen(open => !open)}
          onChange={next => setSelections(previous => ({ ...previous, [model.id]: next }))} />
        {menuOpen && <div className="model-chooser" role="dialog" aria-label="切换模型示例" ref={chooser}>
          <div className="chooser-heading">模型示例 <button type="button" aria-label="关闭模型示例" onClick={() => setMenuOpen(false)}>×</button></div>
          <div className="model-options">{previewModels.map(item => <button key={item.id} type="button" aria-pressed={modelId === item.id}
            onClick={() => { setModelId(item.id); setMenuOpen(false); stage.current?.querySelector<HTMLButtonElement>('.wf-reasoning-model')?.focus(); }}>
            <span>{item.label}<small>{item.vendor}</small></span><span aria-hidden="true">{modelId === item.id ? '✓' : ''}</span>
          </button>)}</div>
        </div>}
      </div>
    </section>
    <section className="preview-info" aria-label="当前档位">
      <div className="current-value" aria-live="polite" data-testid="preview-value">
        <span>{step?.label ?? (model.availability === 'unknown' ? '档位待确认' : '无深度滑条')}</span>
        {step && <code>{step.value}</code>}
      </div>
      <p>{model.note}</p>
      {model.source && <a href={model.source} target="_blank" rel="noreferrer">官方参数说明 ↗</a>}
    </section>
    <footer>点击模型名称切换示例 · 拖动或使用方向键调节<br />仅展示控件交互，尚未连接模型请求。</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
