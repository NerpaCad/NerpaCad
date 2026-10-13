/** File formats: .nerpa project JSON (older .tcad files open too), binary STL export/import, OBJ export. */
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { type Doc, type DocNode, isRoboNode, SENSOR_TYPES, SPECIES, type MeshData, sceneNodes, type TileKind } from '../doc/model'
import { ROBOT_ID, knownRobot, robotSpec } from '../robotics/robot'
import { TILE_KINDS } from '../robotics/tiles'
import { TERRAIN_KINDS, normTerrain } from '../robotics/terrain'
import { DECOR_KINDS } from '../robotics/decor'
import { normView } from '../robotics/look'
import { validateCircuit } from '../circuit/validate'
import { validProgram } from './program'
import { validateSketch } from '../sketch/validate'
import { clampGear } from '../doc/gear'
import { PART_TYPES, clampPart, isPart } from '../doc/parts'

export const TCAD_FORMAT = 'nerpacad-project'
/** the format id written by Cad System, the program's old name; such files still open */
export const LEGACY_FORMAT = 'cad-system-project'

/**
 * 1 = first release, 2 = sketches (extruded 'sketch' shapes), 3 = robotics (tiles, robots,
 * weights), 4 = circuits, 5 = separate scenes: `nodes` is the 3D model, `robo` the robotics field.
 * Older files load too: their tiles and robots were on one field with the shapes, see `parseDoc`.
 */
/** 6: landscape tiles, water and scenery on the robotics field (laid out like 5) */
export const TCAD_VERSION = 6

/** The document as it is written to a file: the scenes by name, whichever was on screen. */
export interface FileDoc {
  version?: number
  /** the 3D model */
  nodes: DocNode[]
  /** the robotics field (version 5) */
  robo?: DocNode[]
  meshes?: Record<string, MeshData>
  circuit?: unknown
  /** symmetry mode of the 3D scene */
  symmetry?: { x?: boolean; y?: boolean }
  /** the beautiful view of the robotics field (version 6) */
  view?: unknown
}

export interface TcadFile {
  format: typeof TCAD_FORMAT | typeof LEGACY_FORMAT
  version: 1 | 2 | 3 | 4 | 5 | 6
  app: string
  doc: FileDoc
}

export function serializeDoc(doc: Doc): string {
  const fd: FileDoc = {
    version: TCAD_VERSION,
    nodes: sceneNodes(doc, 'model'),
    robo: sceneNodes(doc, 'robo'),
    meshes: doc.meshes,
    ...(doc.circuit ? { circuit: doc.circuit } : {}),
    ...(doc.symmetry && (doc.symmetry.x || doc.symmetry.y) ? { symmetry: doc.symmetry } : {}),
    ...(doc.view ? { view: doc.view } : {})
  }
  const f: TcadFile = { format: TCAD_FORMAT, version: TCAD_VERSION, app: 'NerpaCad', doc: fd }
  return JSON.stringify(f)
}

export class FileFormatError extends Error {}

