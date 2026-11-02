/**
 * Geometry engine: turns document nodes into triangle meshes using manifold-3d.
 * Runs in a Web Worker in the app and directly in Node for unit tests.
 *
 * Conventions:
 *  - every primitive's base size is 20 mm; the node's `scale` sets the real size;
 *  - primitive geometry is normalized so the local origin is the bottom-center of its box;
 *  - a group's mesh = union(solid children) − union(hole children), in the group's frame.
 */
import type { CrossSection as CS, Manifold, ManifoldToplevel } from 'manifold-3d'
import { boreOutline, clampGear, gearOutline } from '../doc/gear'
import { clampPart, isPart } from '../doc/parts'
import { PartBuilder } from './parts'
import type { Font } from 'opentype.js'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Box, DocNode, MeshData, PrimNode } from '../doc/model'
import { transformMatrix } from '../doc/model'
import { textContours } from './text'
import { buildProfile } from '../sketch/profile'
import { revolveSetup } from '../sketch/revolve'
import { robotSpec } from '../robotics/robot'
import { profileOf } from '../robotics/creatures'

/** radius of a bulb lamp on the robotics field, mm */
export const LAMP_RADIUS = 22
import { TILE_SIZE, TILE_THICKNESS } from '../robotics/tiles'
import { BRIDGE_DECK, halfSize, placedTerrain } from '../robotics/terrain'
import { decorSpec } from '../robotics/decor'

export const BASE = 20
export const TEXT_DEPTH = 10

export interface MeshResult {
  positions: Float32Array
  indices: Uint32Array
  box: Box
  volume: number
  /** 'notManifold' for an imported mesh that cannot take part in booleans */
  error?: string
}

type Mat4 = Parameters<Manifold['transform']>[0]

// ---------- stable keys ----------

function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

function signature(n: DocNode): unknown {
  if (n.kind === 'prim') {
    const p = n.params
    if (n.prim === 'sketch') {
      // geometry only: constraints do not change the shape once solved
      const s = p.sketch
      return [
        's',
        s ? [s.points, s.curves] : null,
        p.depth ?? null,
        p.extrude ?? null,
        p.op ?? 'extrude',
        p.axis ?? null,
        p.angle ?? null
      ]
    }
    // robotics objects: the shape does not depend on the sensors or the program
    if (n.prim === 'tile') return ['t', p.tile ?? null]
    if (n.prim === 'robot') return ['r', p.robot?.model ?? null]
    if (n.prim === 'nerpa') return ['n', p.nerpa?.species ?? 'seal']
    if (n.prim === 'terrain') return ['ter', p.terrain?.kind ?? null, p.terrain?.height ?? null, p.terrain?.length ?? null]
    if (n.prim === 'decor') return ['d', n.params.decor?.kind ?? null]
    if (n.prim === 'light') return ['l', p.light?.kind ?? null, p.light?.kind === 'spot' ? (p.light.tilt ?? 0) : null]
    if (n.prim === 'gear') return ['g', p.gear ?? null]
    if (isPart(n.prim)) return ['part', n.prim, clampPart(n.prim, p.part)]
    return ['p', n.prim, p.segments ?? null, p.tube ?? null, p.text ?? null, p.meshId ?? null]
  }
  return ['g', n.children.map((c) => [signature(c), c.transform, c.isHole ? 1 : 0])]
}

/** Key that changes only when the node's local geometry changes (not its own transform/color). */
export function geomKey(n: DocNode): string {
  const s = JSON.stringify(signature(n))
  return cyrb53(s, 1).toString(36) + cyrb53(s, 7).toString(36) + s.length.toString(36)
}

export const clampSegments = (s: number | undefined, def: number) =>
  Math.max(3, Math.min(128, Math.round(s ?? def)))

// ---------- engine ----------

export class GeomEngine {
  meshes: Record<string, MeshData> = {}
  private cache = new Map<string, Manifold>()
  private errors = new Map<string, string>()
  private readonly maxCache = 300
  private parts: PartBuilder | null = null

  constructor(
    private readonly w: ManifoldToplevel,
    private readonly font: Font | null
  ) {}

