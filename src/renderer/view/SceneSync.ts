import {
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  Light,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3
} from 'three'
import { terrainOf } from '../core/robotics/world'
import { Batcher } from './batcher'
import { type PlacedTerrain, isLand, nearestSurface, slope } from '../core/robotics/terrain'
import { animateWater, landKey, landNeighbours, landVisual } from './landVisuals'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Box, DecorKind, Doc, DocNode } from '../core/doc/model'
import { decorVisual } from './decorVisuals'
import { type SealLook, animateCreature, creatureModel, setCreatureLook } from './creatureVisuals'
import { speciesOf } from '../core/robotics/creatures'
import { quatFromRotation } from '../core/doc/model'
import { robotSpec } from '../core/robotics/robot'
import {
  type LampLook,
  lampVisual,
  loadRoboModels,
  padBusy,
  padFree,
  padHot,
  padMarkers,
  robotModel,
  disposeTree,
  setFlash,
  setLampLook,
  tileTop
} from './roboVisuals'
import { DEFAULT_LIGHT } from '../core/robotics/world'
import { type GeomClient } from '../core/geom/client'
import { type MeshResult, geomKey } from '../core/geom/engine'
import { ghostMaterial, holeMaterial, proxyMaterial, selectionEdgeMaterial, solidMaterial, terrainEdgeMaterial } from './materials'

const keyMemo = new WeakMap<DocNode, string>()
export function keyOf(n: DocNode): string {
  let k = keyMemo.get(n)
  if (!k) {
    k = geomKey(n)
    keyMemo.set(n, k)
  }
  return k
}

interface GeoEntry {
  geometry: BufferGeometry
  edges?: BufferGeometry
  box: Box
  error?: string
}

/** The look of an object during a run. */
export interface Look {
  lamp?: LampLook
  /** flashlights: port → brightness (0 = off) */
  flash?: [number, number][]
  seal?: SealLook
}

/** One top-level document node in the scene. */
export class NodeObject extends Group {
  nodeId: string
  key: string | null = null
  box: Box | null = null
  mesh: Mesh | null = null
  edges: LineSegments | null = null
  placeholder: Object3D | null = null
  isHole = false
  /** robotics objects: the picture or 3D model shown instead of / on top of the mesh */
  visual: Object3D | null = null
  visualKey = ''
  pads: Group | null = null
  /** lamps: the body's own material (it glows in the lamp's colour) */
  lampMat: MeshStandardMaterial | null = null

  constructor(id: string) {
    super()
    this.nodeId = id
  }
}

export class SceneSync {
  readonly root = new Group()
  readonly objects = new Map<string, NodeObject>()
  private geos = new Map<string, GeoEntry>()
  /** poses from a running simulation, shown instead of the document transforms */
  readonly overrides = new Map<string, Matrix4>()
  private last: { doc: Doc; sel: string[] } | null = null
  /** how lamps, flashlights and seals look during a run (instead of their start state) */
  private looks = new Map<string, Look>()
  /** called with the number of lamps on the field after every sync */
  onLamps: ((count: number) => void) | null = null
  /** lights the renderer can afford; the rest are there but dark (sensors still see them) */
  static readonly MAX_LIGHTS = 8
  /** true when there are more lamps and flashlights than `MAX_LIGHTS` */
  tooManyLights = false

  constructor(
    private readonly geom: GeomClient,
    private readonly onChange: () => void
  ) {
    this.root.name = 'nodes'
    this.root.add(this.batcher.group)
  }

  /** landscape tiles and scenery are drawn instanced (one draw per kind of part) */
  readonly batcher = new Batcher()

