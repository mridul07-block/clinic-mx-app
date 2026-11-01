'use client';

import { Toast as BaseToast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useCallback, type ReactNode } from 'react';
import { buttonVariants } from './button';
import { closeButtonClass } from './floating';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastOptions {
  /** Repeats the verb: "Checked in", "Payment recorded". */
  title: string;
  description?: string;
  /** success by default; error sits on the danger tint and is announced at once. */
  tone?: ToastTone;
  /** One action, such as Undo; pressing it closes the toast. */
  action?: { label: string; onClick: () => void };
}

/**
 * Where toasts stack, at z-index 60 (section 4.5): on a phone full width (16 px from the sides)
 * above the 56 px bottom tabs and the safe area; from 768 px bottom left, 16 px from the edges,
 * 360 px wide. The newest is nearest the edge.
 */
export const toastViewportClass =
  'fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-60 flex flex-col-reverse gap-2 outline-none md:inset-x-auto md:bottom-4 md:left-4 md:w-90';

/**
 * One toast: white, `line` border, 12 px radius, `shadow-float`; an error on `danger-soft` with a
 * `danger-line` border. It slides in from the left and fades out (240 ms, section 5), follows a
 * swipe to the left and leaves that way. Base UI pauses its timer while the stack is pointed at
 * or focused.
 */
export const toastRootClass = [
  'flex items-start gap-3 rounded-panel border border-line bg-surface py-3 pr-2 pl-3 text-base text-ink shadow-float select-none',
  'data-[type=error]:border-danger-line data-[type=error]:bg-danger-soft',
  'translate-x-(--toast-swipe-movement-x) transition-[translate,opacity] duration-[var(--duration-motion)] ease-standard',
  'data-starting-style:-translate-x-[calc(100%+1rem)] data-ending-style:opacity-0 data-ending-style:ease-in',
  'data-ending-style:data-[swipe-direction=left]:translate-x-[calc(var(--toast-swipe-movement-x)-150%)]',
  'data-swiping:transition-none data-limited:hidden',
].join(' ');

const icons: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-active" />,
  error: <CircleAlert aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-danger" />,
  info: <Info aria-hidden strokeWidth={1.75} className="size-5 shrink-0 text-ink-muted" />,
};

function isTone(type: string | undefined): type is ToastTone {
  return type === 'success' || type === 'error' || type === 'info';
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => (
    <BaseToast.Root key={toast.id} toast={toast} swipeDirection="left" className={toastRootClass}>
      <span className="pt-px">{icons[isTone(toast.type) ? toast.type : 'success']}</span>
      <BaseToast.Content className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
        <BaseToast.Title className="font-medium text-ink" />
        <BaseToast.Description className="text-sm text-ink-secondary" />
      </BaseToast.Content>
      {toast.actionProps ? (
        <BaseToast.Action className={buttonVariants({ variant: 'quiet', size: 'sm' })} />
      ) : null}
      <BaseToast.Close aria-label="Close" className={closeButtonClass}>
        <X aria-hidden strokeWidth={1.75} />
      </BaseToast.Close>
    </BaseToast.Root>
  ));
}

/**
 * Place once, around a layout's content: it holds the toasts and draws their stack. Toasts hide
 * after 4 s (design system v3 section 8); at most three show at once.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider timeout={4000} limit={3}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className={toastViewportClass}>
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

/** The toast options as Base UI's manager takes them. */
export function toToastObject({ title, description, tone = 'success', action }: ToastOptions) {
  return {
    title,
    description,
    type: tone,
    priority: tone === 'error' ? ('high' as const) : ('low' as const),
    actionProps: action ? { children: action.label, onClick: action.onClick } : undefined,
  };
}

/**
 * Shows a toast from inside a ToastProvider:
 * `const toast = useToast(); toast({ title: 'Checked in', action: { label: 'Undo', onClick } })`.
 * Returns the toast's id.
 */
export function useToast(): (options: ToastOptions) => string {
  const { add } = BaseToast.useToastManager();
  return useCallback((options: ToastOptions) => add(toToastObject(options)), [add]);
}
