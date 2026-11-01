'use client';

import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '../cn';
import { Button, buttonVariants } from './button';
import { dialogBackdropClass, dialogPopupVariants } from './dialog';

export interface ConfirmDialogProps {
  /** Controlled open state; leave out and give a `trigger` for an uncontrolled one. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The element that opens it, usually a Button: `trigger={<Button variant="danger">Cancel appointment</Button>}`. */
  trigger?: ReactElement;
  /** A question that names the action: "Cancel this appointment?" */
  title: string;
  /** What happens, and whether it can be undone. */
  description?: ReactNode;
  /** The verb on the confirm button: "Cancel appointment", "Mark no show". */
  confirmLabel: string;
  /** "Go back" unless the screen needs other words. */
  cancelLabel?: string;
  /** Irreversible: the confirm button takes the danger fill (the only place it is used). */
  destructive?: boolean;
  /**
   * Runs on confirm. If it returns a promise the confirm button shows `pendingLabel` and the
   * dialog cannot be closed until it settles; it closes when it resolves and stays open (for the
   * screen to show the error) when it rejects.
   */
  onConfirm: (() => void) | (() => Promise<unknown>);
  /** Pending shown by the caller, for a form action that runs elsewhere. */
  pending?: boolean;
  /** The confirm button's fixed text while it runs ("Cancelling"); "Working" by default. */
  pendingLabel?: string;
  /** Anything more the decision needs, such as a reason field, between the text and the buttons. */
  children?: ReactNode;
}

/**
 * Design system v3 ConfirmDialog, on Base UI AlertDialog: only for confirmations and destructive
 * actions, over the scrim, at z-index 40. Focus starts on "Go back", so `Enter` never confirms
 * by accident; a press on the scrim does not close it, `Esc` does (except while pending).
 */
export function ConfirmDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Go back',
  destructive = false,
  onConfirm,
  pending: pendingProp = false,
  pendingLabel = 'Working',
  children,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const [running, setRunning] = useState(false);
  const open = openProp ?? ownOpen;
  const pending = pendingProp || running;

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };

  const confirm = () => {
    const result = onConfirm();
    if (!(result instanceof Promise)) return;
    setRunning(true);
    result.then(
      () => {
        setRunning(false);
        setOpen(false);
      },
      () => {
        setRunning(false);
      },
    );
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next, details) => {
        if (!next && pending) {
          details.cancel();
          return;
        }
        setOpen(next);
      }}
    >
      {trigger ? <AlertDialog.Trigger render={trigger} /> : null}
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={dialogBackdropClass} />
        <AlertDialog.Popup
          initialFocus={cancelRef}
          className={cn(dialogPopupVariants({ size: 'sm' }), 'gap-4 p-5')}
        >
          <div className="flex flex-col gap-1">
            <AlertDialog.Title className="text-md font-semibold text-ink">
              {title}
            </AlertDialog.Title>
            {description ? (
              <AlertDialog.Description className="text-ink-secondary">
                {description}
              </AlertDialog.Description>
            ) : null}
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close
              ref={cancelRef}
              disabled={pending}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {cancelLabel}
            </AlertDialog.Close>
            <Button
              variant={destructive ? 'danger-fill' : 'primary'}
              pending={pending}
              pendingText={pendingLabel}
              onClick={confirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
