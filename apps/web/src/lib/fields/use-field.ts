"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { FieldController, type FieldState, type FieldValue, type Saver } from "./field-controller";

export interface Field<T extends FieldValue> extends FieldState<T> {
  edit(value: T): void;
  commit(value?: T): Promise<void>;
  keepMine(): Promise<void>;
  keepTheirs(): void;
  revert(): void;
}

/**
 * One independently saved field. `value` is the stored value from the server;
 * `save` writes a new value if the stored one is still `base`.
 */
export function useField<T extends FieldValue>(value: T, save: Saver<T>): Field<T> {
  const [ctl] = useState(() => new FieldController(value, save));
  useEffect(() => ctl.setSaver(save), [ctl, save]);
  useEffect(() => ctl.external(value), [ctl, value]);
  const state = useSyncExternalStore(ctl.subscribe, ctl.getState, ctl.getState);
  return {
    ...state,
    edit: (v) => ctl.edit(v),
    commit: (v) => ctl.commit(v),
    keepMine: () => ctl.keepMine(),
    keepTheirs: () => ctl.keepTheirs(),
    revert: () => ctl.revert(),
  };
}