export function parseDoc(text: string): Doc {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new FileFormatError('not json')
  }
  const f = raw as Partial<TcadFile>
  if (!f || (f.format !== TCAD_FORMAT && f.format !== LEGACY_FORMAT) || !f.doc || !Array.isArray(f.doc.nodes)) {
    throw new FileFormatError('not a project')
  }
  if (![1, 2, 3, 4, 5, 6].includes(f.version as number)) throw new FileFormatError('unsupported version')
  if ((f.version ?? 0) >= 5 && !Array.isArray(f.doc.robo)) throw new FileFormatError('no robotics scene')
  const doc = f.doc
  const meshes = doc.meshes ?? {}
  if (typeof meshes !== 'object' || Array.isArray(meshes)) throw new FileFormatError('bad meshes')
  for (const m of Object.values(meshes)) {
    if (!isNumArray(m?.vertices) || !isNumArray(m?.triangles) || m.triangles.length % 3 !== 0) {
      throw new FileFormatError('bad mesh')
    }
  }
  const ids = new Set<string>()
  const check = (n: DocNode, depth: number) => {
    const bad = (why: string) => {
      throw new FileFormatError(`bad node: ${why}`)
    }
    if (!n || typeof n !== 'object') bad('not an object')
    if (typeof n.id !== 'string' || !n.id || ids.has(n.id)) bad('id')
    ids.add(n.id)
    if (typeof n.name !== 'string') bad('name')
    if (typeof n.color !== 'string') bad('color')
    if (typeof n.isHole !== 'boolean') bad('isHole')
    const t = n.transform
    if (!t || !isVec3(t.position) || !isVec3(t.rotation) || !isVec3(t.scale)) bad('transform')
    if (depth > 64) bad('too deep')
    if (n.mass !== undefined && !(isNum(n.mass) && n.mass > 0 && n.mass < 1e7)) bad('mass')
    if (n.material !== undefined && n.material !== 'glow' && n.material !== 'glass') bad('material')
    if (n.mirrorOf !== undefined) {
      const mo = n.mirrorOf
      if (!mo || typeof mo.id !== 'string' || !['x', 'y', 'xy'].includes(mo.m) || depth > 0) bad('mirrorOf')
      n.mirrorOf = { id: mo.id, m: mo.m }
    }
    if (n.noMirror !== undefined && n.noMirror !== true) bad('noMirror')
    if (n.kind === 'group') {
      if (!Array.isArray(n.children) || n.children.length === 0) bad('children')
      n.children.forEach((c) => check(c, depth + 1))
    } else if (n.kind === 'prim') {
      if (!PRIMS.includes(n.prim)) bad('prim')
      if (!n.params || typeof n.params !== 'object') bad('params')
      if (n.prim === 'mesh' && !(n.params.meshId && n.params.meshId in meshes)) bad('meshId')
      if (n.params.source !== undefined && (typeof n.params.source !== 'string' || n.params.source.length > 4096)) bad('source')
      if (n.prim === 'sketch') {
        const s = validateSketch(n.params.sketch)
        if (!s) bad('sketch')
        const d = n.params.depth
        if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) bad('depth')
        const dir = n.params.extrude ?? 'up'
        if (dir !== 'up' && dir !== 'down' && dir !== 'both') bad('extrude')
        const op = n.params.op ?? 'extrude'
        if (op !== 'extrude' && op !== 'revolve') bad('op')
        const axis = n.params.axis ?? 'AY'
        if (typeof axis !== 'string' || axis.length > 64) bad('axis')
        const angle = n.params.angle ?? 360
        if (typeof angle !== 'number' || !Number.isFinite(angle) || angle <= 0 || angle > 360) bad('angle')
        n.params =
          op === 'revolve'
            ? { sketch: s!, depth: d, extrude: dir, op, axis, angle }
            : { sketch: s!, depth: d, extrude: dir }
      }
      if (n.prim === 'gear') {
        const g = n.params.gear
        if (!g || typeof g !== 'object') bad('gear')
        for (const k of ['teeth', 'module', 'thickness', 'bore'] as const) if (!isNum(g![k])) bad('gear')
        n.params = { gear: clampGear(g!) }
      }
      if (isPart(n.prim)) {
        // a part's values: missing or wrong ones fall back to their defaults
        const raw = n.params.part
        if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) bad('part')
        n.params = { part: clampPart(n.prim, raw) }
      }
      if (n.prim === 'tile') {
        if (depth > 0) bad('tile in a group')
        if (!TILE_KINDS.includes(n.params.tile as TileKind)) bad('tile')
        n.params = { tile: n.params.tile }
      }
      if (n.prim === 'robot') {
        if (depth > 0) bad('robot in a group')
        const r = n.params.robot
        // a robot of a mod that is not installed here keeps its model (it is shown as NerpaBot)
        if (!r || typeof r !== 'object' || typeof r.model !== 'string' || !ROBOT_ID.test(r.model)) bad('robot')
        if (!Array.isArray(r!.sensors) || r!.sensors.length > 16) bad('sensors')
        const ports = new Set<number>()
        for (const sn of r!.sensors) {
          if (!sn || !SENSOR_TYPES.includes(sn.type) || !Number.isInteger(sn.port) || sn.port < 1 || sn.port > 32 || ports.has(sn.port)) bad('sensor')
          // on a known robot only its own pads
          if (knownRobot(r!.model) && !robotSpec(r!.model).pads.some((p) => p.port === sn.port)) bad('sensor')
          ports.add(sn.port)
        }
        const program = r!.program
        if (program !== undefined && !validProgram(program)) bad('program')
        n.params = {
          robot: {
            model: r!.model,
            sensors: r!.sensors.map((sn) => ({ port: sn.port, type: sn.type })),
            ...(program !== undefined ? { program } : {})
          }
        }
      }
      if (n.prim === 'light') {
        if (depth > 0) bad('lamp in a group')
        const l = n.params.light
        if (!l || typeof l !== 'object' || (l.kind !== 'spot' && l.kind !== 'point') || typeof l.on !== 'boolean') bad('lamp')
        for (const k of ['brightness', 'angle', 'tilt'] as const) if (!isNum(l![k])) bad('lamp')
        const program = l!.program
        if (program !== undefined && !validProgram(program)) bad('program')
        n.params = {
          light: {
            kind: l!.kind,
            on: l!.on,
            brightness: Math.max(0, Math.min(100, l!.brightness)),
            angle: Math.max(10, Math.min(170, l!.angle)),
            tilt: Math.max(0, Math.min(90, l!.tilt)),
            ...(program !== undefined ? { program } : {})
          }
        }
      }
      if (n.prim === 'terrain') {
        if (depth > 0) bad('terrain in a group')
        const tp = n.params.terrain
        if (!tp || typeof tp !== 'object' || !TERRAIN_KINDS.includes(tp.kind) || !isNum(tp.height)) bad('terrain')
        if (tp!.length !== undefined && !isNum(tp!.length)) bad('terrain')
        n.params = { terrain: normTerrain(tp!) }
      }
      if (n.prim === 'decor') {
        if (depth > 0) bad('decor in a group')
        const dp = n.params.decor
        if (!dp || typeof dp !== 'object' || !DECOR_KINDS.includes(dp.kind)) bad('decor')
        n.params = { decor: { kind: dp!.kind } }
      }
      if (n.prim === 'nerpa') {
        if (depth > 0) bad('seal in a group')
        const np = n.params.nerpa
        if (!np || typeof np !== 'object') bad('seal')
        const program = np!.program
        if (program !== undefined && !validProgram(program)) bad('program')
        // the cheetah and the pigeon came with format 6; without a species it is the seal
        const species = np!.species
        if (species !== undefined && !SPECIES.includes(species)) bad('species')
        n.params = { nerpa: { ...(program !== undefined ? { program } : {}), ...(species ? { species } : {}) } }
      }
    } else bad('kind')
  }
  doc.nodes.forEach((n) => check(n, 0))
  doc.robo?.forEach((n) => check(n, 0))
  let model: DocNode[]
  let robo: DocNode[]
  if ((f.version ?? 0) >= 5) {
    model = doc.nodes
    robo = doc.robo!
    if (model.some(isRoboNode)) throw new FileFormatError('bad node: a tile or robot in the 3D scene')
  } else if (doc.nodes.some(isRoboNode)) {
    // before version 5 there was one scene: a file with tiles or robots was a robotics field
    model = []
    robo = doc.nodes
  } else {
    model = doc.nodes
    robo = []
  }
  const circuit = doc.circuit === undefined ? undefined : validateCircuit(doc.circuit)
  if (doc.circuit !== undefined && !circuit) throw new FileFormatError('bad circuit')
  const sy = doc.symmetry
  if (sy !== undefined && (typeof sy !== 'object' || !sy || (sy.x !== undefined && typeof sy.x !== 'boolean') || (sy.y !== undefined && typeof sy.y !== 'boolean'))) {
    throw new FileFormatError('bad symmetry')
  }
  const symmetry = sy && (sy.x || sy.y) ? { ...(sy.x ? { x: true } : {}), ...(sy.y ? { y: true } : {}) } : undefined
  return {
    version: 5,
    scene: 'model',
    nodes: model,
    parked: robo,
    meshes,
    ...(circuit ? { circuit } : {}),
    ...(symmetry ? { symmetry } : {}),
    ...(doc.view !== undefined ? { view: normView(doc.view) } : {})
  }
}

