/** User-level commands, shared by the toolbar, inspector, keyboard shortcuts and tests. */
import { settleOnTerrain, standOnTerrain, surfaceOf, turnTerrainPieces } from '../core/robotics/field'
import { DEFAULT_TERRAIN, LAND_COLOR, type LandKind, halfSize, landKindOf, normTerrain, snapTerrain } from '../core/robotics/terrain'
import { changeLand, oneLandPerCell, paintLand } from '../core/robotics/land'
import { type ViewSettings, normView } from '../core/robotics/look'
import { terrainOf } from '../core/robotics/world'
import type { DecorKind, Doc, Species, TerrainKind, TerrainParams } from '../core/doc/model'
import { speciesOf } from '../core/robotics/creatures'
import { batch, effect, signal, untracked } from '@preact/signals'
import {
  type DocNode,
  type ExtrudeDir,
  type PrimNode,
  type SketchOp,
  type PrimType,
  type Vec3,
  type LightParams,
  type RobotSensor,
  type SensorType,
  actorKind,
  actorProgram,
  type TileKind,
  type MaterialKind,
  boxCenter,
  emptyDoc,
  isRoboNode,
  newId,
  withScene
} from '../core/doc/model'
import {
  type AlignMode,
  type Axis,
  addNodes,
  pruneMeshes,
  alignNodes,
  dropToWorkplane,
  duplicateNodes,
  duplicateRepeat,
  groupNodes,
  mirrorNodes,
  moveNodes,
  pasteNodes,
  removeNodes,
  setColor,
  setHole,
  setTransform,
  ungroupNode,
  ungroupWouldDistort,
  updateNodes,
  rotateNodes
} from '../core/doc/ops'
import { DEFAULT_COLORS, companions, createShape } from '../core/doc/shapes'
import { isPart, partDefaults, pieceField } from '../core/doc/parts'
import {
  commit,
  dirty,
  doc,
  fileName,
  filePath,
  gridStep,
  loadDoc,
  markSaved,
  placingRuler,
  placingWorkplane,
  redo as storeRedo,
  selection,
  undo as storeUndo,
  workplane,
  ruler,
  refPlanes,
  showScene,
  addCommitFixer,
  setDocView
} from '../core/doc/store'
import { cellCenter, demoDoc, islandDoc, lampNode, nerpaNode, robotNode, terrainNode, tileNode } from '../core/robotics/demo'
import { DEFAULT_ROBOT, knownRobot, robotSpec } from '../core/robotics/robot'
import { TILE_SIZE } from '../core/robotics/tiles'
import { followId, prettyCap, recording, rememberActor, rememberRobot, roboticsMode, sensorKind, simState } from '../core/robotics/state'
import { stopSim } from './sim'
import { recoverOffer } from './autosave'
import { leaveCircuits } from './circuitActions'
import { stopCircuit } from './circuitSim'
import { circuitSelection, circuitsMode } from '../core/circuit/state'
import { geom } from '../core/geom/client'
import { FileFormatError, importStl, parseDoc, serializeDoc, toObj, toStlBinary } from '../core/io/formats'
import { type Key, lang, t } from '../i18n'
import { currentTheme } from '../themes'
import type { Viewport } from '../view/Viewport'
import {
  endSession,
  session,
  settled,
  skNotice,
  skRedo,
  skUndo,
  sketch,
  sketchPicking
} from '../core/sketch/session'
import { buildProfile } from '../core/sketch/profile'
import { toDxf, toSvg } from '../core/sketch/export'
import { skProblems } from '../view/sketchOverlay'

let vp: Viewport | null = null
export function setViewport(v: Viewport | null): void {
  vp = v
  // the beautiful view lowered its quality (the computer is slow): say so
  if (v) v.onQualityDrop = (q) => notify(t('pretty.dropped', { q: t(`pretty.q.${q}` as Key) }))
}

// ---------------------------------------------------------------- the beautiful view

/** Change the beautiful view's settings (kept in the project, not an undo step, allowed during a run). */
export function setView(patch: Partial<ViewSettings>): void {
  const next = normView({ ...normView(doc.value.view), ...patch })
  // choosing a quality forgets the step down made for a slow computer
  if (patch.quality !== undefined) prettyCap.value = null
  setDocView(next)
}
export const viewport = () => vp

