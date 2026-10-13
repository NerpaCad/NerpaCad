/**
 * Sketch mode state: which plane is being sketched on, the sketch itself, its selection,
 * the active tool and the sketch's own undo history.
 *
 * Every change goes through `edit()`, which runs the constraint solver (in a worker) before the
 * result becomes the current sketch. Edits are queued, so each edit function sees the result of
 * the previous one even when clicks come faster than the solver answers.
 */
import { batch, computed, signal } from '@preact/signals'
import type { Frame } from '../doc/workplane'
import { sketchSolver } from './client'
import type { DragTarget, SolveResult, SolveState } from './solver'
import { type SkConstraint, type Sketch, emptySketch, pointPos } from './types'

export type SketchTool =
  | 'select'
  | 'line'
  | 'spline'
  | 'rect'
  | 'rectCenter'
  | 'circle'
  | 'arc'
  | 'arc3'
  | 'polygon'
  | 'point'
  | 'trim'
  | 'fillet'

export interface SketchSession {
  /** the sketch plane in world space (origin and axes of sketch coordinates) */
  frame: Frame
  /** the shape being re-edited, if any */
  nodeId: string | null
}

export interface SolveInfo {
  state: SolveState
  dof: number
  conflicting: string[]
  redundant: string[]
}

/** True while the user picks a face (or the workplane) to start a sketch on. */
export const sketchPicking = signal(false)
export const session = signal<SketchSession | null>(null)
export const sketch = signal<Sketch>(emptySketch())
export const skSelection = signal<string[]>([])
export const skTool = signal<SketchTool>('line')
/** new geometry is construction (helper) geometry */
export const skConstruction = signal(false)
export const polygonSides = signal(6)
export const filletRadius = signal(3)
export const solveInfo = signal<SolveInfo | null>(null)
/** last rejected change, for a short message; `ids` are the constraints it clashed with */
export const skNotice = signal<{ id: number; key: string; ids: string[] } | null>(null)

interface Snap {
  sketch: Sketch
  sel: string[]
}
const undoStack = signal<Snap[]>([])
const redoStack = signal<Snap[]>([])
export const skCanUndo = computed(() => undoStack.value.length > 0)
export const skCanRedo = computed(() => redoStack.value.length > 0)

export const inSketch = computed(() => session.value !== null)

let queue: Promise<unknown> = Promise.resolve()
let noticeId = 0
/** bumped when a session starts or ends: queued work from an older session must not touch the new one */
let epoch = 0

function info(r: SolveResult): SolveInfo {
  return { state: r.state, dof: r.dof, conflicting: r.conflicting, redundant: r.redundant }
}

export function notice(key: string, ids: string[] = []): void {
  skNotice.value = { id: ++noticeId, key, ids }
}

export function startSession(
  frame: Frame,
  initial: Sketch = emptySketch(),
  nodeId: string | null = null,
  tool: SketchTool = 'line'
): void {
  epoch++
  dragBase = null
  dragLast = []
  batch(() => {
    session.value = { frame, nodeId }
    sketch.value = initial
    skSelection.value = []
    undoStack.value = []
    redoStack.value = []
    solveInfo.value = null
    skTool.value = tool
    skConstruction.value = false
    sketchPicking.value = false
  })
  void resolve()
}

export function endSession(): void {
  epoch++
  dragBase = null
  dragLast = []
  batch(() => {
    session.value = null
    sketch.value = emptySketch()
    skSelection.value = []
    undoStack.value = []
    redoStack.value = []
    solveInfo.value = null
  })
}

/** Solve the current sketch (e.g. after opening) without recording history. */
export function resolve(): Promise<void> {
  const ep = epoch
  return enqueue(async () => {
    if (ep !== epoch) return
    const cur = sketch.value
    const r = await sketchSolver.solve(cur)
    if (ep !== epoch || sketch.value !== cur) return
    batch(() => {
      if (r.state === 'ok' || r.state === 'redundant') sketch.value = r.sketch
      solveInfo.value = info(r)
    })
  })
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn)
  queue = p.catch(() => undefined)
  return p
}

export interface EditOptions {
  /** selection after the edit */
  sel?: (s: Sketch) => string[]
  /**
   * When the change makes the constraints contradict each other, try this instead
   * (e.g. the same geometry without the automatic constraints).
   */
  fallback?: (s: Sketch) => Sketch | null
  /** message key shown when the change is rejected */
  rejectKey?: string
  /** also reject a change that only repeats what other constraints already say */
  strict?: boolean
  /** called with the applied sketch (e.g. to open the new dimension for typing) */
  after?: (s: Sketch) => void
}