  sync(doc: Doc, selection: string[]): void {
    this.last = { doc, sel: selection }
    this.geom.setMeshes(doc.meshes)
    const sel = new Set(selection)
    const seen = new Set<string>()
    const terrain = doc.nodes.some((n) => n.kind === 'prim' && n.prim === 'terrain') ? terrainOf(doc) : []
    const land = terrain.some((t) => isLand(t.kind)) ? { pieces: new Map(terrain.map((t) => [t.id, t])), nb: landNeighbours(terrain) } : null
    doc.nodes.forEach((n, i) => {
      seen.add(n.id)
      let obj = this.objects.get(n.id)
      if (!obj) {
        obj = new NodeObject(n.id)
        this.objects.set(n.id, obj)
        this.root.add(obj)
      }
      obj.renderOrder = i
      applyTransform(obj, n)
      if (n.kind === 'prim' && n.prim === 'tile') placeTile(obj, n, terrain)
      const o = this.overrides.get(n.id)
      if (o) setMatrix(obj, o)
      this.syncGeometry(obj, n)
      this.syncLook(obj, n, sel.has(n.id))
      this.syncRobo(obj, n)
      if (land && n.kind === 'prim' && n.prim === 'terrain') this.syncLand(obj, land.pieces.get(n.id), land.nb)
      if (n.kind === 'prim' && n.prim === 'decor') this.syncDecor(obj, n.params.decor?.kind ?? 'tree')
    })
    for (const [id, obj] of this.objects) {
      if (!seen.has(id)) {
        this.root.remove(obj)
        this.objects.delete(id)
        this.dropVisual(obj)
        obj.lampMat?.dispose()
        obj.lampMat = null
      }
    }
    this.pruneGeometries()
    this.rebatch(doc)
    this.budgetLights()
    this.onLamps?.(doc.nodes.filter((n) => n.kind === 'prim' && n.prim === 'light').length)
  }

  /** Draw the landscape tiles and the scenery instanced. */
  private rebatch(doc: Doc): void {
    const visuals: Object3D[] = []
    for (const n of doc.nodes) {
      if (n.kind !== 'prim' || (n.prim !== 'decor' && !(n.prim === 'terrain' && isLand(n.params.terrain?.kind ?? 'platform')))) continue
      const v = this.objects.get(n.id)?.visual
      if (v) visuals.push(v)
    }
    this.batcher.rebuild(visuals)
  }

  /** Only the first `MAX_LIGHTS` three.js lights shine (each light makes every frame dearer). */
  private budgetLights(): void {
    let n = 0
    for (const obj of this.objects.values()) {
      obj.visual?.traverse((o) => {
        if (!(o instanceof Light)) return
        n++
        o.visible = n <= SceneSync.MAX_LIGHTS
      })
    }
    this.tooManyLights = n > SceneSync.MAX_LIGHTS
  }

  // ------------------------------------------------------------ looks during a run

  /** Show a lamp, a robot's flashlights or a seal the way the simulation has them now. */
  setLook(id: string, look: Look): void {
    this.looks.set(id, look)
    const obj = this.objects.get(id)
    if (obj) this.applyLook(obj, look)
  }

  /** Move the seals' animations on by `dt` seconds. */
  animate(dt: number): void {
    for (const obj of this.objects.values()) if (obj.visual?.name === 'seal-visual') animateCreature(obj.visual, dt)
    animateWater(dt)
  }

  private applyLook(obj: NodeObject, look: Look): void {
    if (!obj.visual) return
    if (look.lamp) setLampLook(obj.visual, obj.lampMat, look.lamp)
    if (look.flash) for (const [port, b] of look.flash) setFlash(obj.visual, port, b)
    if (look.seal) {
      setCreatureLook(obj.visual, look.seal)
      // the clickable shape grows and shrinks with the seal
      obj.mesh?.scale.setScalar(Math.max(0.1, look.seal.size / 100))
    }
  }

  /** The look of an object while nothing runs: lamps as set up, flashlights off, seals at rest. */
  private idleLook(n: DocNode): Look | null {
    if (n.kind !== 'prim') return null
    if (n.prim === 'light' && n.params.light) {
      const l = { ...DEFAULT_LIGHT, ...n.params.light }
      return { lamp: { on: l.on, brightness: l.brightness, color: n.color } }
    }
    if (n.prim === 'robot' && n.params.robot) {
      return { flash: n.params.robot.sensors.filter((s) => s.type === 'flashlight').map((s) => [s.port, 0] as [number, number]) }
    }
    if (n.prim === 'nerpa') return { seal: { color: n.color, visible: true, size: 100, say: null, anim: 'idle', lift: 0, rest: true } }
    return null
  }

  /** Precise world-space box of a node, from its geometry (not from robot models or pictures). */
  worldBox(id: string): Box | null {
    return this.boxInFrame(id, IDENTITY)
  }

  // ------------------------------------------------------------ simulation poses

  /** Show a node at a pose from the simulation (the document is not touched). */
  setOverride(id: string, m: Matrix4): void {
    this.overrides.set(id, m)
    const obj = this.objects.get(id)
    if (obj) setMatrix(obj, m)
  }

  /** Back to the document's transforms and looks. */
  clearOverrides(): void {
    this.overrides.clear()
    this.looks.clear()
    this.resync()
  }

  private resync(): void {
    if (this.last) this.sync(this.last.doc, this.last.sel)
    this.onChange()
  }

