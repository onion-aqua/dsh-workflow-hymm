import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ModelReasoningOption } from './ModelPicker.tsx';
import type { Translate } from './locales.ts';
import { ReasoningSlider } from './ReasoningSlider.tsx';

/** A portal sibling of the listbox, so its range and actions never become listbox options. */
export function ModelReasoningPopover({ anchor, modelLabel, option, onChange, onClose, testId, panelId, t }: {
  anchor: HTMLButtonElement;
  modelLabel: string;
  option: ModelReasoningOption | undefined;
  onChange?: (value: string | undefined) => void | Promise<void>;
  onClose: (restoreFocus: boolean) => void;
  testId: string;
  panelId: string;
  t: Translate;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: 8, top: 8, visibility: 'hidden' });
  const [draft, setDraft] = useState<{ value: string | undefined }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const queued = useRef<{ value: string | undefined }>();
  const writing = useRef(false), mounted = useRef(true), change = useRef(onChange);
  change.current = onChange;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; queued.current = undefined; }; }, []);

  useLayoutEffect(() => {
    const place = () => {
      const popover = panel.current;
      if (!popover || !anchor.isConnected) return;
      const row = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const width = Math.min(330, Math.max(0, viewportWidth - 16));
      const height = Math.min(popover.scrollHeight + 2, Math.max(0, viewportHeight - 16));
      const right = row.right + 8, left = row.left - width - 8;
      const horizontal = right + width <= viewportWidth - 8 ? right : left >= 8 ? left : Math.max(8, Math.min(row.left, viewportWidth - width - 8));
      const beside = right + width <= viewportWidth - 8 || left >= 8;
      const preferredTop = beside ? row.top : row.bottom + 6 + height <= viewportHeight - 8 ? row.bottom + 6 : row.top - height - 6;
      setPosition({ left: horizontal, top: Math.max(8, Math.min(preferredTop, viewportHeight - height - 8)), width, maxHeight: Math.max(0, viewportHeight - 16) });
    };
    place();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (panel.current) resize?.observe(panel.current);
    resize?.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { resize?.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, error]);

  useEffect(() => {
    (panel.current?.querySelector<HTMLElement>('input:not(:disabled)')??panel.current?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
  }, [anchor]);

  // Native range input must remain draggable while persistence is pending. Serialize writes and
  // keep the latest queued position, so late replies cannot restore an earlier dragged value.
  const commit = async (value: string | undefined) => {
    if (!change.current || option?.disabled) return;
    queued.current = { value };
    setDraft({ value }); setError(undefined);
    if (writing.current) return;
    writing.current = true; setSaving(true);
    try {
      while (queued.current) {
        const next = queued.current; queued.current = undefined;
        try { await change.current?.(next.value); }
        catch (reason) { if (mounted.current && !queued.current) setError(reason instanceof Error ? reason.message : t('reasoningSaveFailed')); }
      }
    } finally {
      writing.current = false;
      if (mounted.current) { setSaving(false); setDraft(undefined); }
    }
  };

  return <div ref={panel} id={panelId} className="wf-model-reasoning-popover nodrag nopan nowheel" data-testid={`${testId}-reasoning-popover`}
    role="dialog" aria-label={t('reasoningTitle')} style={position}
    onKeyDownCapture={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); }
      else if (event.key === 'Tab') {
        const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        const current = controls.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); event.stopPropagation();
        controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
    onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <div className="wf-model-reasoning-header"><span>{t('reasoningTitle')}</span>
      <button type="button" aria-label={t('reasoningClose')} onClick={() => onClose(true)}>×</button>
    </div>
    <ReasoningSlider modelLabel={modelLabel} steps={option?.steps ?? []} value={draft?.value ?? option?.value}
      availability={option?.availability ?? (option ? 'available' : 'unknown')}
      unavailableMessage={option?.unavailableMessage ?? (!option ? t('reasoningUnknown') : undefined)}
      highlightLastStep={option?.highlightLastStep} disabled={option?.disabled} label={option?.label ?? t('reasoningTitle')}
      onChange={onChange ? value => { void commit(value); } : undefined} testId={`${testId}-reasoning`} />
    <div className="wf-model-reasoning-footer">
      <span role="status">{saving ? t('saving') : option?.isDefault ? t('reasoningDefault') : ''}</span>
      {option && option.availability !== 'unknown' && option.availability !== 'unsupported' && <button type="button" data-testid={`${testId}-reasoning-default`} disabled={!onChange || option.disabled || option.isDefault && !draft} onClick={() => { void commit(undefined); }}>{t('reasoningFollowDefault')}</button>}
    </div>
    {error && <span className="wf-model-reasoning-error" role="alert">{error}</span>}
  </div>;
}
