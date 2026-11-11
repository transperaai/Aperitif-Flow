// When an (i) help popover is open (issue #98). Pure, so the hover / focus / tap / keyboard rules are unit-tested.
//
// - Hover or keyboard focus shows it; leaving or tabbing away hides it.
// - A click, tap, Enter or Space pins it open (so a phone, which has no hover, can read it); doing it again closes it.
// - Escape closes it.

export interface HelpState {
  open: boolean;
  /** Opened by a click or key press, so moving the pointer away doesn't close it. */
  pinned: boolean;
}

export type HelpEvent = "pointer-enter" | "pointer-leave" | "focus" | "blur" | "activate" | "escape" | "outside";

export const HELP_CLOSED: HelpState = { open: false, pinned: false };

export function helpStep(state: HelpState, event: HelpEvent): HelpState {
  switch (event) {
    case "pointer-enter":
    case "focus":
      return { ...state, open: true };
    case "pointer-leave":
      return state.pinned ? state : { ...state, open: false };
    case "blur":
    case "escape":
    case "outside":
      return HELP_CLOSED;
    case "activate":
      return state.open && state.pinned ? HELP_CLOSED : { open: true, pinned: true };
  }
}
