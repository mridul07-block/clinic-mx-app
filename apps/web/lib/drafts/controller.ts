import type { DraftSaveResponse } from '@clinic-mx/schemas';
import { deleteDraft, draftKey, getDraft, putDraft, type DraftRecord } from './store';

/**
 * Autosave for one record on one screen (FND-08), without React: every change goes to the
 * device at once, and to the server once typing pauses. Offline, or when the save fails, the
 * draft waits on the device and is saved when the connection returns. If someone saved the
 * record meanwhile, nothing is overwritten: the person chooses "Keep my version" or "Use the
 * saved version".
 */

/** Sends a draft to the server. Rejects when the request cannot be made (offline, server down). */
export type DraftSaver<T> = (value: T, baseVersion: number) => Promise<DraftSaveResponse<T>>;

/**
 * - `idle`: nothing changed yet.
 * - `saving`: a save is on its way.
 * - `saved`: the server has the latest edit.
 * - `pending`: the latest edit is only on the device; it is saved when possible.
 * - `conflict`: the record changed elsewhere; waiting for the person to choose.
 */
export type DraftStatus = 'idle' | 'saving' | 'saved' | 'pending' | 'conflict';

export interface DraftState<T> {
  value: T;
  status: DraftStatus;
  /** The saved value and version, when status is `conflict`. */
  conflict?: { version: number; value: T };
}

export interface DraftControllerOptions<T> {
  scope: string;
  kind: string;
  id: string;
  /** The record as the server last sent it. */
  serverValue: T;
  serverVersion: number;
  save: DraftSaver<T>;
  /** Pause after the last change before saving. */
  debounceMs?: number;
  /** Wait before trying again after a failed save while online. */
  retryMs?: number;
  isOnline?: () => boolean;
}

export class DraftController<T> {
  readonly key: string;
  private state: DraftState<T>;
  private baseVersion: number;
  private dirty = false;
  private inFlight: Promise<void> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(state: DraftState<T>) => void>();
  private readonly debounceMs: number;
  private readonly retryMs: number;
  private readonly isOnline: () => boolean;
  private disposed = false;
  private save: DraftSaver<T>;

  constructor(private readonly options: DraftControllerOptions<T>) {
    this.key = draftKey(options.scope, options.kind, options.id);
    this.state = { value: options.serverValue, status: 'idle' };
    this.baseVersion = options.serverVersion;
    this.save = options.save;
    this.debounceMs = options.debounceMs ?? 800;
    this.retryMs = options.retryMs ?? 10_000;
    this.isOnline = options.isOnline ?? (() => navigator.onLine);
  }

  getState(): DraftState<T> {
    return this.state;
  }

  subscribe(listener: (state: DraftState<T>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Restores a draft left on the device (after a reload, say) and tries to save it. */
  async start(): Promise<void> {
    const draft = await getDraft<T>(this.key);
    if (!draft || this.disposed) return;
    this.baseVersion = draft.baseVersion;
    this.dirty = true;
    if (draft.conflict) {
      this.update({ value: draft.value, status: 'conflict', conflict: draft.conflict });
      return;
    }
    this.update({ value: draft.value, status: 'pending' });
    await this.flush();
  }

  /** Records a change: on the device now, on the server after the pause. */
  setValue(value: T): void {
    this.dirty = true;
    const { conflict } = this.state;
    this.update({ value, status: conflict ? 'conflict' : 'pending', conflict });
    void this.persist();
    this.schedule(this.debounceMs);
  }

  /** Saves now if there is anything to save and the connection allows it. */
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.inFlight) {
      await this.inFlight;
      return;
    }
    if (!this.dirty || this.state.status === 'conflict' || this.disposed) return;
    if (!this.isOnline()) {
      this.update({ ...this.state, status: 'pending' });
      return;
    }
    this.inFlight = this.send().finally(() => {
      this.inFlight = undefined;
    });
    await this.inFlight;
  }

  /** Conflict: keep this person's edit and save it over the newer version. */
  async keepMine(): Promise<void> {
    const { conflict } = this.state;
    if (!conflict) return;
    this.baseVersion = conflict.version;
    this.update({ value: this.state.value, status: 'pending' });
    await this.persist();
    await this.flush();
  }

  /** Conflict: drop this person's edit and show what was saved. */
  async takeSaved(): Promise<void> {
    const { conflict } = this.state;
    if (!conflict) return;
    this.baseVersion = conflict.version;
    this.dirty = false;
    this.update({ value: conflict.value, status: 'saved' });
    await this.remove();
  }

  /** Replaces the save function, for example when the screen renders with a new one. */
  setSaver(save: DraftSaver<T>): void {
    this.save = save;
  }

  /** Resolves once every device write and the save on its way have finished. */
  async settled(): Promise<void> {
    for (let pending = true; pending;) {
      const { writes, inFlight } = this;
      await Promise.all([writes, inFlight]);
      pending = writes !== this.writes || inFlight !== this.inFlight;
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }

  private async send(): Promise<void> {
    const sent = this.state.value;
    this.dirty = false;
    this.update({ ...this.state, status: 'saving' });
    let response: DraftSaveResponse<T>;
    try {
      response = await this.save(sent, this.baseVersion);
    } catch {
      // Offline or the server is unreachable: the draft stays on the device.
      this.dirty = true;
      this.update({ ...this.state, status: 'pending' });
      if (this.isOnline()) this.schedule(this.retryMs);
      return;
    }
    if (response.status === 'conflict') {
      this.dirty = true;
      const conflict = { version: response.version, value: response.value };
      this.update({ value: this.state.value, status: 'conflict', conflict });
      await this.persist();
      return;
    }
    this.baseVersion = response.version;
    if (this.state.value !== sent) {
      // Edited again while the save was on its way: keep the draft and save the rest.
      await this.persist();
      this.schedule(this.debounceMs);
      this.update({ ...this.state, status: 'pending' });
    } else {
      await this.remove();
      this.update({ value: this.state.value, status: 'saved' });
    }
  }

  private schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  /** Device writes run one after another, so a late write never revives a deleted draft. */
  private enqueue(write: () => Promise<void>): Promise<void> {
    this.writes = this.writes.then(write, write);
    return this.writes;
  }

  private persist(): Promise<void> {
    const { scope, kind, id } = this.options;
    const draft: DraftRecord<T> = {
      key: this.key,
      scope,
      kind,
      id,
      value: this.state.value,
      baseVersion: this.baseVersion,
      updatedAt: Date.now(),
    };
    if (this.state.conflict) draft.conflict = this.state.conflict;
    return this.enqueue(() => putDraft(draft));
  }

  private remove(): Promise<void> {
    return this.enqueue(() => deleteDraft(this.key));
  }

  private update(state: DraftState<T>): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