/**
 * Change the sketch as one undo step. `fn` gets the current sketch (after all earlier edits) and
 * returns the new one (or null for no change). A change that leaves the constraints in conflict
 * is rejected. Resolves to whether the change was applied.
 */
export function edit(fn: (s: Sketch) => Sketch | null, opts: EditOptions = {}): Promise<boolean> {
  const ep = epoch
  return enqueue(async () => {
    // no edits from an older session, and none in the middle of a drag
    if (ep !== epoch || !session.value || dragBase) return false
    const before = sketch.value
    let next = fn(before)
    if (!next || next === before) return false
    const known = solveInfo.value?.redundant.length ?? 0
    const bad = (x: SolveResult) => x.state === 'conflict' || x.state === 'failed'
    const extra = (x: SolveResult) => x.redundant.length > known
    let r = await sketchSolver.solve(next)
    if ((bad(r) || extra(r)) && opts.fallback) {
      const alt = opts.fallback(before)
      if (alt) {
        const r2 = await sketchSolver.solve(alt)
        if (!bad(r2)) {
          next = alt
          r = r2
        }
      }
    }
    if (ep !== epoch || !session.value || sketch.value !== before) return false
    if (bad(r)) {
      notice(opts.rejectKey ?? (r.state === 'conflict' ? 'sk.conflict' : 'sk.failed'), r.conflicting)
      return false
    }
    if (opts.strict && extra(r)) {
      notice('sk.redundantNew', r.redundant)
      return false
    }
    batch(() => {
      undoStack.value = [...undoStack.value.slice(-199), { sketch: before, sel: skSelection.value }]
      redoStack.value = []
      sketch.value = r.sketch
      solveInfo.value = info(r)
      const ids = alive(r.sketch)
      skSelection.value = (opts.sel ? opts.sel(r.sketch) : skSelection.value).filter((id) => ids.has(id))
    })
    opts.after?.(r.sketch)
    return true
  })
}

function alive(s: Sketch): Set<string> {
  return new Set([...s.points.map((p) => p.id), ...s.curves.map((c) => c.id), ...s.constraints.map((c) => c.id)])
}

// ---------------------------------------------------------------- dragging

let dragBase: Sketch | null = null
let dragSel: string[] = []
let dragLast: DragTarget[] = []

let dragEpoch = 0
/**
 * Radius and diameter dimensions of the arcs and circles being dragged (by their centre, their
 * ends or the curve itself). They let go for the drag and take the new size at the end, so a
 * fillet can be made bigger or smaller by pulling it; null until the first move.
 */
let dragReleased: Set<string> | null = null

/** The dimension ids that let go when these points or curves are pulled. */
export function releasedBy(s: Sketch, ids: string[]): Set<string> {
  const pulled = new Set(ids)
  const out = new Set<string>()
  for (const k of s.constraints) {
    if (k.type !== 'radius' && k.type !== 'diameter') continue
    const c = s.curves.find((x) => x.id === k.refs[0])
    if (!c || (c.kind !== 'arc' && c.kind !== 'circle')) continue
    const own = c.kind === 'arc' ? [c.id, c.c, c.start, c.end] : [c.id, c.c]
    if (own.some((id) => pulled.has(id))) out.add(k.id)
  }
  return out
}

/** The sketch without the released dimensions (what the solver works on while dragging). */
const withoutReleased = (s: Sketch, rel: Set<string>): Sketch => (rel.size ? { ...s, constraints: s.constraints.filter((k) => !rel.has(k.id)) } : s)

/** Put the released dimensions back, each set to the size its curve has now. */
function restoreReleased(solved: Sketch, all: SkConstraint[], rel: Set<string>): Sketch {
  if (!rel.size) return solved
  const size = (k: SkConstraint): number | undefined => {
    const c = solved.curves.find((x) => x.id === k.refs[0])
    if (!c || (c.kind !== 'arc' && c.kind !== 'circle')) return k.value
    let r = c.r
    if (c.kind === 'arc') {
      const ctr = pointPos(solved, c.c)
      const a = pointPos(solved, c.start)
      if (ctr && a) r = Math.hypot(a[0] - ctr[0], a[1] - ctr[1])
    }
    const v = k.type === 'diameter' ? 2 * r : r
    return Math.round(v * 1000) / 1000
  }
  return { ...solved, constraints: all.map((k) => (rel.has(k.id) ? { ...k, value: size(k) } : k)) }
}

export function beginDrag(): void {
  dragBase = sketch.value
  dragSel = skSelection.value
  dragEpoch = epoch
  dragReleased = null
}

