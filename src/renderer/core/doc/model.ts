import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type { Sketch } from '../sketch/types'
import type { Circuit } from '../circuit/model'
import type { GearParams } from './gear'
import type { PartType, PartValues } from './parts'
import type { MirrorKind, Symmetry } from './symmetry'
import type { ViewSettings } from '../robotics/look'

export type Vec3 = [number, number, number]

/** Position in mm, rotation in degrees (Euler XYZ), scale as factors of the base shape. */
export interface Transform {
  position: Vec3
  rotation: Vec3
  scale: Vec3
}

export type PrimType =
  | 'box'
  | 'cylinder'
  | 'sphere'
  | 'cone'
  | 'pyramid'
  | 'torus'
  /** a prism on a regular polygon (`segments` = number of sides) */
  | 'polygon'
  | 'icosahedron'
  /** half a sphere, flat side down */
  | 'hemisphere'
  /** half a cylinder lying down, round side up */
  | 'roundRoof'
  | 'wedge'
  | 'text'
  | 'mesh'
  /** an extruded sketch: the node's transform is the sketch plane */
  | 'sketch'
  /** robotics: a 300 × 300 mm floor tile with a piece of black line */
  | 'tile'
  /** robotics: a robot (its node transform is its pose on the floor) */
  | 'robot'
  /** a parametric spur gear (`params.gear`), real size in mm */
  | 'gear'
  /** robotics: a lamp (`params.light`): a cone of light or a bulb shining all round */
  | 'light'
  /** robotics: the seal character, programmed with blocks like a Scratch sprite (`params.nerpa`) */
  | 'nerpa'
  /** robotics: a platform, a ramp or a bridge on the tile grid (`params.terrain`) */
  | 'terrain'
  /** robotics: scenery for the field — a tree, a fir, a bush, a rock, flowers (`params.decor`) */
  | 'decor'
  /** parametric parts for printing (`params.part`, see doc/parts.ts), real size in mm */
  | PartType

/** Tile pictures: a straight line, a quarter turn, a crossing. */
export type TileKind = 'straight' | 'turn' | 'cross'

/** Scenery of the robotics field (see `robotics/decor.ts`). */
export type DecorKind = 'tree' | 'pine' | 'bush' | 'rock' | 'flowers'
export interface DecorParams {
  kind: DecorKind
}

/** Terrain pieces of the robotics field (see `robotics/terrain.ts`). */
export type TerrainKind = 'platform' | 'ramp' | 'bridge' | 'ground' | 'water'
/** what the top of a landscape tile is */
export type Surface = 'grass' | 'sand' | 'stone' | 'road'
export interface TerrainParams {
  kind: TerrainKind
  /** landscape tiles ('ground'): the top; a road may carry a black line */
  surface?: Surface
  line?: TileKind | 'none'
  /** top of a platform or bridge, high end of a ramp, mm */
  height: number
  /** ramps: 1 or 2 tiles long */
  length?: number
}

/**
 * What can sit on a robot's mounting pad: sensors (line, ultrasonic distance, touch, light) and
 * the flashlight, an output device that is plugged in the same way.
 */
export type SensorType = 'line' | 'ultrasonic' | 'touch' | 'light' | 'flashlight'
export const SENSOR_TYPES: SensorType[] = ['line', 'ultrasonic', 'touch', 'light', 'flashlight']

/** A device on one of the robot's mounting pads (ports 1…5). */
export interface RobotSensor {
  port: number
  type: SensorType
}

/** A lamp on the robotics field. Its node position is the bulb; the Z rotation aims a cone lamp. */
export interface LightParams {
  /** a cone of light (a spotlight) or a bulb that shines all round */
  kind: 'spot' | 'point'
  /** brightness at the start, 0…100 % */
  brightness: number
  /** lit when the run starts (and while nothing runs) */
  on: boolean
  /** cone lamps: full opening angle (degrees) and how far the beam points down from level */
  angle: number
  tilt: number
  /** the block program */
  program?: unknown
}

/** The seal: its colour is the node colour, its look and moves come from the program. */
/** Who a character of the field is: the seal Нерпа, the cheetah Читик, the pigeon Геннадий. */
export type Species = 'seal' | 'cheetah' | 'pigeon'
export const SPECIES: Species[] = ['seal', 'cheetah', 'pigeon']

