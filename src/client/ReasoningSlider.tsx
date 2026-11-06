import { useId } from 'react';
import type { CSSProperties } from 'react';
import './reasoning-slider.css';

export interface ReasoningStep {
  value: string;
  label: string;
  description?: string;
}

export interface ReasoningSliderProps {
  modelLabel: string;
  steps: readonly ReasoningStep[];
  value?: string;
  onChange?: (value: string) => void;
  onOpenModel?: () => void;
  availability?: 'available' | 'unsupported' | 'unknown';
  unavailableMessage?: string;
  highlightLastStep?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
  testId?: string;
}

/** A presentational control: callers supply the model's verified native levels. */
export function ReasoningSlider({
  modelLabel,
  steps,
  value,
  onChange,
  onOpenModel,
  availability = 'available',
  unavailableMessage,
  highlightLastStep = true,
  disabled = false,
  label = '思考程度',
  className = '',
  testId = 'reasoning-slider',
}: ReasoningSliderProps) {
  const id = useId();
  const index = steps.findIndex(step => step.value === value);
  const hasSteps = steps.length >= 2 && new Set(steps.map(step => step.value)).size === steps.length;
  const supported = availability === 'available' && hasSteps;
  const knownValue = supported && index >= 0;
  const blocked = disabled || !knownValue || !onChange;
  const selected = knownValue ? steps[index] : undefined;
  const status = availability === 'unsupported'
    ? '此模型不支持思考程度调节'
    : !supported
      ? '此模型的思考档位尚未确认'
      : !knownValue
        ? '当前思考档位尚未确认'
        : undefined;
  const message = unavailableMessage ?? status;
  const valueText = selected ? `${selected.label} · ${selected.value}` : message ?? '不可用';
  const progress = knownValue ? index / (steps.length - 1) : 0;
  const isMaximum = knownValue && highlightLastStep && index === steps.length - 1;
  const sliderStyle = { '--wf-reasoning-progress': progress } as CSSProperties;

  return <div
    className={`wf-reasoning-slider nodrag nopan nowheel ${blocked ? 'is-disabled' : ''} ${!knownValue ? 'is-unavailable' : ''} ${isMaximum ? 'is-maximum' : ''} ${className}`.trim()}
    data-testid={testId}
    data-state={!supported ? availability === 'unsupported' ? 'unsupported' : 'unknown' : !knownValue ? 'unknown' : disabled || !onChange ? 'disabled' : 'available'}
    style={sliderStyle}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}
  >
    {onOpenModel
      ? <button type="button" className="wf-reasoning-model" onClick={onOpenModel} aria-label={`选择模型：${modelLabel}`} data-testid={`${testId}-model`}>
          <span>{modelLabel}</span><span className="wf-reasoning-chevron" aria-hidden="true">›</span>
        </button>
      : <div className="wf-reasoning-model" data-testid={`${testId}-model`}><span>{modelLabel}</span></div>}
    <div className="wf-reasoning-control" title={message}>
      <div className="wf-reasoning-rail" aria-hidden="true">
        {knownValue && <div className="wf-reasoning-fill" />}
        {isMaximum && !blocked && <div className="wf-reasoning-sparks">
          {Array.from({ length: 16 }, (_, spark) => <span key={spark} style={{
            left: `${4 + spark * 23 % 87}%`,
            top: `${15 + spark * 17 % 70}%`,
            width: spark % 3 === 0 ? 3 : 2,
            height: spark % 3 === 0 ? 3 : 2,
            animationDuration: `${3.2 + spark % 5 * .45}s`,
            animationDelay: `${spark * -.7}s`,
          }} />)}
        </div>}
        <div className="wf-reasoning-stops">
          {supported && steps.map((step, stopIndex) => <span key={step.value} className={`wf-reasoning-stop ${knownValue && stopIndex <= index ? 'is-filled' : ''}`} data-testid={`${testId}-stop`} style={{ left: `${stopIndex / (steps.length - 1) * 100}%` }} />)}
        </div>
        {!knownValue && <span className="wf-reasoning-unavailable">{availability === 'unsupported' ? '不支持调节' : '档位待确认'}</span>}
      </div>
      <input
        id={id}
        type="range"
        className="wf-reasoning-input"
        min={0}
        max={Math.max(1, steps.length - 1)}
        step={1}
        value={knownValue ? index : 0}
        disabled={blocked}
        aria-label={label}
        aria-valuetext={valueText}
        aria-describedby={`${id}-description`}
        data-testid={`${testId}-input`}
        onChange={event => {
          if (blocked) return;
          const next = steps[Number(event.currentTarget.value)];
          if (next && next.value !== value) onChange?.(next.value);
        }}
      />
      <div className="wf-reasoning-tooltip" role="tooltip" aria-hidden="true" data-testid={`${testId}-tooltip`}>
        <span>{selected?.label ?? message}</span>
        {selected && <code>{selected.value}</code>}
      </div>
    </div>
    <span id={`${id}-description`} className="wf-reasoning-sr-only">{selected?.description ?? message ?? `${label}：${valueText}`}</span>
  </div>;
}