// ---------------------------------------------------------------- notifications

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}
export const toasts = signal<Toast[]>([])
let toastId = 0
export function notify(text: string, kind: Toast['kind'] = 'info'): void {
  const id = ++toastId
  toasts.value = [...toasts.value, { id, text, kind }]
  setTimeout(() => (toasts.value = toasts.value.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
}

// ---------------------------------------------------------------- shapes

const shapeNameKey: Record<PrimType, Key> = {
  box: 'shape.box',
  cylinder: 'shape.cylinder',
  sphere: 'shape.sphere',
  cone: 'shape.cone',
  pyramid: 'shape.pyramid',
  wedge: 'shape.wedge',
  torus: 'shape.torus',
  polygon: 'shape.polygon',
  icosahedron: 'shape.icosahedron',
  hemisphere: 'shape.hemisphere',
  roundRoof: 'shape.roundRoof',
  text: 'shape.text',
  mesh: 'shape.mesh',
  sketch: 'shape.sketch',
  tile: 'shape.tile',
  robot: 'shape.robot',
  light: 'shape.light',
  nerpa: 'shape.nerpa',
  terrain: 'shape.terrain',
  decor: 'shape.decor',
  gear: 'shape.gear',
  bolt: 'shape.bolt',
  nut: 'shape.nut',
  jar: 'shape.jar',
  rack: 'shape.rack',
  wheel: 'shape.wheel',
  pulley: 'shape.pulley',
  washer: 'shape.washer',
  spring: 'shape.spring',
  boxLid: 'shape.boxLid',
  hinge: 'shape.hinge',
  knob: 'shape.knob',
  tag: 'shape.tag'
}
export const shapeName = (p: PrimType) => t(shapeNameKey[p])

/** The name a new shape gets: a two-piece part names its first piece («…: банка»). */
export function newShapeName(p: PrimType): string {
  const pf = isPart(p) ? pieceField(p) : null
  return pf && isPart(p) ? pieceName(p, partDefaults(p)[pf.key] as string) : shapeName(p)
}

/** Add a shape; `place` puts it on the workplane (position + the plane's rotation). */
export function addShape(type: PrimType, place?: { position: Vec3; rotation: Vec3 }): string {
  const n = createShape(type, newShapeName(type), place?.position ?? [0, 0, 0], {
    text: t('shape.textDefault')
  })
  if (place) n.transform = { ...n.transform, rotation: [...place.rotation] }
  const all = [n, ...companions(n, (piece) => pieceName(type, piece))]
  commit(addNodes(doc.value, all), all.map((x) => x.id))
  return n.id
}

/** The name of one piece of a two-piece part: «Банка с крышкой: крышка». */
export const pieceName = (type: PrimType, piece: string) => `${shapeName(type)}: ${t(`part.${type}.piece.${piece}` as Key).toLowerCase()}`

// ---------------------------------------------------------------- selection

export function selectAll(): void {
  selection.value = doc.value.nodes.map((n) => n.id)
}

export function deleteSelected(): void {
  if (!selection.value.length) return
  commit(removeNodes(doc.value, selection.value), [])
}

/** The last duplicate: which nodes were copied to which (for repeating it, as in Tinkercad). */
let lastDuplicate: { from: string[]; to: string[] } | null = null

/**
 * Ctrl+D: a copy in place. When the selection is still the previous copy and it has been moved,
 * turned or resized since, the next copy repeats that change — Ctrl+D, move, Ctrl+D, Ctrl+D…
 * makes an evenly spaced row (or a circle, or a growing series).
 */
export function duplicate(): void {
  const sel = selection.value
  if (!sel.length) return
  const d = doc.value
  const last = lastDuplicate
  if (last && last.to.length === sel.length && last.to.every((id) => sel.includes(id))) {
    const r = duplicateRepeat(d, last.from, last.to)
    if (r) {
      lastDuplicate = { from: last.to, to: r.ids }
      commit(r.doc, r.ids)
      return
    }
  }
  // copies come out in document order: pair them with their originals in the same order
  const set = new Set(sel)
  const from = d.nodes.filter((n) => set.has(n.id)).map((n) => n.id)
  const r = duplicateNodes(d, sel, [0, 0, 0])
  lastDuplicate = { from, to: r.ids }
  commit(r.doc, r.ids)
}

let clipboard: { nodes: DocNode[]; meshes: Record<string, import('../core/doc/model').MeshData> } | null =
  null
let pasteCount = 0

export function copy(): void {
  const set = new Set(selection.value)
  const nodes = doc.value.nodes.filter((n) => set.has(n.id))
  if (!nodes.length) return
  clipboard = { nodes, meshes: doc.value.meshes }
  pasteCount = 0
}

export function cut(): void {
  copy()
  deleteSelected()
}

export function paste(): void {
  if (!clipboard) return
  // tiles and robots belong to the robotics field: they are not pasted into the 3D model
  const nodes = doc.value.scene === 'robo' ? clipboard.nodes : clipboard.nodes.filter((n) => !isRoboNode(n))
  if (!nodes.length) return
  pasteCount++
  const off = 10 * pasteCount
  // terrain lies on the tile grid: a pasted piece goes whole tiles aside
  const grid = nodes.some((n) => n.kind === 'prim' && n.prim === 'terrain')
  const r = pasteNodes(doc.value, nodes, clipboard.meshes, grid ? [TILE_SIZE * pasteCount, 0, 0] : [off, off, 0])
  commit(r.doc, r.ids)
}

export const hasClipboard = () => clipboard !== null

// ---------------------------------------------------------------- edits

/** Selected ids without tiles and robots (they cannot become holes, groups or mirror images). */
function modelIds(ids = selection.value): string[] {
  const set = new Set(ids)
  return doc.value.nodes.filter((n) => set.has(n.id) && !isRoboNode(n)).map((n) => n.id)
}

export function setSelectedHole(isHole: boolean): void {
  const ids = modelIds()
  if (!ids.length) return
  commit(setHole(doc.value, ids, isHole))
}

/** Symmetry mode of the 3D model across the ZY (x) or ZX (y) plane; turning it on shows that plane. */
export function toggleSymmetry(axis: 'x' | 'y'): void {
  const d = doc.value
  if (d.scene !== 'model' || session.value) return
  const cur = d.symmetry ?? {}
  const on = !cur[axis]
  const next = { ...cur, [axis]: on }
  commit({ ...d, symmetry: next.x || next.y ? { ...(next.x ? { x: true } : {}), ...(next.y ? { y: true } : {}) } : undefined })
  if (on) {
    refPlanes.value = { ...refPlanes.value, [axis === 'x' ? 'zy' : 'zx']: true }
    notify(t('sym.onNote'))
  }
}

/** Plain, glowing or glass look for the selected solids (tiles and robots keep theirs). */
export function setSelectedMaterial(kind: MaterialKind): void {
  const ids = modelIds()
  if (!ids.length) return
  commit(
    updateNodes(doc.value, ids, (n) => {
      const { material: _old, ...rest } = n
      return kind === 'normal' ? (rest as DocNode) : ({ ...rest, material: kind } as DocNode)
    })
  )
}

export function setSelectedColor(color: string): void {
  if (!selection.value.length) return
  commit(setColor(doc.value, selection.value, color))
}

export function group(): void {
  const ids = modelIds()
  if (ids.length < selection.value.length) notify(t('robo.noGroup'), 'error')
  if (ids.length < 2 || !vp) return
  // the group frame sits at the bottom-center of its solids (holes only cut, they add no volume)
  const solids = doc.value.nodes.filter((n) => ids.includes(n.id) && !n.isHole).map((n) => n.id)
  const b = vp.selectionBox(solids.length ? solids : ids)
  if (!b) return
  const c = boxCenter(b)
  const r = groupNodes(doc.value, ids, [c[0], c[1], b.min[2]], t('shape.group'))
  if (r) commit(r.doc, [r.id])
}

export function ungroup(): void {
  let d = doc.value
  const out: string[] = []
  let changed = false
  for (const id of selection.value) {
    if (ungroupWouldDistort(d, id)) {
      notify(t('group.distort'), 'error')
      out.push(id)
      continue
    }
    const r = ungroupNode(d, id)
    if (r) {
      d = r.doc
      out.push(...r.ids)
      changed = true
    } else out.push(id)
  }
  if (changed) commit(d, out)
}

export function align(axis: Axis, mode: AlignMode): void {
  const ids = selection.value
  if (ids.length < 2 || !vp) return
  // align along the workplane axes (the world axes when the workplane is on the ground)
  commit(alignNodes(doc.value, ids, axis, mode, vp.wpBoxes(ids), vp.wpAxes()))
}

export function mirror(axis: Axis): void {
  const ids = modelIds()
  if (!ids.length || !vp) return
  const b = vp.wpSelectionBox(ids)
  if (!b) return
  commit(mirrorNodes(doc.value, ids, vp.wpAxes()[axis], vp.fromWp(boxCenter(b))))
}

export function dropSelected(): void {
  const ids = selection.value
  if (!ids.length || !vp) return
  commit(dropToWorkplane(doc.value, ids, vp.wpBoxes(ids), vp.wpAxes()[2]))
}

/** Start picking a face for the workplane (W); pressing again or Esc cancels. */
export function toggleWorkplanePicking(): void {
  placingRuler.value = false
  sketchPicking.value = false
  placingWorkplane.value = !placingWorkplane.value
}

/** Start placing the ruler (R); pressing again or Esc cancels. */
export function toggleRulerPlacing(): void {
  placingWorkplane.value = false
  sketchPicking.value = false
  placingRuler.value = !placingRuler.value
}

// ---------------------------------------------------------------- sketch mode

/** "Sketch" button: pick a face or the workplane to draw on; pressing again cancels. */
export function toggleSketchPicking(): void {
  if (session.value) return
  leaveRobotics()
  leaveCircuits()
  placingWorkplane.value = false
  placingRuler.value = false
  sketchPicking.value = !sketchPicking.value
}

/** Extrude dialog: open while finishing a sketch. */
export const extrudeOpen = signal(false)

/** "Done": check the outline and ask how to extrude it. */
export async function finishSketch(): Promise<void> {
  const ses = session.value
  if (!ses) return
  await settled()
  if (session.value !== ses) return
  const s = sketch.value
  const p = buildProfile(s)
  const ids = new Set([...p.open, ...p.crossing])
  skProblems.value = ids.size ? { sketch: s, ids } : null
  extrudeOpen.value = true
}

/** Back from the extrude dialog to the drawing. */
export function backToSketch(): void {
  extrudeOpen.value = false
}

/** Leave the sketch without making a shape (a re-edited shape keeps its old sketch). */
export function leaveSketch(): void {
  extrudeOpen.value = false
  skProblems.value = null
  endSession()
}

export interface SolidOptions {
  op: SketchOp
  depth: number
  dir: ExtrudeDir
  /** revolve only */
  axis?: string
  angle?: number
  hole: boolean
}

/** Turn the sketch into a shape (or update the shape being re-edited) as one undo step. */
export async function applySketchSolid(opts: SolidOptions): Promise<void> {
  const ses = session.value
  if (!ses || !(opts.depth > 0)) return
  await settled()
  if (session.value !== ses) return
  const s = sketch.value
  const params: PrimNode['params'] =
    opts.op === 'revolve'
      ? { sketch: s, depth: opts.depth, extrude: opts.dir, op: 'revolve', axis: opts.axis ?? 'AY', angle: opts.angle ?? 360 }
      : { sketch: s, depth: opts.depth, extrude: opts.dir, op: 'extrude' }
  if (ses.nodeId && doc.value.nodes.some((n) => n.id === ses.nodeId)) {
    const id = ses.nodeId
    commit(
      updateNodes(doc.value, [id], (n) =>
        n.kind === 'prim' ? { ...n, isHole: opts.hole, params } : n
      ),
      [id]
    )
  } else {
    const count = doc.value.nodes.filter((n) => n.kind === 'prim' && n.prim === 'sketch').length
    const node: PrimNode = createShape('sketch', `${t('shape.sketch')} ${count + 1}`, [...ses.frame.position], {
      params
    })
    node.transform.rotation = [...ses.frame.rotation]
    node.isHole = opts.hole
    commit(addNodes(doc.value, [node]), [node.id])
  }
  extrudeOpen.value = false
  skProblems.value = null
  endSession()
  // turn back to the 3/4 view once the new geometry is there
  const ids = selection.value
  setTimeout(() => vp?.viewShapes(ids), 250)
}

/** Open an extruded sketch shape for editing again. */
export function editSketch(id: string): void {
  vp?.editSketchNode(id)
}

/** Save the current drawing as DXF or SVG. */
export async function exportSketch(kind: 'dxf' | 'svg'): Promise<void> {
  await settled()
  const s = sketch.value
  if (!s.curves.some((c) => !c.construction)) return notify(t('sk.exportEmpty'), 'error')
  const r = await guarded(() =>
    window.api.saveFile({
      kind,
      data: kind === 'dxf' ? toDxf(s) : toSvg(s),
      defaultName: `${t('shape.sketch')}.${kind}`
    })
  )
  if (r) notify(t('export.done', { name: r.name }))
}

/** Leave sketch mode and drop the changes (asks first when something was drawn). */
export function cancelSketch(): void {
  const s = sketch.value
  const edited = session.value?.nodeId
  if (!edited && (s.points.length || s.curves.length) && !window.confirm(t('sk.cancelConfirm'))) return
  leaveSketch()
}

/** "Shapes" button: leave sketch mode (or stop picking a sketch plane). */
export function shapesMode(): void {
  leaveRobotics()
  leaveCircuits()
  if (sketchPicking.value) sketchPicking.value = false
  if (session.value) void finishSketch()
}

effect(() => {
  const n = skNotice.value
  if (n) untracked(() => notify(t(n.key as Key), 'error'))
})

export function resetWorkplane(): void {
  placingWorkplane.value = false
  workplane.value = null
}

export function nudge(dx: number, dy: number, dz: number): void {
  const ids = selection.value
  if (!ids.length) return
  commit(moveNodes(doc.value, ids, [dx, dy, dz]))
}

export function undo(): void {
  stopSim()
  if (session.value) skUndo()
  else storeUndo()
}
export function redo(): void {
  stopSim()
  if (session.value) skRedo()
  else storeRedo()
}

export function selectedGroupIds(): string[] {
  const set = new Set(selection.value)
  return doc.value.nodes.filter((n) => set.has(n.id) && n.kind === 'group').map((n) => n.id)
}

// ---------------------------------------------------------------- files

function confirmDiscard(): boolean {
  if (!dirty.value) return true
  return window.confirm(t('file.confirmDiscard'))
}

export function newProject(): void {
  if (!confirmDiscard()) return
  stopSim()
  stopCircuit()
  circuitSelection.value = []
  leaveSketch()
  sketchPicking.value = false
  vp?.forgetViews()
  loadDoc(emptyDoc(), null, null)
}

/** Run a file operation and show an error toast instead of failing silently. */
async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    notify(t('file.error', { reason: e instanceof Error ? e.message : String(e) }), 'error')
    return undefined
  }
}