/** A character of the field ('nerpa' prims — the seal was the first of them). */
export interface NerpaParams {
  program?: unknown
  /** missing: the seal (files from before the other characters) */
  species?: Species
  /** a hero from a mod (it moves like `species`); kept even when that mod is not installed */
  model?: string
}

export interface RobotParams {
  /** which robot model: 'nerpabot' (built in) or one from a mod; kept even when that mod is not installed */
  model: string
  sensors: RobotSensor[]
  /** the block program as Blockly saves it (JSON) */
  program?: unknown
}

export type ExtrudeDir = 'up' | 'down' | 'both'

export interface PrimParams {
  segments?: number
  tube?: number
  text?: string
  meshId?: string
  /** 'sketch' prims: the drawing (solved coordinates), extrusion depth (mm) and direction */
  sketch?: Sketch
  depth?: number
  extrude?: ExtrudeDir
  /** how the sketch becomes a solid (default 'extrude') */
  op?: SketchOp
  /** revolve: the axis ('AX', 'AY' or a line of the sketch) and the angle in degrees (default 360) */
  axis?: string
  angle?: number
  /** 'tile' prims */
  tile?: TileKind
  /** 'robot' prims */
  robot?: RobotParams
  /** 'gear' prims */
  gear?: GearParams
  /** parametric parts (bolt, nut, jar…): their field values */
  part?: PartValues
  /** 'light' prims */
  light?: LightParams
  /** 'nerpa' prims */
  nerpa?: NerpaParams
  /** 'terrain' prims */
  terrain?: TerrainParams
  /** 'decor' prims */
  decor?: DecorParams
  /** 'mesh' prims sent from the 3D scene to the robotics field: which 3D shapes they were made of */
  source?: string
  /** 'mesh' prims that are a piece from a mod: its id (shown with the mod's model while it is installed) */
  prop?: string
}

export type SketchOp = 'extrude' | 'revolve'

/** How a solid looks on screen: plain, glowing, or see-through (exports ignore it). */
export type MaterialKind = 'normal' | 'glow' | 'glass'
export const MATERIALS: MaterialKind[] = ['normal', 'glow', 'glass']

interface BaseNode {
  id: string
  name: string
  transform: Transform
  color: string
  isHole: boolean
  /** absent means 'normal' */
  material?: 'glow' | 'glass'
  /** symmetry mode: this node is the mirror twin of another (see `symmetry.ts`) */
  mirrorOf?: { id: string; m: MirrorKind }
  /** symmetry mode: this shape lost its twin (it went into a group) and gets no new one */
  noMirror?: true
  /** weight in grams for the physics in robotics mode (default: from the volume, as PLA) */
  mass?: number
  /** robotics: a static shape — it does not move, robots and heroes go over it like over terrain */
  fixed?: true
}

export interface PrimNode extends BaseNode {
  kind: 'prim'
  prim: PrimType
  params: PrimParams
}

export interface GroupNode extends BaseNode {
  kind: 'group'
  children: DocNode[]
}

export type DocNode = PrimNode | GroupNode

/** Imported triangle mesh (welded), stored once and referenced by `mesh` prims. */
export interface MeshData {
  vertices: number[]
  triangles: number[]
}

/** The project has two scenes: the 3D model (mm) and the robotics field (shown in cm). */
export type SceneId = 'model' | 'robo'

export interface Doc {
  /** 2: sketches, 3: robotics, 4: circuits, 5: the 3D model and the robotics field are separate scenes */
  version: 5
  /** the nodes of the scene on screen; every edit works on these */
  nodes: DocNode[]
  /** which scene `nodes` belongs to */
  scene: SceneId
  /** the other scene's nodes, set aside while it is not on screen */
  parked: DocNode[]
  /** imported and baked meshes, shared by both scenes */
  meshes: Record<string, MeshData>
  /** the circuits tab: an Arduino, resistors, LEDs and wires */
  circuit?: Circuit
  /** symmetry mode of the 3D scene */
  symmetry?: Symmetry
  /** the beautiful view of the robotics field (missing: off, default settings) */
  view?: ViewSettings
}

export interface Box {
  min: Vec3
  max: Vec3
}

export const emptyDoc = (): Doc => ({ version: 5, scene: 'model', nodes: [], parked: [], meshes: {} })

/** The same project with `scene` on screen (its nodes in `nodes`). */
export function withScene(d: Doc, scene: SceneId): Doc {
  return d.scene === scene ? d : { ...d, scene, nodes: d.parked, parked: d.nodes }
}

