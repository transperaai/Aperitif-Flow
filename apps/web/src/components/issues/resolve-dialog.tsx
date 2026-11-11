"use client";

// The Resolve dialog (issue #113, A48; prototype: "Resolve #N"): how the issue was resolved (a solution fixed it, we
// changed the process directly, or it is no longer a problem) and a note. It only collects them; the caller saves.

import { useState } from "react";
import type { ResolveHow } from "@transpera-flow/db";
import { Help, HelpLabel } from "@/components/help";
import { RESOLVE_HELP } from "@/lib/issues/help";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { RESOLVE_SOLUTION_HELP } from "@/lib/solutions/help";
import { MAX_NOTE } from "@/lib/issues/validate";
import { RESOLVE_HOW_LABELS } from "@/lib/issues/pages";


const OPTIONS: { how: ResolveHow; help: (typeof RESOLVE_HELP)[keyof typeof RESOLVE_HELP]; text: string }[] = [
  { how: "solution", help: RESOLVE_HELP.solution, text: "One of the solutions you tested is now in the live process." },
  { how: "process_change", help: RESOLVE_HELP.process, text: "Fixed in the Editor without a separate solution." },
  { how: "not_a_problem", help: RESOLVE_HELP.gone, text: "Something else changed, or it was a one-off." },
];

/** A solution linked to the issue, which can be picked as the one that fixed it. */
export interface ResolveSolutionOption {
  id: string;
  name: string;
  /** The verdict that counts: yours, else the automatic one; null when neither exists. */
  verdict: "pass" | "fail" | null;
}

export interface ResolveDialogProps {
  open: boolean;
  /** The solutions linked to this issue (A50): "A solution fixed it" asks which one. */
  solutions?: readonly ResolveSolutionOption[];
  issueNumber: number | null;
  issueTitle: string;
  onSubmit: (how: ResolveHow, note: string | null, solution: { id: string; name: string } | null) => Promise<unknown>;
  onClose: () => void;
  busy?: boolean;
  error?: string | null;
}

export function ResolveDialog(props: ResolveDialogProps) {
  const { open, issueNumber, issueTitle, onClose } = props;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[92svh] overflow-y-auto sm:max-w-lg"
        data-resolve-dialog
        onOpenAutoFocus={(e) => {
          // Not the first (i): its popover would cover the options. Focus the chosen option.
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>("input[type=radio]:checked")?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{issueNumber ? `Resolve #${issueNumber}` : "Resolve issue"}</DialogTitle>
          <DialogDescription>{issueTitle}</DialogDescription>
        </DialogHeader>
        {open && <Form {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ onSubmit, onClose, busy, error, solutions = [] }: ResolveDialogProps) {
  const [how, setHow] = useState<ResolveHow>("process_change");
  // The best verdict first, so the likely one is already chosen.
  const ordered = [...solutions].sort((a, b) => Number(b.verdict === "pass") - Number(a.verdict === "pass"));
  const [picked, setPicked] = useState("");
  const pick = how === "solution" ? (ordered.find((s) => s.id === picked) ?? ordered[0] ?? null) : null;
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const submit = async () => {
    setWorking(true);
    try {
      if (await onSubmit(how, note.trim() || null, pick ? { id: pick.id, name: pick.name } : null)) onClose();
    } finally {
      setWorking(false);
    }
  };
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="flex items-center text-xs font-medium text-muted-foreground uppercase">
          {RESOLVE_HELP.how.label}
          <Help {...RESOLVE_HELP.how} />
        </legend>
        <div role="radiogroup" aria-label="How was it resolved?" className="flex flex-col gap-1.5">
          {OPTIONS.map(({ how: h, help, text }) => {
            return (
              <label
                key={h}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${how === h ? "border-accent bg-accent/10" : "border-border"} cursor-pointer`}
              >
                <input type="radio" name="resolve-how" className="mt-1" checked={how === h} onChange={() => setHow(h)} />
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center font-medium">
                    {RESOLVE_HOW_LABELS[h]}
                    <Help {...help} />
                  </span>
                  <span className="text-xs text-muted-foreground">{text}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {how === "solution" &&
        (ordered.length ? (
          <label className="flex flex-col gap-0.5" data-resolve-solution>
            <HelpLabel {...RESOLVE_SOLUTION_HELP} />
            <NativeSelect aria-label="Which solution fixed it?" value={pick?.id ?? ""} onChange={(e) => setPicked(e.target.value)}>
              {ordered.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.verdict ? s.verdict.toUpperCase() : "NOT CHECKED"}
                </option>
              ))}
            </NativeSelect>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground" data-resolve-no-solution>
            No solutions have been tested for this issue yet, so it will be recorded as fixed by a solution without naming one.
          </p>
        ))}

      <label className="flex flex-col gap-0.5">
        <HelpLabel {...RESOLVE_HELP.note} />
        <Textarea value={note} maxLength={MAX_NOTE} placeholder="e.g. Built into Sales version 8" onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="text-xs text-muted-foreground">The issue leaves the map and the open list, but keeps its history and its solutions.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={working || busy}>
          Mark resolved
        </Button>
      </DialogFooter>
    </form>
  );
}