export async function openProject(): Promise<void> {
  if (!confirmDiscard()) return
  const f = await guarded(() => window.api.openFile('project'))
  if (f) openProjectData(f.data, f.path, f.name)
}

export function openProjectData(data: ArrayBuffer, path: string | null, name: string | null): void {
  try {
    const d = parseDoc(new TextDecoder().decode(data))
    stopSim()
    stopCircuit()
    circuitSelection.value = []
    leaveSketch()
    sketchPicking.value = false
    vp?.forgetViews()
    loadDoc(d, path, name)
    warnMissingRobots(d)
    setTimeout(() => vp?.fitView(), 300)
  } catch (e) {
    notify(e instanceof FileFormatError ? t('file.badProject') : String(e), 'error')
  }
}

/** A project with robots of mods that are not installed here: say so (they are shown as NerpaBot). */
export function warnMissingRobots(d: Doc): void {
  const missing = new Set<string>()
  for (const n of [...d.nodes, ...d.parked]) if (n.kind === 'prim' && n.params.robot && !knownRobot(n.params.robot.model)) missing.add(n.params.robot.model)
  if (missing.size) notify(t('mods.missing', { ids: [...missing].join(', ') }), 'info')
}

/** Make a robot another model; sensors on pads the new one does not have come off. */
export function setRobotModel(id: string, model: string): void {
  if (!knownRobot(model)) return
  const spec = robotSpec(model)
  commit(
    updateNodes(doc.value, [id], (n) => {
      if (n.kind !== 'prim' || !n.params.robot || n.params.robot.model === model) return n
      const sensors = n.params.robot.sensors.filter((s) => spec.pads.some((p) => p.port === s.port))
      return { ...n, params: { ...n.params, robot: { ...n.params.robot, model, sensors } } }
    })
  )
}

