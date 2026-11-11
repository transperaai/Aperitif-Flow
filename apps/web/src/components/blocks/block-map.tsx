// A small, still picture of a block's steps for the library's cards: boxes for steps, outlined boxes for groups, lines for the
// connections. Drawn as SVG from the block's own positions, scaled to fit; no canvas, so a page of cards stays light.

import { absolutePositions, isGroup, type BlockBundle } from "@transpera-flow/db";

const STEP = { w: 150, h: 40 };
const PAD = 14;
const GROUP_TOP = 26;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where each step and group is drawn: steps at their place on the canvas, groups around whatever is inside them. */
export function blockBoxes(raw: BlockBundle): Map<string, Box> {
  const block = tidy(raw);
  const abs = absolutePositions(block.steps);
  const boxes = new Map<string, Box>();
  for (const s of block.steps) if (!isGroup(s)) boxes.set(s.id, { ...abs.get(s.id)!, w: STEP.w, h: STEP.h });
  const depth = (id: string) => {
    let d = 0;
    for (let p = block.steps.find((s) => s.id === id)?.parent_step_id ?? null; p; p = block.steps.find((s) => s.id === p)?.parent_step_id ?? null) d++;
    return d;
  };
  // Innermost groups first, so an outer group wraps the inner ones.
  const groups = block.steps.filter((s) => isGroup(s)).sort((a, b) => depth(b.id) - depth(a.id));
  for (const g of groups) {
    const kids = block.steps.filter((s) => s.parent_step_id === g.id).map((s) => boxes.get(s.id)).filter((b): b is Box => !!b);
    const own = abs.get(g.id)!;
    if (!kids.length) {
      boxes.set(g.id, { ...own, w: STEP.w, h: STEP.h });
      continue;
    }
    const x = Math.min(...kids.map((k) => k.x)) - 12;
    const y = Math.min(...kids.map((k) => k.y)) - GROUP_TOP;
    boxes.set(g.id, { x, y, w: Math.max(...kids.map((k) => k.x + k.w)) + 12 - x, h: Math.max(...kids.map((k) => k.y + k.h)) + 12 - y });
  }
  return boxes;
}

const clip = (text: unknown, max: number) => {
  const t = typeof text === "string" ? text : "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * What can be drawn of a block: steps that are objects with an id and a position, and edges between those. A stored block is checked
 * when it is saved, but a solution idea's steps (A52) come from outside, so a bad one draws less rather than breaking the page.
 */
function tidy(block: BlockBundle): BlockBundle {
  const steps = (Array.isArray(block?.steps) ? block.steps : []).filter(
    (s) => typeof s === "object" && s !== null && typeof s.id === "string" && Number.isFinite(Number(s.x)) && Number.isFinite(Number(s.y)),
  );
  const ids = new Set(steps.map((s) => s.id));
  const edges = (Array.isArray(block?.edges) ? block.edges : []).filter((e) => typeof e === "object" && e !== null && ids.has(e.from_step_id) && ids.has(e.to_step_id));
  return { steps, edges, entry_step_id: block?.entry_step_id ?? null };
}

export function BlockMap({ block: raw, label }: { block: BlockBundle; label: string }) {
  const block = tidy(raw);
  const boxes = blockBoxes(block);
  const all = [...boxes.values()];
  if (!all.length) return <p className="rounded-token border border-dashed border-line p-3 text-xs text-muted-foreground">No steps in this block yet.</p>;
  const x0 = Math.min(...all.map((b) => b.x)) - PAD;
  const y0 = Math.min(...all.map((b) => b.y)) - PAD;
  const w = Math.max(...all.map((b) => b.x + b.w)) + PAD - x0;
  const h = Math.max(...all.map((b) => b.y + b.h)) + PAD - y0;
  const groups = block.steps.filter((s) => isGroup(s));
  const steps = block.steps.filter((s) => !isGroup(s));
  return (
    <svg role="img" aria-label={label} viewBox={`${x0} ${y0} ${w} ${h}`} preserveAspectRatio="xMinYMid meet" className="h-32 w-full text-fg" data-block-map>
      <defs>
        <marker id="block-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" className="fill-fg-3" />
        </marker>
      </defs>
      {groups.map((g) => {
        const b = boxes.get(g.id)!;
        return (
          <g key={g.id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className="fill-panel-2 stroke-line-2" strokeDasharray="5 3" />
            <text x={b.x + 8} y={b.y + 16} className="fill-fg-2" fontSize={12} fontWeight={600}>
              {clip(g.name, 28)}
            </text>
          </g>
        );
      })}
      {block.edges.map((e) => {
        const a = boxes.get(e.from_step_id);
        const c = boxes.get(e.to_step_id);
        if (!a || !c) return null;
        const ax = a.x + a.w;
        const ay = a.y + a.h / 2;
        const cx = c.x;
        const cy = c.y + c.h / 2;
        const mid = (ax + cx) / 2;
        return <path key={e.id} d={`M${ax} ${ay} C${mid} ${ay} ${mid} ${cy} ${cx} ${cy}`} fill="none" className="stroke-fg-3" strokeWidth={1.5} markerEnd="url(#block-arrow)" />;
      })}
      {steps.map((s) => {
        const b = boxes.get(s.id)!;
        return (
          <g key={s.id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} className="fill-panel stroke-line-2" />
            <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 4} textAnchor="middle" className="fill-fg" fontSize={13}>
              {clip(s.name, 20)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
