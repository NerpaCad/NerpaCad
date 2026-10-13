import type { PrimNode, PrimParams, PrimType, Vec3 } from './model'
import { newId, quatFromRotation } from './model'
import { Vector3 } from 'three'
import { GEAR_DEFAULTS } from './gear'
import { READY_PARTS, clampPart, isPart, partDefaults, pieceField } from './parts'

export const SHAPES: PrimType[] = [
  'box',
  'cylinder',
  'sphere',
  'hemisphere',
  'cone',
  'pyramid',
  'wedge',
  'roundRoof',
  'polygon',
  'icosahedron',
  'torus',
  'text'
]

/** sides of a new polygon prism */
export const POLYGON_SIDES = 6

/** Neon colors in the Cyberpunk 2077 spirit. */
export const DEFAULT_COLORS: Record<PrimType, string> = {
  box: '#ff003c',
  cylinder: '#fcee0a',
  sphere: '#00f0ff',
  cone: '#b026ff',
  pyramid: '#ff8a00',
  wedge: '#2bff88',
  torus: '#ff2a9d',
  polygon: '#5a4bff',
  icosahedron: '#00c2a8',
  hemisphere: '#4dd8ff',
  roundRoof: '#ff5e3a',
  text: '#fcee0a',
  mesh: '#8a96b0',
  sketch: '#2bff88',
  tile: '#ffffff',
  terrain: '#b8c2cc',
  decor: '#4f9a3a',
  robot: '#e8ecf4',
  gear: '#00c2a8',
  light: '#ffd84a',
  nerpa: '#8f9aa6',
  bolt: '#8a96b0',
  nut: '#b0b8c8',
  jar: '#00c2a8',
  rack: '#00c2a8',
  wheel: '#fcee0a',
  pulley: '#ff8a00',
  washer: '#b0b8c8',
  spring: '#ff2a9d',
  boxLid: '#5a4bff',
  hinge: '#2bff88',
  knob: '#ff003c',
  tag: '#fcee0a'
}

/** The shapes set up with numbers (the «Parametric» tab). */
export const PARAM_SHAPES: PrimType[] = ['gear', ...READY_PARTS]

export const PALETTE = [
  '#ff003c',
  '#ff2a9d',
  '#b026ff',
  '#5a4bff',
  '#00f0ff',
  '#00c2a8',
  '#2bff88',
  '#fcee0a',
  '#ff8a00',
  '#9b6b43',
  '#ffffff',
  '#8a96b0',
  '#3a4258',
  '#15171f'
]

export function defaultParams(type: PrimType, text: string): PrimParams {
  switch (type) {
    case 'cylinder':
    case 'cone':
    case 'sphere':
    case 'hemisphere':
    case 'roundRoof':
      return { segments: 32 }
    case 'polygon':
      return { segments: POLYGON_SIDES }
    case 'torus':
      return { segments: 48, tube: 3 }
    case 'text':
      return { text }
    case 'gear':
      return { gear: { ...GEAR_DEFAULTS } }
    default:
      return isPart(type) ? { part: partDefaults(type) } : {}
  }
}

export function createShape(
  type: PrimType,
  name: string,
  position: Vec3,
  opts: { text?: string; params?: PrimParams; color?: string } = {}
): PrimNode {
  return {
    id: newId(),
    kind: 'prim',
    prim: type,
    name,
    color: opts.color ?? DEFAULT_COLORS[type],
    isHole: false,
    params: opts.params ?? defaultParams(type, opts.text ?? 'Text'),
    transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] }
  }
}

/**
 * The other piece of a two-piece part (the lid of a jar or of a box), placed beside the first
 * one on the same plane, or nothing.
 */
export function companions(n: PrimNode, name: (piece: string) => string): PrimNode[] {
  if (!isPart(n.prim)) return []
  const pf = pieceField(n.prim)
  if (!pf) return []
  const v = clampPart(n.prim, n.params.part)
  const width = n.prim === 'jar' ? (v.diameter as number) : (v.width as number)
  const p = new Vector3(width + 10, 0, 0).applyQuaternion(quatFromRotation(n.transform.rotation))
  const pos: Vec3 = [n.transform.position[0] + p.x, n.transform.position[1] + p.y, n.transform.position[2] + p.z]
  const lid: PrimNode = {
    ...n,
    id: newId(),
    name: name(pf.second),
    params: { part: clampPart(n.prim, { ...v, [pf.key]: pf.second }) },
    transform: { ...n.transform, position: pos }
  }
  return [lid]
}