const isLegacyFile = (p: string | null) => !!p && /\.tcad$/i.test(p)

export async function saveProject(saveAs = false): Promise<boolean> {
  const r = await guarded(() =>
    window.api.saveFile({
      kind: 'project',
      data: serializeDoc(doc.value),
      defaultName: (fileName.value ?? t('file.defaultName')).replace(/\.(tcad|nerpa)$/i, '') + '.nerpa',
      // a project opened from an old .tcad file is saved as a new .nerpa next to it
      path: saveAs || isLegacyFile(filePath.value) ? null : filePath.value
    })
  )
  if (!r) return false
  markSaved(r.path, r.name)
  notify(t('file.saved', { name: r.name }))
  return true
}

export async function importStlFile(): Promise<void> {
  const f = await guarded(() => window.api.openFile('stl'))
  if (f) importStlData(f.data, f.name)
}

export function importStlData(data: ArrayBuffer, name: string): void {
  try {
    const mesh = importStl(data)
    const meshId = newId()
    const base = name.replace(/\.stl$/i, '')
    const node = createShape('mesh', base, [0, 0, 0], { params: { meshId } })
    const d = addNodes({ ...doc.value, meshes: { ...doc.value.meshes, [meshId]: mesh } }, [node])
    commit(d, [node.id])
    setTimeout(() => vp?.fitView(), 400)
  } catch (e) {
    notify(e instanceof FileFormatError ? t('file.badStl') : String(e), 'error')
  }
}

