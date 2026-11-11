// Client-side state for one field saved on its own (PRD D14,
// docs/adr/0001-per-field-saves.md). Framework-free so it can be unit tested;
// `useField` wraps it for React.

/** A value one field can hold: a column value, or a set of ids held in a link table. */
export type FieldValue = string | number | boolean | null | readonly string[];

export type SaveOutcome<T extends FieldValue = FieldValue> =
  | { status: "saved"; value: T }
  /** Someone else saved this field since we loaded it; `theirs` is what is stored now. */
  | { status: "conflict"; theirs: T }
  /** The record is gone, or the user may not edit it. */
  | { status: "not_found" }
  | { status: "error"; message: string };

/** Convert the values in an outcome, e.g. between a number and the text an input shows. */
export function mapOutcome<A extends FieldValue, B extends FieldValue>(
  outcome: SaveOutcome<A>,
  f: (value: A) => B,
): SaveOutcome<B> {
  if (outcome.status === "saved") return { status: "saved", value: f(outcome.value) };
  if (outcome.status === "conflict") return { status: "conflict", theirs: f(outcome.theirs) };
  return outcome;
}

/** Saves `next` if the stored value is still `base`. */
export type Saver<T extends FieldValue> = (base: T, next: T) => Promise<SaveOutcome<T>>;

export interface FieldState<T extends FieldValue> {
  /** Last value known to be stored: what the server checks against. */
  base: T;
  /** What the input shows. */
  draft: T;
  phase: "idle" | "saving" | "conflict" | "error";
  /** The stored value, while in conflict. */
  theirs?: T;
  message?: string;
}

/** Equality for field values; id sets compare regardless of order. */
export function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sb = [...b].sort();
    return [...a].sort().every((v, i) => v === sb[i]);
  }
  return a === b;
}

export const SAVE_FAILED_MESSAGE = "Couldn't save. Check your connection and try again.";
export const NOT_FOUND_MESSAGE = "This record was removed, or you don't have permission to edit it.";

export class FieldController<T extends FieldValue> {
  private state: FieldState<T>;
  private listeners = new Set<() => void>();
  // Saves run one at a time so each uses the base the previous one stored.
  private queue: Promise<void> = Promise.resolve();

  constructor(
    value: T,
    private saver: Saver<T>,
  ) {
    this.state = { base: value, draft: value, phase: "idle" };
  }

  getState = (): FieldState<T> => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setSaver(saver: Saver<T>): void {
    this.saver = saver;
  }

  get dirty(): boolean {
    return !sameValue(this.state.draft, this.state.base);
  }

  /** The input changed; nothing is saved until `commit`. */
  edit(value: T): void {
    this.set({ draft: value });
  }

  /** Save the draft (or `value`, which also becomes the draft). */
  commit(value: T = this.state.draft): Promise<void> {
    if (value !== this.state.draft) this.set({ draft: value });
    return this.enqueue(async () => {
      // A conflict waits for the user to pick a side.
      if (this.state.phase === "conflict") return;
      if (sameValue(value, this.state.base)) {
        if (this.state.phase === "error") this.set({ phase: "idle", message: undefined });
        return;
      }
      await this.run(this.state.base, value);
    });
  }

  /** Resolve a conflict by saving our value over theirs. */
  keepMine(): Promise<void> {
    return this.enqueue(async () => {
      if (this.state.phase !== "conflict") return;
      await this.run(this.state.theirs as T, this.state.draft);
    });
  }

  /** Resolve a conflict by taking the stored value. */
  keepTheirs(): void {
    if (this.state.phase !== "conflict") return;
    const theirs = this.state.theirs as T;
    this.set({ base: theirs, draft: theirs, phase: "idle", theirs: undefined, message: undefined });
  }

  /** Discard an unsaved edit or error. */
  revert(): void {
    if (this.state.phase === "saving") return;
    this.set({ draft: this.state.base, phase: "idle", theirs: undefined, message: undefined });
  }

  /** The page reloaded with a new stored value. Adopted unless the user has unsaved work. */
  external(value: T): void {
    if (this.state.phase !== "idle" || this.dirty || sameValue(value, this.state.base)) return;
    this.set({ base: value, draft: value });
  }

  private async run(base: T, next: T): Promise<void> {
    this.set({ phase: "saving", message: undefined });
    let outcome: SaveOutcome<T>;
    try {
      outcome = await this.saver(base, next);
    } catch {
      // Network failure, or a server error whose details stay on the server.
      outcome = { status: "error", message: SAVE_FAILED_MESSAGE };
    }
    switch (outcome.status) {
      case "saved": {
        // Keep anything typed while the save was in flight.
        const draft = sameValue(this.state.draft, next) ? outcome.value : this.state.draft;
        this.set({ base: outcome.value, draft, phase: "idle", theirs: undefined });
        break;
      }
      case "conflict":
        this.set({ phase: "conflict", theirs: outcome.theirs });
        break;
      case "not_found":
        this.set({ phase: "error", message: NOT_FOUND_MESSAGE });
        break;
      case "error":
        this.set({ phase: "error", message: outcome.message });
        break;
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  private set(patch: Partial<FieldState<T>>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}