/** Move while dragging: solved as fast as the solver keeps up; stale answers are skipped. */
export function dragTo(targets: DragTarget[]): void {
  if (!dragBase) return
  dragLast = targets
  const rel = (dragReleased ??= releasedBy(dragBase, targets.map((t) => t.id)))
  const from = sketch.value
  const all = dragBase.constraints
  void sketchSolver.solveLatest(withoutReleased(from, rel), targets).then((r) => {
    // skip answers for an older drag, another session or a sketch that changed meanwhile
    if (!r || !dragBase || dragEpoch !== epoch || dragBase.constraints !== all) return
    if (r.state === 'ok' || r.state === 'redundant') {
      batch(() => {
        sketch.value = restoreReleased(r.sketch, all, rel)
        solveInfo.value = info(r)
      })
    }
  })
}

/** Finish a drag: one final solve toward the last targets, recorded as one undo step. */
export function endDrag(): Promise<void> {
  const base = dragBase
  const sel = dragSel
  const targets = dragLast
  const rel = dragReleased ?? new Set<string>()
  dragBase = null
  dragLast = []
  dragReleased = null
  if (!base) return Promise.resolve()
  const ep = epoch
  return enqueue(async () => {
    if (ep !== epoch) return
    const from = sketch.value
    const r = targets.length ? await sketchSolver.solve(withoutReleased(from, rel), targets) : null
    // released dimensions come back with the size the drag gave them
    const final = r && (r.state === 'ok' || r.state === 'redundant') ? restoreReleased(r.sketch, base.constraints, rel) : from
    // settle without the drag pull, so the stored sketch satisfies every constraint exactly
    const settled = await sketchSolver.solve(final)
    if (ep !== epoch) return
    batch(() => {
      const out = settled.state === 'ok' || settled.state === 'redundant' ? settled.sketch : final
      if (out !== base) {
        undoStack.value = [...undoStack.value.slice(-199), { sketch: base, sel }]
        redoStack.value = []
      }
      sketch.value = out
      solveInfo.value = info(settled)
    })
  })
}

export function cancelDrag(): void {
  if (!dragBase) return
  const base = dragBase
  dragBase = null
  dragLast = []
  dragReleased = null
  const ep = epoch
  void enqueue(async () => {
    if (ep !== epoch) return
    sketch.value = base
    await resolveNow(ep)
  })
}

async function resolveNow(ep: number) {
  const r = await sketchSolver.solve(sketch.value)
  if (ep === epoch) solveInfo.value = info(r)
}

export const isDragging = () => dragBase !== null

// ---------------------------------------------------------------- moving a dimension

let placeBase: Sketch | null = null

/** Start moving a dimension's graphics (nothing is solved: only where it is drawn changes). */
export function beginPlace(): void {
  if (!session.value || dragBase) return
  placeBase = sketch.value
}

/** Draw dimension `id` at `place` (see SkConstraint.place) while it is being moved. */
export function previewPlace(id: string, place: number[]): void {
  if (!placeBase) return
  const s = sketch.value
  sketch.value = { ...s, constraints: s.constraints.map((c) => (c.id === id ? { ...c, place } : c)) }
}

/** Finish moving a dimension: one undo step. */
export function endPlace(): void {
  const base = placeBase
  placeBase = null
  if (!base || sketch.value === base) return
  undoStack.value = [...undoStack.value.slice(-199), { sketch: base, sel: skSelection.value }]
  redoStack.value = []
}

export function cancelPlace(): void {
  if (placeBase) sketch.value = placeBase
  placeBase = null
}

export const isPlacing = () => placeBase !== null

// ---------------------------------------------------------------- undo

export function skUndo(): void {
  const ep = epoch
  void enqueue(async () => {
    const u = undoStack.value
    if (ep !== epoch || !u.length || dragBase) return
    const prev = u[u.length - 1]
    batch(() => {
      undoStack.value = u.slice(0, -1)
      redoStack.value = [...redoStack.value, { sketch: sketch.value, sel: skSelection.value }]
      sketch.value = prev.sketch
      skSelection.value = prev.sel
    })
    await resolveNow(ep)
  })
}

export function skRedo(): void {
  const ep = epoch
  void enqueue(async () => {
    const r = redoStack.value
    if (ep !== epoch || !r.length || dragBase) return
    const next = r[r.length - 1]
    batch(() => {
      redoStack.value = r.slice(0, -1)
      undoStack.value = [...undoStack.value, { sketch: sketch.value, sel: skSelection.value }]
      sketch.value = next.sketch
      skSelection.value = next.sel
    })
    await resolveNow(ep)
  })
}

/** Wait until every queued edit has been solved and applied (tests, finishing the sketch). */
export function settled(): Promise<void> {
  return enqueue(async () => undefined)
}