export async function exportModel(format: 'stl' | 'obj', onlySelected: boolean): Promise<void> {
  const set = new Set(selection.value)
  // tiles and robots are not part of the model that gets printed
  const nodes = doc.value.nodes.filter((n) => (!onlySelected || set.has(n.id)) && !isRoboNode(n))
  if (!nodes.some((n) => !n.isHole)) {
    notify(t('export.nothing'), 'error')
    return
  }
  const res = await guarded(() => geom.exportMesh(nodes))
  if (!res) return
  if (res.indices.length === 0) {
    notify(t('export.nothing'), 'error')
    return
  }
  if (res.skipped) notify(t('export.skipped', { n: res.skipped }), 'error')
  const base = (fileName.value ?? t('file.defaultName')).replace(/\.(tcad|nerpa)$/i, '')
  const data = format === 'stl' ? toStlBinary(res.positions, res.indices) : toObj(res.positions, res.indices)
  const r = await guarded(() => window.api.saveFile({ kind: format, data, defaultName: `${base}.${format}` }))
  if (r) notify(t('export.done', { name: r.name }))
}

export async function loadStartupFile(): Promise<void> {
  const f = await guarded(() => window.api.startupFile())
  if (f) openProjectData(f.data, f.path, f.name)
  window.api.onOpenFile((file) => {
    if (confirmDiscard()) openProjectData(file.data, file.path, file.name)
  })
}

/** Files dragged from Explorer: .stl is imported, .nerpa (or an old .tcad) is opened. */
export async function openDroppedFiles(files: FileList): Promise<void> {
  for (const file of Array.from(files)) {
    const lower = file.name.toLowerCase()
    if (lower.endsWith('.stl')) {
      const data = await guarded(() => file.arrayBuffer())
      if (data) importStlData(data, file.name)
    } else if (lower.endsWith('.nerpa') || lower.endsWith('.tcad')) {
      if (!confirmDiscard()) return
      const data = await guarded(() => file.arrayBuffer())
      let path: string | null = null
      try {
        path = window.api.pathForFile(file) || null
      } catch {
        path = null
      }
      if (data) openProjectData(data, path, file.name)
      return
    } else {
      notify(t('file.unsupported', { name: file.name }), 'error')
    }
  }
}

// keep the window title and the close-guard in the main process up to date
effect(() => {
  const name = fileName.value ?? t('file.untitled')
  const title = `${dirty.value ? '• ' : ''}${name} — NerpaCad`
  document.title = title
  // a project left by a crash still waiting for an answer keeps its copy even if the window closes
  window.api?.setState({ dirty: dirty.value, title, lang: lang.value, dark: currentTheme().dark, keepAutosave: !!recoverOffer.value })
})

// ---------------------------------------------------------------- robotics

/** The "Robotics" tab: the floor with tiles and robots; the sketch and the workplane are put away. */
export function roboticsTab(): void {
  if (roboticsMode.value) return
  leaveCircuits()
  if (session.value) {
    if (!window.confirm(t('robo.leaveSketch'))) return
    leaveSketch()
  }
  batch(() => {
    sketchPicking.value = false
    placingWorkplane.value = false
    placingRuler.value = false
    workplane.value = null
    ruler.value = null
    roboticsMode.value = true
  })
}

// The robotics tab shows the robotics field, the 3D and sketch tabs the model; circuits keep whichever.
effect(() => {
  const robo = roboticsMode.value
  const circ = circuitsMode.value
  untracked(() => {
    if (!circ) showScene(robo ? 'robo' : 'model')
  })
})

export function leaveRobotics(): void {
  if (!roboticsMode.value) return
  stopSim()
  roboticsMode.value = false
}