  /** Cached manifold for a node in its own frame. Owned by the cache: do not delete. */
  manifoldOf(n: DocNode): Manifold {
    const key = geomKey(n)
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const m = n.kind === 'prim' ? this.buildPrim(n, key) : this.buildGroup(n.children)
    this.cache.set(key, m)
    return m
  }

  /** Display mesh for a node in its own frame. */
  evaluate(n: DocNode): MeshResult {
    this.trim()
    const key = geomKey(n)
    const m = this.manifoldOf(n)
    const err = this.errors.get(key)
    if (err && n.kind === 'prim' && n.params.meshId) {
      return rawMeshResult(this.meshes[n.params.meshId], err)
    }
    return toResult(m)
  }

  /**
   * World-space mesh of all solid nodes, unioned — what gets 3D-printed.
   * Imported meshes that are not closed solids can't be unioned; their triangles are appended
   * as they are. `skipped` counts such meshes hidden inside groups (they can't be exported).
   */
  exportMesh(nodes: DocNode[]): MeshResult & { skipped: number } {
    this.trim()
    const parts: Manifold[] = []
    const raw: { md: MeshData; m: Matrix4 }[] = []
    let skipped = 0
    const countBroken = (n: DocNode): number =>
      n.kind === 'group'
        ? n.children.reduce((a, c) => a + countBroken(c), 0)
        : this.errors.has(geomKey(n))
          ? 1
          : 0
    try {
      for (const n of nodes) {
        if (n.isHole) continue
        const man = this.manifoldOf(n)
        const key = geomKey(n)
        if (n.kind === 'prim' && this.errors.has(key) && n.params.meshId && this.meshes[n.params.meshId]) {
          raw.push({ md: this.meshes[n.params.meshId], m: transformMatrix(n.transform) })
          continue
        }
        if (n.kind === 'group') skipped += countBroken(n)
        parts.push(man.transform(toMat4(transformMatrix(n.transform))))
      }
      let res: MeshResult = toResult(null)
      if (parts.length) {
        const u = this.w.Manifold.union(parts)
        try {
          res = toResult(u)
        } finally {
          u.delete()
        }
      }
      if (raw.length) res = appendRaw(res, raw)
      return { ...res, skipped }
    } finally {
      parts.forEach((p) => p.delete())
    }
  }

  dispose(): void {
    this.cache.forEach((m) => m.delete())
    this.cache.clear()
  }

  private trim(): void {
    while (this.cache.size > this.maxCache) {
      const k = this.cache.keys().next().value as string
      this.cache.get(k)!.delete()
      this.cache.delete(k)
      this.errors.delete(k)
    }
  }

  private buildGroup(children: DocNode[]): Manifold {
    const { Manifold } = this.w
    const solids: Manifold[] = []
    const holes: Manifold[] = []
    try {
      for (const c of children) {
        const m = this.manifoldOf(c).transform(toMat4(transformMatrix(c.transform)))
        ;(c.isHole ? holes : solids).push(m)
      }
      if (solids.length === 0) {
        // a group made only of holes acts as one combined hole shape
        return holes.length ? Manifold.union(holes) : new Manifold(emptyMesh(this.w))
      }
      const s = Manifold.union(solids)
      if (holes.length === 0) return s
      let h: Manifold | null = null
      try {
        h = Manifold.union(holes)
        return Manifold.difference(s, h)
      } finally {
        s.delete()
        h?.delete()
      }
    } finally {
      solids.forEach((m) => m.delete())
      holes.forEach((m) => m.delete())
    }
  }