/** The nodes of one scene, whether it is on screen or not. */
export const sceneNodes = (d: Doc, scene: SceneId): DocNode[] => (d.scene === scene ? d.nodes : d.parked)

/** The same project content, maybe with the other scene on screen (switching scenes is not an edit). */
export function sameContent(a: Doc, b: Doc): boolean {
  if (a === b) return true
  return (
    a.meshes === b.meshes &&
    a.circuit === b.circuit &&
    a.symmetry === b.symmetry &&
    a.view === b.view &&
    sceneNodes(a, 'model') === sceneNodes(b, 'model') &&
    sceneNodes(a, 'robo') === sceneNodes(b, 'robo')
  )
}

/** Tiles, robots, lamps and seals: objects of the robotics field that are not modelling shapes. */
export const ROBO_PRIMS: PrimType[] = ['tile', 'robot', 'light', 'nerpa', 'terrain', 'decor']
export const isRoboNode = (n: DocNode): boolean => n.kind === 'prim' && ROBO_PRIMS.includes(n.prim)

/** Objects with a block program of their own: robots, seals and lamps. */
export type ActorKind = 'robot' | 'nerpa' | 'light'
export function actorKind(n: DocNode): ActorKind | null {
  if (n.kind !== 'prim') return null
  if (n.prim === 'robot' && n.params.robot) return 'robot'
  if (n.prim === 'nerpa' && n.params.nerpa) return 'nerpa'
  if (n.prim === 'light' && n.params.light) return 'light'
  return null
}
export function actorProgram(n: DocNode): unknown {
  if (n.kind !== 'prim') return undefined
  return n.params.robot?.program ?? n.params.nerpa?.program ?? n.params.light?.program
}

export const identityTransform = (): Transform => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1]
})

let idCounter = 0
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6
  return Date.now().toString(36) + '-' + idCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

const DEG = Math.PI / 180

export function transformMatrix(t: Transform, out = new Matrix4()): Matrix4 {
  const q = new Quaternion().setFromEuler(
    new Euler(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG, 'XYZ')
  )
  return out.compose(new Vector3(...t.position), q, new Vector3(...t.scale))
}

export function quatFromRotation(rot: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'))
}

export function rotationFromQuat(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, 'XYZ')
  return [cleanNum(e.x / DEG), cleanNum(e.y / DEG), cleanNum(e.z / DEG)]
}

/** Round away float noise (e.g. 89.99999999 -> 90). */
export function cleanNum(v: number, digits = 6): number {
  const f = 10 ** digits
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

export function cleanVec(v: Vec3, digits = 6): Vec3 {
  return [cleanNum(v[0], digits), cleanNum(v[1], digits), cleanNum(v[2], digits)]
}

/** Decompose a matrix into our Transform representation. Exact for T*R*S matrices without shear. */
export function matrixToTransform(m: Matrix4): Transform {
  const p = new Vector3()
  const q = new Quaternion()
  const s = new Vector3()
  m.decompose(p, q, s)
  return {
    position: cleanVec([p.x, p.y, p.z]),
    rotation: rotationFromQuat(q),
    scale: cleanVec([s.x, s.y, s.z])
  }
}

export function findNode(nodes: DocNode[], id: string): DocNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.kind === 'group') {
      const f = findNode(n.children, id)
      if (f) return f
    }
  }
  return undefined
}

export function topLevel(doc: Doc, ids: string[]): DocNode[] {
  const set = new Set(ids)
  return doc.nodes.filter((n) => set.has(n.id))
}

/** Transform a local box by a matrix and return the world-aligned box of its 8 corners. */
export function transformBox(b: Box, m: Matrix4): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  const v = new Vector3()
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2])
    v.applyMatrix4(m)
    for (let k = 0; k < 3; k++) {
      const c = v.getComponent(k)
      if (c < min[k]) min[k] = c
      if (c > max[k]) max[k] = c
    }
  }
  return { min, max }
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const b of boxes) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.min[k])
      max[k] = Math.max(max[k], b.max[k])
    }
  }
  return { min, max }
}

export const boxCenter = (b: Box): Vec3 => [
  (b.min[0] + b.max[0]) / 2,
  (b.min[1] + b.max[1]) / 2,
  (b.min[2] + b.max[2]) / 2
]

export const boxSize = (b: Box): Vec3 => [
  b.max[0] - b.min[0],
  b.max[1] - b.min[1],
  b.max[2] - b.min[2]
]