/** Snap a point on the floor to the middle of the nearest 300 mm cell. */
export const snapCell = (v: number) => Math.floor(v / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2

const countOf = (prim: 'tile' | 'robot' | 'light' | 'nerpa' | 'terrain' | 'decor') => doc.value.nodes.filter((n) => n.kind === 'prim' && n.prim === prim).length

export function addTile(kind: TileKind, at?: [number, number], angle = 0): string {
  const x = at ? snapCell(at[0]) : freeCell()[0]
  const y = at ? snapCell(at[1]) : freeCell()[1]
  const n = tileNode({ kind, x, y, angle }, `${t(`robo.tile.${kind}` as Key)} ${countOf('tile') + 1}`)
  commit(standOnTerrain(addNodes(doc.value, [n]), [n.id]), [n.id])
  return n.id
}

// ---------------------------------------------------------------- terrain

// whatever stands on a platform or ramp follows it when it is changed, moved or removed
// one landscape tile per cell (a copy or a moved tile replaces the one there), then things settle
addCommitFixer(oneLandPerCell)
addCommitFixer(settleOnTerrain)

/** The highest surface of the field at a floor point (for placing things), mm. */
export const surfaceAt = (x: number, y: number) => surfaceOf(doc.value, x, y)

/** A platform, a ramp or a bridge on the tile grid. */
export function addTerrain(kind: TerrainKind, at?: [number, number], angleDeg = 0): string {
  const p = DEFAULT_TERRAIN[kind]
  const len = p.length ?? 1
  const raw = at ?? emptyCell(doc.value.nodes, kind === 'ramp' ? len : 1)
  const [x, y] = snapTerrain(raw[0], raw[1], (angleDeg * Math.PI) / 180, kind === 'ramp' ? len : 1)
  const n = terrainNode(kind, x, y, angleDeg, `${t(`robo.terrain.${kind}` as Key)} ${countOf('terrain') + 1}`)
  // built on the highest surface there: the floor, a landscape tile or another platform
  commit(standOnTerrain(addNodes(doc.value, [n]), [n.id]), [n.id])
  return n.id
}

/** Change a piece's height (mm) or a ramp's length (1 or 2 tiles); it stays on the grid. */
export function setTerrain(id: string, patch: Partial<TerrainParams>): void {
  commit(
    updateNodes(doc.value, [id], (n) => {
      if (n.kind !== 'prim' || !n.params.terrain) return n
      const cur = n.params.terrain
      const next = normTerrain({ ...cur, ...patch, kind: cur.kind })
      const land = landKindOf(next)
      if (land) return { ...n, color: LAND_COLOR[land], params: { ...n.params, terrain: next } }
      let [x, y] = n.transform.position
      const angle = (n.transform.rotation[2] * Math.PI) / 180
      // a ramp made longer or shorter keeps its high end where it was (against its platform)
      if (next.kind === 'ramp' && next.length !== (cur.length ?? 2)) {
        const shift = ((next.length! - (cur.length ?? 2)) * TILE_SIZE) / 2
        x += Math.sin(angle) * shift
        y -= Math.cos(angle) * shift
      }
      const [sx, sy] = snapTerrain(x, y, angle, next.kind === 'ramp' ? next.length! : 1)
      return { ...n, params: { ...n.params, terrain: next }, transform: { ...n.transform, position: [sx, sy, n.transform.position[2]] } }
    })
  )
}

/** A new landscape tile's name («Трава 3»). */
const landLabel = (kind: LandKind) => t(`robo.land.${kind}` as Key)
const landName = (kind: LandKind) => () => `${landLabel(kind)} ${countOf('terrain') + 1}`

/**
 * A landscape tile: on the cell under `at` (changing the tile already there), or on a free cell
 * near the middle of the field.
 */
export function addLand(kind: LandKind, at?: [number, number]): string | null {
  const [x, y] = at ?? emptyCell(doc.value.nodes)
  const r = paintLand(doc.value, x, y, kind, landName(kind), landLabel)
  if (r.doc !== doc.value) commit(r.doc, r.id ? [r.id] : [])
  return r.id
}

/** Change what a landscape tile is (grass, sand, stone, road or water); a road keeps its line. */
export function setLand(id: string, kind: LandKind): void {
  const next = changeLand(doc.value, id, kind, landLabel)
  if (next !== doc.value) commit(next)
}

/** Turn a terrain piece to an angle (degrees); it stays on the grid. */
export function turnTerrain(id: string, deg: number): void {
  const n = doc.value.nodes.find((x) => x.id === id)
  if (!n) return
  const a = Math.round((((((deg + 180) % 360) + 360) % 360) - 180) / 90) * 90
  commit(turnTerrainPieces(doc.value, setTransform(doc.value, id, { ...n.transform, rotation: [0, 0, a] }), [id]))
}

/** The first cell near the origin without a tile. */
function freeCell(): [number, number] {
  const used = new Set(
    doc.value.nodes
      .filter((n) => n.kind === 'prim' && n.prim === 'tile')
      .map((n) => `${snapCell(n.transform.position[0])},${snapCell(n.transform.position[1])}`)
  )
  for (let ring = 0; ring < 12; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
        const c: [number, number] = [cellCenter(i), cellCenter(j)]
        if (!used.has(`${c[0]},${c[1]}`)) return c
      }
    }
  }
  return [cellCenter(0), cellCenter(0)]
}

// ---------------------------------------------------------------- 3D → robotics

/** Which 3D shapes a sent object was made of: the same set sent again updates that object. */
export const sourceKey = (ids: string[]) => [...ids].sort().join(',')

/** A cell of the field (its center) with nothing standing on it, as near the origin as possible. */
function emptyCell(nodes: DocNode[], cells = 1): [number, number] {
  const key = (x: number, y: number) => `${snapCell(x)},${snapCell(y)}`
  const used = new Set(nodes.map((n) => key(n.transform.position[0], n.transform.position[1])))
  // terrain covers every cell of its footprint (a two-tile ramp's centre is on a cell edge)
  for (const t of terrainOf({ ...doc.value, nodes })) {
    const [hx, hy] = halfSize(t)
    for (let u = -hx + TILE_SIZE / 2; u < hx; u += TILE_SIZE)
      for (let v = -hy + TILE_SIZE / 2; v < hy; v += TILE_SIZE)
        used.add(key(t.x + Math.cos(t.angle) * u - Math.sin(t.angle) * v, t.y + Math.sin(t.angle) * u + Math.cos(t.angle) * v))
  }
  for (let ring = 0; ring < 20; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
        const c: [number, number] = [cellCenter(i), cellCenter(j)]
        // `cells` = 2: this cell and the one after it along Y must both be free
        if (!used.has(key(c[0], c[1])) && (cells < 2 || !used.has(key(c[0], c[1] + TILE_SIZE)))) return cells < 2 ? c : [c[0], c[1] + TILE_SIZE / 2]
      }
    }
  }
  return [cellCenter(0), cellCenter(0)]
}

/**
 * «To the simulator»: the selected shapes of the 3D model (or the whole model) become one object
 * on the robotics field, in their real size. Sending the same shapes again replaces that object's
 * shape and keeps where it stands. Then the robotics tab opens with the object selected.
 */