  private buildPrim(n: PrimNode, key: string): Manifold {
    const { Manifold, CrossSection } = this.w
    const r = BASE / 2
    const p = n.params
    let m: Manifold
    switch (n.prim) {
      case 'box':
        m = Manifold.cube([BASE, BASE, BASE], true)
        break
      case 'cylinder':
        m = Manifold.cylinder(BASE, r, r, clampSegments(p.segments, 32))
        break
      case 'cone':
        m = Manifold.cylinder(BASE, r, 0, clampSegments(p.segments, 32))
        break
      case 'sphere':
        m = Manifold.sphere(r, clampSegments(p.segments, 32))
        break
      case 'pyramid':
        m = Manifold.hull([
          [-r, -r, 0],
          [r, -r, 0],
          [r, r, 0],
          [-r, r, 0],
          [0, 0, BASE]
        ])
        break
      case 'wedge':
        m = Manifold.hull([
          [-r, -r, 0],
          [r, -r, 0],
          [r, r, 0],
          [-r, r, 0],
          [-r, -r, BASE],
          [-r, r, BASE]
        ])
        break
      case 'polygon':
        // a regular prism: a corner points along +X
        m = Manifold.cylinder(BASE, r, r, clampSides(p.segments))
        break
      case 'hemisphere': {
        const ball = Manifold.sphere(r, clampSegments(p.segments, 32))
        m = ball.trimByPlane([0, 0, 1], 0)
        ball.delete()
        break
      }
      case 'roundRoof': {
        // a cylinder lying along Y, cut in half: flat side down
        const cyl = Manifold.cylinder(BASE, r, r, clampSegments(p.segments, 32), true)
        const lying = cyl.rotate([90, 0, 0])
        m = lying.trimByPlane([0, 0, 1], 0)
        cyl.delete()
        lying.delete()
        break
      }
      case 'icosahedron':
        m = Manifold.hull(icosahedronPoints(r))
        break
      case 'torus': {
        const tube = Math.max(0.5, Math.min(r - 0.5, p.tube ?? 3))
        const seg = clampSegments(p.segments, 48)
        const circle: CS = CrossSection.circle(tube, Math.max(12, Math.round(seg / 2)))
        const moved = circle.translate([r - tube, 0])
        m = moved.revolve(seg)
        circle.delete()
        moved.delete()
        break
      }
      case 'text': {
        const txt = (p.text ?? '').trim()
        if (!this.font || !txt) {
          m = new Manifold(emptyMesh(this.w))
          break
        }
        const contours = textContours(this.font, txt, BASE)
        if (contours.length === 0) {
          // only invisible characters (spaces, zero-width…)
          m = new Manifold(emptyMesh(this.w))
          break
        }
        const cs = new CrossSection(contours, 'NonZero')
        m = cs.extrude(TEXT_DEPTH)
        cs.delete()
        break
      }
      case 'mesh': {
        const md = p.meshId ? this.meshes[p.meshId] : undefined
        if (!md) {
          m = new Manifold(emptyMesh(this.w))
          break
        }
        let made: Manifold | null = null
        try {
          const mesh = new this.w.Mesh({
            numProp: 3,
            vertProperties: new Float32Array(md.vertices),
            triVerts: new Uint32Array(md.triangles)
          })
          mesh.merge()
          made = new Manifold(mesh)
          if (made.status() !== 'NoError' || made.isEmpty()) throw new Error(made.status())
          m = made
        } catch {
          made?.delete()
          if (p.prop && md.vertices.length >= 12) {
            // a piece from a mod is shown by its own model and walked on by its triangles: here
            // (picking it, its weight, pushing it) its outline will do
            const pts: [number, number, number][] = []
            for (let i = 0; i + 2 < md.vertices.length; i += 3) pts.push([md.vertices[i], md.vertices[i + 1], md.vertices[i + 2]])
            m = Manifold.hull(pts)
          } else {
            this.errors.set(key, 'notManifold')
            m = new Manifold(emptyMesh(this.w))
          }
        }
        return m // imported meshes are normalized at import time
      }
      case 'gear': {
        const g = clampGear(p.gear ?? {})
        const loops = [gearOutline(g)]
        if (g.bore > 0) loops.push(boreOutline(g))
        const cs = new CrossSection(loops, 'EvenOdd')
        m = cs.extrude(g.thickness)
        cs.delete()
        break
      }
      default:
        if (isPart(n.prim)) {
          this.parts ??= new PartBuilder(this.w, this.font)
          m = this.parts.build(n.prim, clampPart(n.prim, p.part))
          break
        }
        m = new Manifold(emptyMesh(this.w))
        break
      case 'tile':
        // a thin slab; its picture is a texture added by the view
      {
        const slab = Manifold.cube([TILE_SIZE, TILE_SIZE, TILE_THICKNESS], true)
        const t = slab.translate([0, 0, TILE_THICKNESS / 2])
        slab.delete()
        return t
      }
      case 'nerpa': {
        // an egg the character's size for picking and bounds; the view shows the animated model
        const c = profileOf(p.nerpa?.species)
        const b = Manifold.sphere(1, 32)
        const scaled = b.scale([c.length / 2, c.width / 2, c.height / 2])
        const e = scaled.translate([0, 0, c.height / 2])
        b.delete()
        scaled.delete()
        return e
      }
      case 'light': {
        // the lamp itself: a bulb, or a cone-shaped shade whose mouth is at the node origin
        const l = p.light
        if (l?.kind !== 'spot') return Manifold.sphere(LAMP_RADIUS, 24)
        const cyl = Manifold.cylinder(45, 14, 26, 32)
        const shade = cyl.translate([0, 0, -45])
        cyl.delete()
        const turned = shade.rotate([0, 90 + (l.tilt ?? 0), 0])
        shade.delete()
        return turned
      }
      case 'terrain': {
        // platforms, ramps and bridges: real size, origin at the footprint centre on the floor
        const t = placedTerrain('', p.terrain, 0, 0, 0)
        const [hx, hy] = halfSize(t)
        if (t.kind === 'ramp') {
          const pts: [number, number, number][] = [
            [-hx, -hy, 0],
            [hx, -hy, 0],
            [-hx, hy, 0],
            [hx, hy, 0],
            [-hx, hy, t.height],
            [hx, hy, t.height]
          ]
          return Manifold.hull(pts)
        }
        const bottom = t.kind === 'bridge' ? t.height - BRIDGE_DECK : 0
        const box = Manifold.cube([2 * hx, 2 * hy, t.height - bottom], true)
        const placed = box.translate([0, 0, (t.height + bottom) / 2])
        box.delete()
        return placed
      }
      case 'decor': {
        // a stand-in for picking and bounds (the view shows the model): a round column of its size
        const d = decorSpec(p.decor?.kind)
        return Manifold.cylinder(d.height, d.radius * 0.8, d.radius * 0.8, 24)
      }
      case 'robot': {
        // a simple stand-in for picking and bounds; the view shows the real model
        const spec = robotSpec(p.robot?.model)
        const cyl = Manifold.cylinder(spec.height, spec.radius, spec.radius, 48)
        const t = cyl.translate([spec.centerX, 0, 0])
        cyl.delete()
        return t
      }
      case 'sketch': {
        // extruded in its own plane frame, not normalized: the origin stays the sketch origin
        const prof = p.sketch ? buildProfile(p.sketch) : null
        const depth = Math.max(0.01, p.depth ?? 10)
        if (!prof || prof.loops.length === 0) return new Manifold(emptyMesh(this.w))
        if (p.op === 'revolve') {
          const rv = revolveSetup(p.sketch!, prof.loops, p.axis ?? 'AY')
          if (!rv) return new Manifold(emptyMesh(this.w))
          const angle = Math.max(1, Math.min(360, p.angle ?? 360))
          const seg = Math.max(8, Math.round((96 * angle) / 360))
          const cs = new CrossSection(rv.loops, 'EvenOdd')
          const r = cs.revolve(seg, angle)
          cs.delete()
          const placed = r.transform(rv.matrix as unknown as Mat4)
          r.delete()
          return placed
        }
        const cs = new CrossSection(prof.loops, 'EvenOdd')
        const ex = cs.extrude(depth)
        cs.delete()
        const dz = p.extrude === 'down' ? -depth : p.extrude === 'both' ? -depth / 2 : 0
        if (dz === 0) return ex
        const moved = ex.translate([0, 0, dz])
        ex.delete()
        return moved
      }
    }
    return normalize(m)
  }
}

