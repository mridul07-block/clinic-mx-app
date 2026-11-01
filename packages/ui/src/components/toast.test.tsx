import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, toastRootClass, toastViewportClass, toToastObject } from './toast';

describe('toast', () => {
  it('is a success toast by default, announced politely', () => {
    expect(toToastObject({ title: 'Checked in' })).toEqual({
      title: 'Checked in',
      description: undefined,
      type: 'success',
      priority: 'low',
      actionProps: undefined,
    });
  });

  it('announces an error at once', () => {
    const toast = toToastObject({ title: 'Not sent', description: 'Try again.', tone: 'error' });
    expect(toast.type).toBe('error');
    expect(toast.priority).toBe('high');
    expect(toast.description).toBe('Try again.');
  });

  it('turns an action into the toast button', () => {
    const onClick = vi.fn();
    const toast = toToastObject({ title: 'Cancelled', action: { label: 'Undo', onClick } });
    expect(toast.actionProps).toEqual({ children: 'Undo', onClick });
  });

  it('renders its children and nothing more until a toast is shown', () => {
    expect(
      renderToStaticMarkup(
        <ToastProvider>
          <p>Page</p>
        </ToastProvider>,
      ),
    ).toBe('<p>Page</p>');
  });

  it('sits above the bottom tabs on a phone and bottom left, 360 px, from 768 px', () => {
    expect(toastViewportClass).toContain('bottom-[calc(4.5rem+env(safe-area-inset-bottom))]');
    expect(toastViewportClass).toContain('inset-x-4');
    expect(toastViewportClass).toContain('md:bottom-4 md:left-4 md:w-90');
    expect(toastViewportClass).toContain('z-60');
  });

  it('is a floating white panel, on the danger tint for an error, sliding in from the left', () => {
    expect(toastRootClass).toContain('rounded-panel border border-line bg-surface');
    expect(toastRootClass).toContain('shadow-float');
    expect(toastRootClass).toContain('data-[type=error]:border-danger-line');
    expect(toastRootClass).toContain('data-[type=error]:bg-danger-soft');
    expect(toastRootClass).toContain('data-starting-style:-translate-x-[calc(100%+1rem)]');
  });
});