const PRIMS = ['box', 'cylinder', 'sphere', 'cone', 'pyramid', 'torus', 'wedge', 'polygon', 'icosahedron', 'hemisphere', 'roundRoof', 'text', 'mesh', 'sketch', 'tile', 'robot', 'gear', 'light', 'nerpa', 'terrain', 'decor', ...PART_TYPES]


const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isVec3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(isNum)
const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum)

/** Binary STL (little endian). Normals are computed per facet. */
export function toStlBinary(positions: Float32Array, indices: Uint32Array): ArrayBuffer {
  const triCount = indices.length / 3
  const buf = new ArrayBuffer(84 + triCount * 50)
  const dv = new DataView(buf)
  const header = 'NerpaCad STL export'
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0)
  dv.setUint32(80, triCount, true)
  let o = 84
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3
    const b = indices[t * 3 + 1] * 3
    const c = indices[t * 3 + 2] * 3
    const ux = positions[b] - positions[a]
    const uy = positions[b + 1] - positions[a + 1]
    const uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a]
    const vy = positions[c + 1] - positions[a + 1]
    const vz = positions[c + 2] - positions[a + 2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len
    ny /= len
    nz /= len
    dv.setFloat32(o, nx, true)
    dv.setFloat32(o + 4, ny, true)
    dv.setFloat32(o + 8, nz, true)
    o += 12
    for (const v of [a, b, c]) {
      dv.setFloat32(o, positions[v], true)
      dv.setFloat32(o + 4, positions[v + 1], true)
      dv.setFloat32(o + 8, positions[v + 2], true)
      o += 12
    }
    dv.setUint16(o, 0, true)
    o += 2
  }
  return buf
}