/** sides of a polygon prism: 3…24 */
export const clampSides = (s: number | undefined) => Math.max(3, Math.min(24, Math.round(Number.isFinite(s) ? (s as number) : 6)))

/**
 * Corners of an icosahedron resting on one of its faces (so it prints without supports),
 * sized so its widest side is 2·r.
 */
export function icosahedronPoints(r: number): [number, number, number][] {
  const f = (1 + Math.sqrt(5)) / 2
  const raw: Vector3[] = []
  for (const a of [-1, 1]) for (const b of [-f, f]) raw.push(new Vector3(0, a, b), new Vector3(a, b, 0), new Vector3(b, 0, a))
  // the face (0,1,f) (0,-1,f) (f,0,1) turned to face straight down
  const n = new Vector3(f, 0, 2 * f + 1).normalize()
  const q = new Quaternion().setFromUnitVectors(n, new Vector3(0, 0, -1))
  raw.forEach((v) => v.applyQuaternion(q))
  const lo = new Vector3(Infinity, Infinity, Infinity)
  const hi = new Vector3(-Infinity, -Infinity, -Infinity)
  raw.forEach((v) => {
    lo.min(v)
    hi.max(v)
  })
  const k = (2 * r) / Math.max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
  return raw.map((v) => [v.x * k, v.y * k, v.z * k])
}

