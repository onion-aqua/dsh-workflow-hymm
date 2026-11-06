import type { Context } from '@deepseek-ai/cordis';
import type { FunctionComponent } from 'react';
import { createElement, useSyncExternalStore } from 'react';

export interface WorkflowSidebarControls {
  setEnabled(enabled: boolean): void;
  useNativeDirectory(): void;
  readonly enabled: boolean;
}
export interface WorkflowSidebarRegistration extends WorkflowSidebarControls {
  dispose(): void;
}
export interface WorkflowSidebarOptions {
  /** Receives the normal root slot props plus the supplied inject face. */
  component: FunctionComponent<any>;
  inject: () => Record<string, unknown>;
  initiallyEnabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  /** Evaluated when the More menu renders, so it may read the current locale. */
  menuLabel?: () => string;
}

/**
 * Reversibly replaces only the workspace browsing region. Native entries and
 * their child declarations remain owned by DSH; disabling this contribution
 * immediately restores the original browser with all of its native controls.
 */
export function installWorkflowSidebar(ctx: Context, options: WorkflowSidebarOptions): WorkflowSidebarRegistration {
  let enabled = options.initiallyEnabled !== false;
  let disposed = false;
  let nativeReady = false;
  let removeShadow: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  const snapshot = () => enabled;
  const unmount = () => { removeShadow?.(); removeShadow = undefined; };
  const mount = () => {
    if (disposed || !nativeReady || !enabled || removeShadow) return;
    removeShadow = ctx.slots.register({
      name: 'sidebar.workspaces', priority: -10, locale: 'visualWorkflow',
      inject: () => ({ ...options.inject(), workflowSidebar: controls }),
    }, options.component);
  };
  const controls: WorkflowSidebarControls = {
    get enabled() { return enabled; },
    setEnabled(value) {
      if (disposed || enabled === value) return;
      enabled = value;
      if (enabled) mount(); else unmount();
      for (const listener of listeners) listener();
      options.onEnabledChange?.(enabled);
    },
    useNativeDirectory() { controls.setEnabled(false); },
  };
  const EnableWorkflowGroups = ({ onDismiss }: { onDismiss: () => void }) => {
    const active = useSyncExternalStore(subscribe, snapshot, snapshot);
    return createElement('button', {
      type: 'button', role: 'menuitemradio', 'aria-checked': active,
      className: 'wf-sidebar-grouping-menu', 'data-testid': 'workflow-sidebar-enable',
      onClick: () => { controls.setEnabled(true); onDismiss(); },
    }, options.menuLabel?.() ?? '鎸夊伐浣滄祦鍒嗙粍');
  };

  // A native child declaration proves that WorkspaceBrowser finished its
  // registration. Waiting for the shell's parent hole alone would race that
  // registration during boot. No native child is redeclared or rendered here.
  const stopNativeWait = ctx.slots.inject('sidebar.workspaces.session.menu.item', () => {
    if (disposed) return () => {};
    nativeReady = true;
    mount();
    return () => { nativeReady = false; unmount(); };
  });
  const stopMenuWait = ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({
    name: 'sidebar.panellist.actions', id: 'visual-workflow.group-directory', order: 600,
  }, EnableWorkflowGroups));
  const registration: WorkflowSidebarRegistration = {
    get enabled() { return enabled; },
    setEnabled: controls.setEnabled,
    useNativeDirectory: controls.useNativeDirectory,
    dispose() {
      if (disposed) return;
      disposed = true;
      unmount();
      stopMenuWait();
      stopNativeWait();
      listeners.clear();
      nativeReady = false;
    },
  };
  ctx.effect(() => () => registration.dispose(), 'visual-workflow.sidebar-registration');
  return registration;
}