export function toObj(positions: Float32Array, indices: Uint32Array): string {
  const lines: string[] = ['# NerpaCad OBJ export', 'o model']
  const r = (v: number) => (Math.round(v * 1e5) / 1e5).toString()
  for (let i = 0; i < positions.length; i += 3) {
    lines.push(`v ${r(positions[i])} ${r(positions[i + 1])} ${r(positions[i + 2])}`)
  }
  for (let i = 0; i < indices.length; i += 3) {
    lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`)
  }
  return lines.join('\n') + '\n'
}

/**
 * Parse STL (binary or ASCII), weld duplicate vertices and move it so its box is centered
 * in X/Y and sits on z = 0 — the same convention as built-in shapes.
 */
export function importStl(data: ArrayBuffer): MeshData {
  const geo = new STLLoader().parse(data) as BufferGeometry
  const pos = geo.getAttribute('position')
  if (!pos || pos.count < 3) throw new FileFormatError('empty stl')
  const clean = new BufferGeometry()
  clean.setAttribute('position', new Float32BufferAttribute(Array.from(pos.array as Float32Array), 3))
  const welded = mergeVertices(clean, 1e-4)
  welded.computeBoundingBox()
  const b = welded.boundingBox!
  const cx = (b.min.x + b.max.x) / 2
  const cy = (b.min.y + b.max.y) / 2
  const mz = b.min.z
  const p = welded.getAttribute('position').array as Float32Array
  const vertices: number[] = new Array(p.length)
  for (let i = 0; i < p.length; i += 3) {
    vertices[i] = round5(p[i] - cx)
    vertices[i + 1] = round5(p[i + 1] - cy)
    vertices[i + 2] = round5(p[i + 2] - mz)
  }
  const idx = welded.getIndex()
  const triangles = idx ? Array.from(idx.array as Uint32Array) : [...Array(p.length / 3).keys()]
  // drop degenerate triangles left after welding
  const tri: number[] = []
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, bb, c] = [triangles[i], triangles[i + 1], triangles[i + 2]]
    if (a !== bb && bb !== c && a !== c) tri.push(a, bb, c)
  }
  return { vertices, triangles: tri }
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5