  // ------------------------------------------------------------ robotics

  private syncRobo(obj: NodeObject, n: DocNode): void {
    if (n.kind !== 'prim' || !['tile', 'robot', 'light', 'nerpa'].includes(n.prim)) return
    if (n.prim === 'light') return this.syncLamp(obj, n)
    if (n.prim === 'nerpa') return this.syncSeal(obj, n)
    if (n.prim === 'tile') {
      const key = `tile:${n.params.tile}`
      if (obj.visualKey === key) return
      this.dropVisual(obj)
      obj.visual = tileTop(n.params.tile ?? 'straight')
      obj.visualKey = key
      obj.add(obj.visual)
      return
    }
    const r = n.params.robot
    const spec = robotSpec(r?.model)
    const sensors = [...(r?.sensors ?? [])].sort((a, b) => a.port - b.port)
    const key = `robot:${spec.id}:${sensors.map((s) => `${s.port}${s.type}`).join(',')}`
    if (!obj.pads) {
      obj.pads = padMarkers(spec)
      obj.add(obj.pads)
    }
    if (obj.visualKey === key) {
      const look = this.looks.get(n.id) ?? this.idleLook(n)
      if (look) this.applyLook(obj, look)
      return
    }
    const model = robotModel(spec, sensors)
    if (!model) {
      // the model is still loading: show the stand-in shape meanwhile
      void loadRoboModels().then(() => this.resync())
      return
    }
    this.dropVisual(obj)
    obj.visual = model
    obj.visualKey = key
    obj.add(model)
    if (obj.mesh) obj.mesh.material = proxyMaterial
    const look = this.looks.get(n.id) ?? this.idleLook(n)
    if (look) this.applyLook(obj, look)
  }

  /** Scenery: its little model over the clickable stand-in. */
  private syncDecor(obj: NodeObject, kind: DecorKind): void {
    if (obj.mesh) obj.mesh.material = proxyMaterial
    const key = `decor:${kind}`
    if (obj.visualKey === key) return
    this.dropVisual(obj)
    obj.visual = decorVisual(kind)
    obj.visualKey = key
    obj.add(obj.visual)
  }

  /** A landscape tile: its top (and a pool's water) over the clickable slab. */
  private syncLand(obj: NodeObject, t: PlacedTerrain | undefined, nb: ReturnType<typeof landNeighbours>): void {
    if (!t || !isLand(t.kind)) return
    if (obj.mesh) obj.mesh.material = proxyMaterial
    const key = landKey(t, nb.get(t.id))
    if (obj.visualKey === key) return
    this.dropVisual(obj)
    obj.visual = landVisual(t, nb.get(t.id))
    obj.visualKey = key
    obj.add(obj.visual)
  }

  private syncLamp(obj: NodeObject, n: DocNode & { kind: 'prim' }): void {
    const l = { ...DEFAULT_LIGHT, ...n.params.light }
    if (!obj.lampMat) obj.lampMat = new MeshStandardMaterial({ color: new Color(n.color), emissive: new Color(n.color), roughness: 0.35 })
    if (obj.mesh) obj.mesh.material = obj.lampMat
    const key = `lamp:${l.kind}:${l.angle}:${l.tilt}:${n.transform.position[2]}:${n.color}`
    if (obj.visualKey !== key) {
      this.dropVisual(obj)
      obj.visual = lampVisual(l, n.transform.position[2], n.color)
      obj.visualKey = key
      obj.add(obj.visual)
    }
    const look = this.looks.get(n.id) ?? this.idleLook(n)
    if (look) this.applyLook(obj, look)
  }

  private syncSeal(obj: NodeObject, n: DocNode & { kind: 'prim' }): void {
    if (obj.mesh) obj.mesh.material = proxyMaterial
    const species = speciesOf(n.params.nerpa?.species)
    const key = `seal:${species}:${n.color}`
    if (obj.visualKey !== key) {
      const model = creatureModel(species, n.color)
      if (!model) {
        void loadRoboModels().then(() => this.resync())
        return
      }
      this.dropVisual(obj)
      obj.visual = model
      obj.visualKey = key
      obj.add(model)
    }
    const look = this.looks.get(n.id) ?? this.idleLook(n)
    if (look) this.applyLook(obj, look)
  }

  private dropVisual(obj: NodeObject): void {
    if (!obj.visual) return
    obj.remove(obj.visual)
    disposeTree(obj.visual)
    obj.visual = null
    obj.visualKey = ''
  }