function emptyMesh(w: ManifoldToplevel) {
  return new w.Mesh({ numProp: 3, vertProperties: new Float32Array(), triVerts: new Uint32Array() })
}

/** Move so the box is centered in X/Y and sits on z = 0. Consumes the input. */
function normalize(m: Manifold): Manifold {
  if (m.isEmpty()) return m
  const b = m.boundingBox()
  const t = m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]])
  m.delete()
  return t
}

export function toMat4(m: Matrix4): Mat4 {
  return Array.from(m.elements) as unknown as Mat4
}

const ZERO_BOX: Box = { min: [0, 0, 0], max: [0, 0, 0] }

function toResult(m: Manifold | null): MeshResult {
  if (!m || m.isEmpty()) {
    return { positions: new Float32Array(), indices: new Uint32Array(), box: ZERO_BOX, volume: 0 }
  }
  const mesh = m.getMesh()
  const np = mesh.numProp
  const nv = mesh.vertProperties.length / np
  const positions = new Float32Array(nv * 3)
  for (let i = 0; i < nv; i++) {
    positions[i * 3] = mesh.vertProperties[i * np]
    positions[i * 3 + 1] = mesh.vertProperties[i * np + 1]
    positions[i * 3 + 2] = mesh.vertProperties[i * np + 2]
  }
  const b = m.boundingBox()
  return {
    positions,
    indices: new Uint32Array(mesh.triVerts),
    box: { min: [...b.min], max: [...b.max] },
    volume: m.volume()
  }
}

/** Append untouched triangle soups (transformed to world) to a mesh result. */
function appendRaw(res: MeshResult, raw: { md: MeshData; m: Matrix4 }[]): MeshResult {
  const extraV = raw.reduce((a, r) => a + r.md.vertices.length, 0)
  const extraT = raw.reduce((a, r) => a + r.md.triangles.length, 0)
  const positions = new Float32Array(res.positions.length + extraV)
  const indices = new Uint32Array(res.indices.length + extraT)
  positions.set(res.positions)
  indices.set(res.indices)
  let vo = res.positions.length
  let io = res.indices.length
  const v = new Vector3()
  const min = [...res.box.min] as [number, number, number]
  const max = [...res.box.max] as [number, number, number]
  const empty = res.indices.length === 0
  if (empty) {
    min.fill(Infinity)
    max.fill(-Infinity)
  }
  for (const { md, m } of raw) {
    const base = vo / 3
    const flip = m.determinant() < 0
    for (let i = 0; i < md.vertices.length; i += 3) {
      v.set(md.vertices[i], md.vertices[i + 1], md.vertices[i + 2]).applyMatrix4(m)
      positions[vo++] = v.x
      positions[vo++] = v.y
      positions[vo++] = v.z
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v.getComponent(k))
        max[k] = Math.max(max[k], v.getComponent(k))
      }
    }
    for (let i = 0; i < md.triangles.length; i += 3) {
      indices[io++] = base + md.triangles[i]
      indices[io++] = base + md.triangles[i + (flip ? 2 : 1)]
      indices[io++] = base + md.triangles[i + (flip ? 1 : 2)]
    }
  }
  return { positions, indices, box: { min, max }, volume: res.volume }
}

function rawMeshResult(md: MeshData | undefined, error: string): MeshResult {
  if (!md) return { ...toResult(null), error }
  const positions = new Float32Array(md.vertices)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k])
      max[k] = Math.max(max[k], positions[i + k])
    }
  }
  return { positions, indices: new Uint32Array(md.triangles), box: { min, max }, volume: 0, error }
}
