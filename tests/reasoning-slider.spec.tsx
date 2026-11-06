// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReasoningSlider, type ReasoningSliderProps, type ReasoningStep } from '../src/client/ReasoningSlider.tsx';

let root: Root, container: HTMLDivElement;
const steps: readonly ReasoningStep[] = [
  { value: 'low', label: '低', description: '适合简单问题' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const render = (props: Partial<ReasoningSliderProps> = {}) => act(async () => root.render(createElement(ReasoningSlider, {
  modelLabel: 'Example model', steps, value: 'low', onChange: () => {}, ...props,
})));
const input = () => container.querySelector<HTMLInputElement>('input[type=range]')!;
const change = (value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});

describe('ReasoningSlider presentation control', () => {
  it('maps discrete indices to native values and stays controlled', async () => {
    const onChange = vi.fn();
    await render({ value: 'medium', onChange });
    expect(input().value).toBe('1');
    expect(input().step).toBe('1');
    expect(input().getAttribute('aria-valuetext')).toBe('中 · medium');
    await change('2');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('high');
    await render({ value: 'high', onChange });
    expect(input().value).toBe('2');
    expect(container.querySelector('[role=tooltip]')?.textContent).toBe('高high');
  });

  it('supports model-specific stop counts without manufacturing extra levels', async () => {
    for (const count of [2, 4, 7]) {
      const nativeSteps = Array.from({ length: count }, (_, index) => ({ value: `native-${index}`, label: `Level ${index}` }));
      await render({ steps: nativeSteps, value: nativeSteps.at(-1)!.value });
      expect(input().max).toBe(String(count - 1));
      expect(input().value).toBe(String(count - 1));
      expect(container.querySelectorAll('[data-testid=reasoning-slider-stop]')).toHaveLength(count);
    }
  });

  it('disables unknown or unsupported capabilities and unknown selections explicitly', async () => {
    const onChange = vi.fn();
    await render({ availability: 'unknown', steps: [], value: undefined, onChange });
    expect(input().disabled).toBe(true);
    expect(input().getAttribute('aria-valuetext')).toContain('尚未确认');
    expect(container.querySelectorAll('[data-testid=reasoning-slider-stop]')).toHaveLength(0);
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('unknown');
    await render({ availability: 'unsupported', onChange });
    expect(input().disabled).toBe(true);
    expect(input().getAttribute('aria-valuetext')).toContain('不支持');
    await render({ value: 'invented-value', onChange });
    expect(input().disabled).toBe(true);
    expect(input().getAttribute('aria-valuetext')).toContain('尚未确认');
    await change('2');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects unusable step lists and honors the caller disabled state', async () => {
    await render({ steps: [steps[0]!] });
    expect(input().disabled).toBe(true);
    await render({ steps: [steps[0]!, steps[0]!] });
    expect(input().disabled).toBe(true);
    await render({ disabled: true });
    expect(input().disabled).toBe(true);
    expect(input().getAttribute('aria-valuetext')).toBe('低 · low');
    expect(container.firstElementChild?.getAttribute('data-state')).toBe('disabled');
  });

  it('exposes accessible descriptions and an optional model action', async () => {
    const onOpenModel = vi.fn();
    await render({ onOpenModel });
    const modelButton = container.querySelector<HTMLButtonElement>('button')!;
    expect(modelButton.getAttribute('aria-label')).toContain('Example model');
    await act(async () => modelButton.click());
    expect(onOpenModel).toHaveBeenCalledOnce();
    expect(input().getAttribute('aria-label')).toBe('思考程度');
    const description = document.getElementById(input().getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('适合简单问题');
    await render({ onChange: undefined, onOpenModel: undefined });
    expect(input().disabled).toBe(true);
    expect(container.querySelector('button')).toBeNull();
  });
});
