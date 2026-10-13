/**
 * Application state: the document, the selection and undo/redo history.
 * Undo stores whole Doc snapshots; since docs are immutable and share structure this is cheap.
 */
import { batch, computed, signal } from '@preact/signals'
import { type Doc, type DocNode, emptyDoc, findNode, sameContent, type SceneId, withScene } from './model'
import type { Frame } from './workplane'
import { syncSymmetry } from './symmetry'

const MAX_HISTORY = 200

export const doc = signal<Doc>(emptyDoc())
export const selection = signal<string[]>([])
export const gridStep = signal<number>(1)
/** No document edits while a robotics simulation is on screen. */
export const editLocked = signal(false)

/** The ZY and ZX reference planes of the 3D scene (hidden by default). UI state, not saved. */
export const refPlanes = signal<{ zy: boolean; zx: boolean }>({ zy: false, zx: false })

/** Active workplane (null = the ground). UI state: not part of the document or undo. */
export const workplane = signal<Frame | null>(null)
/** True while the user is picking a face to put the workplane on. */
export const placingWorkplane = signal(false)

/**
 * The ruler (TinkerCad style): an origin with X/Y legs along the workplane it was placed on.
 * Selected shapes show their distance from it; `mode` measures to their near edge or center.
 */
export const ruler = signal<Frame | null>(null)
export const placingRuler = signal(false)
export const rulerMode = signal<'edge' | 'center'>('edge')

/** A history entry remembers the selection too, so undo/redo restores what was selected. */
interface Snapshot {
  doc: Doc
  sel: string[]
}
const undoStack = signal<Snapshot[]>([])
const redoStack = signal<Snapshot[]>([])
export const canUndo = computed(() => undoStack.value.length > 0)
export const canRedo = computed(() => redoStack.value.length > 0)

/** File state: `savedDoc` is the doc as last saved/opened; dirty when it differs. */
export const filePath = signal<string | null>(null)
export const fileName = signal<string | null>(null)
const savedDoc = signal<Doc>(doc.value)
// switching between the 3D model and the robotics field is not an edit
export const dirty = computed(() => !sameContent(doc.value, savedDoc.value))

let gestureBase: Doc | null = null
let gestureSel: string[] = []
const snap = (): Snapshot => ({ doc: doc.value, sel: selection.value })

export const selectedNodes = computed<DocNode[]>(() => {
  const d = doc.value
  return selection.value.map((id) => d.nodes.find((n) => n.id === id)).filter(Boolean) as DocNode[]
})

/** Rules that keep an edited document consistent (e.g. things stay on the robotics terrain). */
const fixers: ((prev: Doc, next: Doc) => Doc)[] = []
export function addCommitFixer(fn: (prev: Doc, next: Doc) => Doc): void {
  if (!fixers.includes(fn)) fixers.push(fn)
}
const fixed = (prev: Doc, next: Doc) => (prev.scene !== next.scene ? next : fixers.reduce((d, f) => f(prev, d), next))

/** Apply a new document as one undoable step. */
export function commit(proposed: Doc, sel?: string[]): void {
  if (editLocked.peek()) return
  batch(() => {
    // a commit in the middle of a drag first records the drag as its own step
    if (gestureBase) endGesture()
    // symmetry mode: the twins follow whatever was changed
    const next = fixed(doc.value, syncSymmetry(doc.value, proposed))
    if (next !== doc.value) {
      undoStack.value = [...undoStack.value.slice(-MAX_HISTORY + 1), snap()]
      redoStack.value = []
      doc.value = next
    }
    if (sel) selection.value = sel
  })
}

/** Start a continuous edit (drag). Intermediate states are not recorded. */
export function beginGesture(): Doc {
  gestureBase = doc.value
  gestureSel = selection.value
  return gestureBase
}

export function previewGesture(next: Doc): void {
  if (gestureBase) doc.value = fixed(gestureBase, syncSymmetry(gestureBase, next))
}