  /**
   * Pad markers while a sensor is dragged: `hot` is the pad it would snap to. Pads that
   * already carry a sensor show in orange.
   */
  showPads(on: boolean, hot: { id: string; port: number } | null, busy: (id: string) => number[]): void {
    for (const [id, obj] of this.objects) {
      if (!obj.pads) continue
      obj.pads.visible = on
      if (!on) continue
      const used = busy(id)
      for (const m of obj.pads.children as Mesh[]) {
        const port = m.userData.port as number
        m.material = hot && hot.id === id && hot.port === port ? padHot : used.includes(port) ? padBusy : padFree
      }
    }
    this.onChange()
  }

  /**
   * Exact box of a node in another frame (e.g. the workplane): every vertex is mapped through
   * `inv · matrixWorld`, so rotated objects get a tight box, not a box of a box.
   */
  boxInFrame(id: string, inv: Matrix4): Box | null {
    const obj = this.objects.get(id)
    if (!obj) return null
    obj.updateWorldMatrix(true, true)
    const min: Box['min'] = [Infinity, Infinity, Infinity]
    const max: Box['max'] = [-Infinity, -Infinity, -Infinity]
    const m = new Matrix4()
    const v = new Vector3()
    obj.traverse((o) => {
      if (!(o instanceof Mesh) || !o.visible || o.userData.noBox) return
      const pos = o.geometry.getAttribute('position')
      if (!pos) return
      m.multiplyMatrices(inv, o.matrixWorld)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m)
        for (let k = 0; k < 3; k++) {
          const c = v.getComponent(k)
          if (c < min[k]) min[k] = c
          if (c > max[k]) max[k] = c
        }
      }
    })
    if (min[0] === Infinity) {
      const p = obj.position.clone().applyMatrix4(inv)
      return { min: [p.x, p.y, p.z], max: [p.x, p.y, p.z] }
    }
    return { min, max }
  }

  boxesInFrame(ids: string[], inv: Matrix4): Record<string, Box> {
    const r: Record<string, Box> = {}
    for (const id of ids) {
      const b = this.boxInFrame(id, inv)
      if (b) r[id] = b
    }
    return r
  }

  worldBoxes(ids: string[]): Record<string, Box> {
    const r: Record<string, Box> = {}
    for (const id of ids) {
      const b = this.worldBox(id)
      if (b) r[id] = b
    }
    return r
  }

  pickables(): Object3D[] {
    return [...this.objects.values()]
  }

  private syncGeometry(obj: NodeObject, n: DocNode): void {
    const key = keyOf(n)
    if (obj.key === key) return
    const res = this.geom.peekKey(key)
    if (res) {
      this.setGeometry(obj, key, res)
      return
    }
    this.geom.request(n).catch(() => undefined) // revision bump re-syncs when it arrives
    if (!obj.mesh && !obj.placeholder) {
      const ph = this.buildPlaceholder(n)
      if (ph) {
        obj.placeholder = ph
        obj.add(ph)
      }
    }
  }

  private setGeometry(obj: NodeObject, key: string, res: MeshResult): void {
    let entry = this.geos.get(key)
    if (!entry) {
      entry = { geometry: toGeometry(res), box: res.box, error: res.error }
      this.geos.set(key, entry)
    }
    if (obj.placeholder) {
      obj.remove(obj.placeholder)
      obj.placeholder = null
    }
    if (!obj.mesh) {
      obj.mesh = new Mesh(entry.geometry)
      obj.mesh.userData.nodeObject = obj
      obj.add(obj.mesh)
    } else {
      obj.mesh.geometry = entry.geometry
    }
    if (obj.edges) {
      obj.remove(obj.edges)
      obj.edges = null
    }
    obj.key = key
    obj.box = entry.box
    this.onChange()
  }

  /** shapes shown see-through (in front of an open sketch) */
  private ghosts = new Set<string>()

  /** Show these shapes see-through (none: back to normal). */
  setGhosts(ids: Iterable<string>): void {
    this.ghosts = new Set(ids)
    if (this.last) this.sync(this.last.doc, this.last.sel)
  }

  private syncLook(obj: NodeObject, n: DocNode, selected: boolean): void {
    obj.isHole = n.isHole
    const ghost = this.ghosts.has(n.id)
    const mat = ghost ? ghostMaterial(n.isHole ? '#8a96b0' : n.color) : n.isHole ? holeMaterial() : solidMaterial(n.color, n.material)
    const order = ghost ? 20 : n.isHole ? 10 : n.material === 'glass' ? 5 : 0
    const apply = (o: Object3D) => {
      o.traverse((c) => {
        if (c instanceof Mesh) {
          c.material = mat
          c.renderOrder = order
        }
      })
    }
    if (obj.mesh) apply(obj.mesh)
    if (obj.placeholder) apply(obj.placeholder)
    if (obj.mesh && obj.visual && n.kind === 'prim' && (n.prim === 'robot' || n.prim === 'nerpa')) obj.mesh.material = proxyMaterial
    if (obj.mesh && obj.lampMat && n.kind === 'prim' && n.prim === 'light') obj.mesh.material = obj.lampMat

    // terrain pieces always show their outline (darker when not selected); landscape tiles only when selected
    const terrain = n.kind === 'prim' && n.prim === 'terrain' && !isLand(n.params.terrain?.kind ?? 'platform')
    if ((selected || terrain) && obj.mesh && obj.key) {
      if (!obj.edges) {
        const entry = this.geos.get(obj.key)!
        if (!entry.edges) entry.edges = new EdgesGeometry(entry.geometry, 25)
        obj.edges = new LineSegments(entry.edges, selectionEdgeMaterial)
        obj.edges.raycast = () => undefined
        obj.add(obj.edges)
      }
      obj.edges.material = selected ? selectionEdgeMaterial : terrainEdgeMaterial
    } else if (obj.edges) {
      obj.remove(obj.edges)
      obj.edges = null
    }
  }

  /** While a group's result is computing, show its children's cached meshes. */
  private buildPlaceholder(n: DocNode): Object3D | null {
    if (n.kind !== 'group') return null
    const g = new Group()
    let any = false
    for (const c of n.children) {
      const key = keyOf(c)
      const res = this.geom.peekKey(key)
      let child: Object3D | null = null
      if (res) {
        let entry = this.geos.get(key)
        if (!entry) {
          entry = { geometry: toGeometry(res), box: res.box }
          this.geos.set(key, entry)
        }
        child = new Mesh(entry.geometry)
        child.visible = !c.isHole
      } else {
        child = this.buildPlaceholder(c)
      }
      if (child) {
        const holder = new Group()
        applyTransform(holder, c)
        holder.add(child)
        g.add(holder)
        any = true
      }
    }
    if (!any) return null
    g.traverse((o) => (o.userData.nodeObject = undefined))
    return g
  }

  private pruneGeometries(): void {
    if (this.geos.size < 150) return
    const used = new Set<string>()
    for (const o of this.objects.values()) if (o.key) used.add(o.key)
    for (const [k, e] of this.geos) {
      if (!used.has(k)) {
        e.geometry.dispose()
        e.edges?.dispose()
        this.geos.delete(k)
      }
    }
  }
}