export async function sendToSimulator(): Promise<void> {
  const start = doc.value
  if (start.scene !== 'model' || session.value) return
  const chosen = new Set(selection.value)
  const picked = start.nodes.filter((n) => (chosen.size ? chosen.has(n.id) : true))
  if (!picked.some((n) => !n.isHole)) {
    notify(t('toSim.nothing'), 'error')
    return
  }
  const res = await guarded(() => geom.exportMesh(picked))
  if (!res) return
  if (res.indices.length === 0) {
    notify(t('toSim.nothing'), 'error')
    return
  }
  if (res.skipped) notify(t('export.skipped', { n: res.skipped }), 'error')
  // stand the model on the floor, its middle over the object's origin
  const p = res.positions
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k])
      hi[k] = Math.max(hi[k], p[i + k])
    }
  }
  const shift = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]
  const vertices = Array.from(p, (v, i) => Math.round((v - shift[i % 3]) * 1e4) / 1e4)
  const meshId = newId()
  const source = sourceKey(picked.map((n) => n.id))

  // the project may have changed while the mesh was computed: work on the current one
  const d = withScene(doc.value, 'model')
  if (d !== doc.value) return
  const field = d.parked
  const old = field.find((n) => n.kind === 'prim' && n.prim === 'mesh' && n.params.source === source) as PrimNode | undefined
  let id: string
  let parked: DocNode[]
  if (old) {
    id = old.id
    parked = field.map((n) => (n.id === old.id ? { ...old, params: { ...old.params, meshId } } : n))
  } else {
    const solid = picked.find((n) => !n.isHole)!
    const name = picked.length === 1 ? picked[0].name : t('toSim.name', { n: picked.length })
    const [x, y] = emptyCell(field)
    const node = createShape('mesh', name, [x, y, 0], { params: { meshId, source }, color: solid.color })
    id = node.id
    parked = [...field, node]
  }
  const next = pruneMeshes({ ...d, parked, meshes: { ...d.meshes, [meshId]: { vertices, triangles: Array.from(res.indices) } } })
  commit(next)
  notify(t(old ? 'toSim.updated' : 'toSim.sent', { name: old ? old.name : (parked[parked.length - 1].name) }))
  roboticsTab()
  if (doc.value.scene === 'robo') {
    selection.value = [id]
    setTimeout(() => vp?.fitView(), 400)
  }
}

/** Shapes offered on the robotics field, and how much bigger than in the 3D tab (20 mm → 6 cm). */
export const OBSTACLES: PrimType[] = ['box', 'cylinder', 'sphere', 'cone', 'pyramid', 'wedge']
export const OBSTACLE_SCALE = 3

/** A shape for the robotics field: an obstacle or a load for the robot to push. */
export function obstacleNode(type: PrimType): PrimNode {
  const n = createShape(type, shapeName(type), [0, 0, 0])
  n.transform = { ...n.transform, scale: [OBSTACLE_SCALE, OBSTACLE_SCALE, OBSTACLE_SCALE] }
  return n
}

/** A piece of scenery (not yet on the field). */
export function decorNode(kind: DecorKind): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: 'decor',
    name: `${t(`robo.decor.${kind}` as Key)} ${countOf('decor') + 1}`,
    color: DEFAULT_COLORS.decor,
    isHole: false,
    params: { decor: { kind } },
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
  }
}

/** A tree, a fir, a bush, a rock or flowers, standing on the surface under it. */
export function addDecor(kind: DecorKind, at?: [number, number]): string {
  const n = decorNode(kind)
  const [x, y] = at ?? emptyCell(doc.value.nodes)
  n.transform = { ...n.transform, position: [x, y, 0] }
  commit(standOnTerrain(addNodes(doc.value, [n]), [n.id]), [n.id])
  return n.id
}

export function addObstacle(type: PrimType, at?: [number, number]): string {
  const n = obstacleNode(type)
  const [x, y] = at ?? emptyCell(doc.value.nodes)
  n.transform = { ...n.transform, position: [x, y, 0] }
  commit(standOnTerrain(addNodes(doc.value, [n]), [n.id]), [n.id])
  return n.id
}

export function addRobot(at?: [number, number], headingDeg = 0, model = DEFAULT_ROBOT): string {
  const p = at ?? [cellCenter(0), cellCenter(0)]
  const n = robotNode(p[0], p[1], headingDeg, `${t('shape.robot')} ${countOf('robot') + 1}`)
  n.params = { robot: { model: knownRobot(model) ? model : DEFAULT_ROBOT, sensors: [] } }
  commit(standOnTerrain(addNodes(doc.value, [n]), [n.id]), [n.id])
  rememberRobot(n.id)
  return n.id
}

/** A lamp on the field: a cone of light or a bulb that shines all round. */
export function addLight(kind: LightParams['kind'], at?: [number, number]): string {
  const [x, y] = at ?? emptyCell(doc.value.nodes)
  const n = lampNode(kind, x, y, `${t(kind === 'spot' ? 'robo.spotLamp' : 'robo.pointLamp')} ${countOf('light') + 1}`)
  commit(addNodes(doc.value, [n]), [n.id])
  rememberActor(n.id)
  return n.id
}

/** A character's name: «Нерпа 2»; the cheetah and the pigeon are «Читик», «Геннадий» (then «Читик 2»…). */
function creatureName(species: Species): string {
  const same = doc.value.nodes.filter((n) => n.kind === 'prim' && n.prim === 'nerpa' && speciesOf(n.params.nerpa?.species) === species).length
  if (species === 'seal') return `${t('shape.nerpa')} ${countOf('nerpa') + 1}`
  const name = t(species === 'cheetah' ? 'robo.cheetahName' : 'robo.pigeonName')
  return same ? `${name} ${same + 1}` : name
}

/** A character with its own block program: the seal, the cheetah or the pigeon. */
export function addNerpa(at?: [number, number], species: Species = 'seal'): string {
  const [x, y] = at ?? emptyCell(doc.value.nodes)
  const n = nerpaNode(x, y, 0, creatureName(species), undefined, species)
  commit(standOnTerrain(addNodes(doc.value, [n]), [n.id]), [n.id])
  rememberActor(n.id)
  return n.id
}

/** Change a lamp's settings (kind, brightness, on at the start, cone angle and tilt). */
export function setLight(id: string, patch: Partial<LightParams>): void {
  commit(
    updateNodes(doc.value, [id], (n) => {
      if (n.kind !== 'prim' || !n.params.light) return n
      const l = { ...n.params.light, ...patch }
      if (JSON.stringify(l) === JSON.stringify(n.params.light)) return n
      return { ...n, params: { ...n.params, light: l } }
    })
  )
}