export function endGesture(): void {
  if (!gestureBase) return
  const base = gestureBase
  gestureBase = null
  if (doc.value !== base) {
    undoStack.value = [...undoStack.value.slice(-MAX_HISTORY + 1), { doc: base, sel: gestureSel }]
    redoStack.value = []
  }
}

export function cancelGesture(): void {
  if (!gestureBase) return
  doc.value = gestureBase
  gestureBase = null
}

export const inGesture = () => gestureBase !== null

/** Undo/redo keep the scene on screen: a step made in the other scene changes it out of sight. */
function restore(s: Snapshot): void {
  const w = withScene(s.doc, doc.value.scene)
  // the beautiful view's settings are not editing steps: undo leaves them as they are
  const d = w.view === doc.value.view ? w : { ...w, view: doc.value.view }
  doc.value = d
  selection.value = w === s.doc ? s.sel.filter((id) => d.nodes.some((n) => n.id === id)) : []
}

/**
 * Change the beautiful view's settings: kept in the project (it becomes unsaved) but not an
 * editing step, and allowed during a run (the view can be switched while things move).
 */
export function setDocView(view: Doc['view']): void {
  doc.value = { ...doc.value, view }
}

export function undo(): void {
  const u = undoStack.value
  if (u.length === 0 || gestureBase || editLocked.peek()) return
  batch(() => {
    const prev = u[u.length - 1]
    undoStack.value = u.slice(0, -1)
    redoStack.value = [...redoStack.value, snap()]
    restore(prev)
  })
}

export function redo(): void {
  const r = redoStack.value
  if (r.length === 0 || gestureBase || editLocked.peek()) return
  batch(() => {
    const next = r[r.length - 1]
    redoStack.value = r.slice(0, -1)
    undoStack.value = [...undoStack.value, snap()]
    restore(next)
  })
}

/** Replace the whole document (new/open): clears history. The scene on screen stays. */
export function loadDoc(loaded: Doc, path: string | null, name: string | null): void {
  const d = withScene(loaded, doc.peek().scene)
  batch(() => {
    gestureBase = null
    sceneState.clear()
    doc.value = d
    savedDoc.value = d
    workplane.value = null
    ruler.value = null
    undoStack.value = []
    redoStack.value = []
    selection.value = []
    filePath.value = path
    fileName.value = name
  })
}

/** The document on screen counts as not saved (a project brought back from an autosave). */
export function markUnsaved(): void {
  savedDoc.value = emptyDoc()
}

export function markSaved(path: string, name: string): void {
  batch(() => {
    savedDoc.value = doc.value
    filePath.value = path
    fileName.value = name
  })
}

export function select(ids: string[]): void {
  selection.value = ids
}

export function getNode(id: string): DocNode | undefined {
  return findNode(doc.value.nodes, id)
}

// ---------------------------------------------------------------- scenes

/** What each scene remembers while the other one is on screen. */
interface SceneState {
  sel: string[]
  grid: number
}
const sceneState = new Map<SceneId, SceneState>()
/** The grid step a scene starts with: 1 mm for modelling, 1 cm on the robotics field. */
export const DEFAULT_GRID: Record<SceneId, number> = { model: 1, robo: 10 }

/**
 * Put a scene on screen: the 3D model or the robotics field. Not an edit (no undo step, not
 * "unsaved"); the selection and the grid step of each scene are kept for when it comes back.
 */
export function showScene(scene: SceneId): void {
  const d = doc.peek()
  if (d.scene === scene) return
  if (gestureBase) endGesture()
  batch(() => {
    sceneState.set(d.scene, { sel: selection.peek(), grid: gridStep.peek() })
    const next = withScene(d, scene)
    doc.value = next
    const back = sceneState.get(scene)
    selection.value = back ? back.sel.filter((id) => next.nodes.some((n) => n.id === id)) : []
    gridStep.value = back ? back.grid : DEFAULT_GRID[scene]
  })
}
