'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useStaff } from '../staff-context';
import { DraftController, type DraftSaver, type DraftState } from './controller';
import { claimDraft } from './sync';

/**
 * Whose drafts these are: the signed in staff member, so a shared tablet keeps each person's
 * drafts apart. Signing out deletes them from the device (sign-out-button.tsx).
 */
export function useDraftScope(): string {
  return useStaff().id;
}

export interface AutosaveOptions<T> {
  kind: string;
  id: string;
  /** The record as the server sent it, and its version. */
  serverValue: T;
  serverVersion: number;
  save: DraftSaver<T>;
}

export interface Autosave<T> extends DraftState<T> {
  setValue: (value: T) => void;
  /** Conflict: save this person's edit over the newer version. */
  keepMine: () => void;
  /** Conflict: drop this person's edit and show the saved version. */
  takeSaved: () => void;
}

/**
 * Autosave for one record on a screen (FND-08). Edits are kept on the device at once and saved
 * after a short pause; a draft left by a reload or a lost connection is restored on open.
 */
export function useAutosave<T>({
  kind,
  id,
  serverValue,
  serverVersion,
  save,
}: AutosaveOptions<T>): Autosave<T> {
  const scope = useDraftScope();
  const [controller] = useState(
    () => new DraftController<T>({ scope, kind, id, serverValue, serverVersion, save }),
  );
  useEffect(() => {
    controller.setSaver(save);
  }, [controller, save]);

  useEffect(() => {
    const release = claimDraft(controller as DraftController<unknown>);
    void controller.start();
    const flush = () => void controller.flush();
    window.addEventListener('online', flush);
    return () => {
      window.removeEventListener('online', flush);
      release();
      // Save what is left; the draft is on the device either way.
      void controller.flush();
    };
  }, [controller]);

  const state = useSyncExternalStore(
    useCallback((onChange) => controller.subscribe(onChange), [controller]),
    () => controller.getState(),
    () => controller.getState(),
  );

  return {
    ...state,
    setValue: useCallback(
      (value: T) => {
        controller.setValue(value);
      },
      [controller],
    ),
    keepMine: useCallback(() => void controller.keepMine(), [controller]),
    takeSaved: useCallback(() => void controller.takeSaved(), [controller]),
  };
}