const IDENTITY = new Matrix4()

/**
 * A tile lies on the surface nearest to its height: raised onto a platform or a bridge, and on a
 * ramp sheared along the slope (seen from above it keeps its square, like the line sensor sees it).
 */
function placeTile(o: Object3D, n: DocNode, terrain: PlacedTerrain[]): void {
  o.matrixAutoUpdate = true
  if (!terrain.length) return
  const [x, y, z] = n.transform.position
  const s = nearestSurface(terrain, x, y, z)
  o.position.z = s.z
  if (s.piece?.kind !== 'ramp') return
  o.updateMatrix()
  const { rise, dir } = slope(s.piece)
  // z' = z + rise · ((x − cx)·dx + (y − cy)·dy)
  const shear = new Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, rise * dir[0], rise * dir[1], 1, -rise * (x * dir[0] + y * dir[1]), 0, 0, 0, 1)
  o.matrix.premultiply(shear)
  o.matrixAutoUpdate = false
  o.matrixWorldNeedsUpdate = true
}

function setMatrix(o: Object3D, m: Matrix4): void {
  o.matrixAutoUpdate = true
  m.decompose(o.position, o.quaternion, o.scale)
  o.updateMatrix()
}

export function applyTransform(o: Object3D, n: DocNode): void {
  const t = n.transform
  o.position.set(...t.position)
  o.quaternion.copy(quatFromRotation(t.rotation))
  o.scale.set(...t.scale)
  o.updateMatrix()
}

export function toGeometry(res: MeshResult): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(res.positions, 3))
  g.setIndex(new BufferAttribute(res.indices, 1))
  if (res.indices.length === 0) return g
  const creased = toCreasedNormals(g, (35 * Math.PI) / 180)
  g.dispose()
  creased.computeBoundingBox()
  creased.computeBoundingSphere()
  return creased
}