/** Height above the floor (lamps hang in the air), mm. */
export function setHeight(id: string, z: number): void {
  commit(
    updateNodes(doc.value, [id], (n) => {
      const p = n.transform.position
      if (p[2] === z) return n
      return { ...n, transform: { ...n.transform, position: [p[0], p[1], Math.max(0, z)] } }
    })
  )
}

/** Put a device (the chosen kind by default) on a pad of a robot ("snaps" onto the pad). */
export function attachSensor(robotId: string, port: number, type: SensorType = sensorKind.peek()): void {
  commit(
    updateNodes(doc.value, [robotId], (n) => {
      if (n.kind !== 'prim' || !n.params.robot) return n
      const r = n.params.robot
      if (!robotSpec(r.model).pads.some((p) => p.port === port)) return n
      const sensors: RobotSensor[] = [...r.sensors.filter((s) => s.port !== port), { port, type }]
      sensors.sort((a, b) => a.port - b.port)
      return { ...n, params: { ...n.params, robot: { ...r, sensors } } }
    }),
    [robotId]
  )
  rememberRobot(robotId)
}

export function detachSensor(robotId: string, port: number): void {
  commit(
    updateNodes(doc.value, [robotId], (n) => {
      if (n.kind !== 'prim' || !n.params.robot) return n
      const r = n.params.robot
      return { ...n, params: { ...n.params, robot: { ...r, sensors: r.sensors.filter((s) => s.port !== port) } } }
    })
  )
}

/** Save the block program of a robot, a seal or a lamp (one undo step; no-op when nothing changed). */
export function setProgram(id: string, program: unknown): void {
  const n = doc.value.nodes.find((x) => x.id === id)
  if (!n || !actorKind(n)) return
  if (JSON.stringify(actorProgram(n) ?? null) === JSON.stringify(program ?? null)) return
  commit(
    updateNodes(doc.value, [id], (x) => {
      if (x.kind !== 'prim') return x
      const p = x.params
      if (p.robot) return { ...x, params: { ...p, robot: { ...p.robot, program } } }
      if (p.nerpa) return { ...x, params: { ...p, nerpa: { ...p.nerpa, program } } }
      if (p.light) return { ...x, params: { ...p, light: { ...p.light, program } } }
      return x
    })
  )
}

/** R in robotics mode: turn tiles and robots by 90° around their own centres. */
export function rotateSelected90(dir: 1 | -1 = 1): void {
  const ids = selection.value
  if (!ids.length) return
  const before = doc.value
  let d = before
  for (const id of ids) {
    const n = d.nodes.find((x) => x.id === id)
    if (!n) continue
    const b = vp?.worldBoxes([id])[id]
    const c: Vec3 = isRoboNode(n) || !b ? [...n.transform.position] : boxCenter(b)
    d = rotateNodes(d, [id], [0, 0, 1], 90 * dir, c, d)
  }
  commit(turnTerrainPieces(before, d, ids))
}

/** Weight of a shape for the physics (grams); undefined = from its volume. */
export function setMass(ids: string[], mass: number | undefined): void {
  commit(
    updateNodes(doc.value, ids, (n) => {
      if (n.mass === mass) return n
      const { mass: _old, ...rest } = n
      void _old
      return mass === undefined ? (rest as typeof n) : { ...n, mass }
    })
  )
}

/** Replace the field with the demo: a loop track, a line-following robot and a few shapes. */
export function loadDemo(): void {
  if (!confirmDiscard()) return
  stopSim()
  leaveSketch()
  const d = demoDoc({ tile: t('shape.tile'), robot: t('shape.robot'), box: t('shape.box'), cylinder: t('shape.cylinder') })
  vp?.forgetViews()
  loadDoc(d, null, null)
  leaveCircuits()
  roboticsMode.value = true
  setTimeout(() => vp?.fitView(), 700)
}

/** Replace the field with the demo «Остров»: an island where the robot and the three heroes each have a little story. */
export function loadIsland(): void {
  if (!confirmDiscard()) return
  stopSim()
  leaveSketch()
  const d = islandDoc((k) => t(k as Key))
  vp?.forgetViews()
  loadDoc(d, null, null)
  leaveCircuits()
  roboticsMode.value = true
  setTimeout(() => vp?.fitView(), 700)
}

// ---------------------------------------------------------------- pictures and videos of the field

const shotBase = () => (fileName.value ?? t('file.defaultName')).replace(/\.(tcad|nerpa)$/i, '')
const stamp = () => {
  const d = new Date()
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** Save a PNG of the view as it is now (the beautiful view if it is on). */
export async function takePicture(): Promise<void> {
  const blob = await vp?.picture()
  if (!blob) {
    notify(t('shot.failed'), 'error')
    return
  }
  const data = await blob.arrayBuffer()
  const r = await guarded(() => window.api.saveFile({ kind: 'png', data, defaultName: `${shotBase()} ${stamp()}.png` }))
  if (r) notify(t('shot.saved', { name: r.name }))
}

/** Record up to 10 s of the view as a video (again: stop now) and save it. */
export async function recordVideo(): Promise<void> {
  if (!vp) return
  if (recording.peek()) {
    vp.stopRecording()
    return
  }
  notify(t('video.recording'))
  const blob = await vp.record(10)
  if (!blob) {
    notify(t('video.failed'), 'error')
    return
  }
  const data = await blob.arrayBuffer()
  const r = await guarded(() => window.api.saveFile({ kind: 'webm', data, defaultName: `${shotBase()} ${stamp()}.webm` }))
  if (r) notify(t('video.saved', { name: r.name }))
}

/** Follow the robot or hero `id` with the camera during runs (null: stop following). */
export function follow(id: string | null): void {
  followId.value = id
}

export const isRunning = () => simState.value !== 'idle'

export { batch, gridStep }
