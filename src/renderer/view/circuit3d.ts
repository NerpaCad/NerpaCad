/**
 * The circuit in 3D: the same parts, wires and room as the flat board, standing on a table that
 * can be looked at from any side. Parts are made of simple shapes (their tops of boards wear the
 * flat drawing as a picture); during a run they show what they do — LEDs glow, the motor and the
 * servo turn, the display and the multimeter show their text — and the room's light dims the
 * whole scene at night while lamps light it up around them.
 *
 * Table coordinates (mm, y down on the flat board) become 3D as (x, −y, height).
 */
import {
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PointLight,
  Raycaster,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Texture,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { Circuit, LedColor, Part, PartKind, Room, RoomItem } from '../core/circuit/model'
import { P, SPECS, partBounds, pinPos } from '../core/circuit/parts'
import { contacts } from '../core/circuit/nets'
import { ITEM_SIZE, LAMP_RANGE } from '../core/circuit/room'
import { THEME } from './theme'
import type { PartLive, ServoState } from '../core/circuit/runner'
import type { SolveResult } from '../core/circuit/solver'

/** What the scene shows of a run (or of the idle board). */
export interface Live3D {
  running: boolean
  result: SolveResult | null
  burnt: Set<string>
  live: Record<string, PartLive>
  servos: Record<string, ServoState>
  knobs: Record<string, number>
  pressed: Set<string>
  switches: Record<string, boolean>
  joy: Record<string, [number, number]>
}

/** A part's flat drawing as a picture (made by the screen code; null when it has none). */
export type DecalSource = (part: Part, rect: [number, number, number, number]) => Promise<HTMLImageElement | null>

const LED_RGB: Record<LedColor, string> = { red: '#ff2a1a', yellow: '#ffd21a', green: '#22e04a', blue: '#2f7dff', white: '#f4f7ff' }
/** the breadboard's height: legs plugged in stand on it */
const BOARD_H = 8.5
/** the Arduino's board and the top of its female headers */
const UNO_PCB = 1.6
const HEADER_TOP = UNO_PCB + 8.5

/** modules with a row of pins on their edge, and the height of the pins' tops */
const MODULES = new Set<PartKind>(['lcd', 'joystick', 'hcsr04', 'ir', 'pir'])
const MODULE_PIN = 4.5
/** how high each kind of part stands (where wires lie over it) */
const HEIGHT: Record<PartKind, number> = {
  arduino: HEADER_TOP,
  breadboard: BOARD_H,
  resistor: 3,
  led: 6,
  pot: 6,
  servo: 24,
  button: 6.5,
  switch: 8,
  buzzer: 9.6,
  rgb: 6,
  ldr: 5,
  battery: 17,
  meter: 12,
  seg7: 8.2,
  motor: 30,
  npn: 6.5,
  diode: 3,
  lcd: 8,
  joystick: 10,
  tmp36: 6.5,
  hcsr04: 21,
  ir: 7,
  pir: 12
}

/** the table's size, mm */
const TABLE = 4000

const v3 = (x: number, y: number, z: number) => new Vector3(x, -y, z)
const mat = (color: string, extra: Partial<MeshStandardMaterial> = {}) => new MeshStandardMaterial({ color: new Color(color), roughness: 0.6, metalness: 0.05, ...extra })

/** A box between two corners of the flat board (local mm), from height z0 to z1. */
function slab(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, m: MeshStandardMaterial): Mesh {
  const b = new Mesh(new BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), m)
  b.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
  b.castShadow = true
  b.receiveShadow = true
  return b
}

/** An upright cylinder at a point of the flat board. */
function post(x: number, y: number, r: number, z0: number, z1: number, m: MeshStandardMaterial, seg = 24): Mesh {
  const c = new Mesh(new CylinderGeometry(r, r, z1 - z0, seg), m)
  c.rotation.x = Math.PI / 2
  c.position.copy(v3(x, y, (z0 + z1) / 2))
  c.castShadow = true
  return c
}

interface PartObj {
  group: Group
  key: string
  /** what moves or lights during a run */
  glow: Map<string, MeshStandardMaterial>
  spin?: Object3D
  cap?: Object3D
  slider?: Object3D
  stick?: Object3D
  screen?: { canvas: HTMLCanvasElement; tex: CanvasTexture; text: string }
}

export class CircuitScene {
  readonly renderer: WebGLRenderer
  readonly camera = new PerspectiveCamera(40, 1, 1, 20000)
  readonly controls: OrbitControls
  readonly scene = new Scene()
  private parts = new Map<string, PartObj>()
  private items = new Map<string, { group: Group; key: string; light?: PointLight; head?: MeshStandardMaterial }>()
  private wires = new Group()
  private wiresKey = ''
  // the same lights as the 3D tab (sky and ground, a light from the camera, a fill light) and a
  // sun for the shadows; the room's light scales them all
  private hemi = new HemisphereLight('#ffffff', '#9aa8b8', 1.5)
  private key = new DirectionalLight('#ffffff', 1.2)
  private fill = new DirectionalLight('#ffffff', 0.4)
  private sun = new DirectionalLight('#ffffff', 0.6)
  private base = new Map<object, number>()
  /** the table: lit from above, see-through from below */
  private table: Mesh
  private under: Mesh
  private dirty = true
  private raf = 0
  private fitted = false
  private ray = new Raycaster()
  private last: { c: Circuit; room: Room; live: Live3D } | null = null

  constructor(
    readonly host: HTMLElement,
    private decal: DecalSource,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.shadowMap.enabled = true
    host.appendChild(this.renderer.domElement)
    this.camera.up.set(0, 0, 1)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = false
    // as in the 3D tab: the right button turns, the middle one moves, the wheel zooms to the pointer
    this.controls.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }
    this.controls.zoomToCursor = true
    this.controls.screenSpacePanning = true
    this.controls.minDistance = 5
    this.controls.maxDistance = 6000
    this.controls.addEventListener('change', () => (this.dirty = true))
    this.sun.position.set(-300, -500, 900)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const sc = this.sun.shadow.camera
    sc.left = sc.bottom = -600
    sc.right = sc.top = 600
    sc.far = 3000
    this.hemi.position.set(0, 0, 1)
    this.key.position.set(-0.6, 0.9, 0.4)
    const keyTarget = new Object3D()
    keyTarget.position.set(0, 0, -1)
    this.camera.add(this.key, keyTarget)
    this.key.target = keyTarget
    this.fill.position.set(1, -1, 2)
    for (const l of [this.hemi, this.key, this.fill, this.sun]) this.base.set(l, l.intensity)
    this.scene.add(this.camera, this.hemi, this.fill, this.sun, this.wires)
    // the table in the theme's colours, with a grid (a line every 10 mm, a stronger one every 50 mm)
    this.table = new Mesh(new PlaneGeometry(TABLE, TABLE), new MeshStandardMaterial({ roughness: 0.9, metalness: 0 }))
    this.table.receiveShadow = true
    this.table.position.z = -0.01
    this.under = new Mesh(new PlaneGeometry(TABLE, TABLE), new MeshBasicMaterial({ side: BackSide, transparent: true, depthWrite: false }))
    this.under.position.z = -0.01
    this.scene.add(this.table, this.under)
    this.applyTheme()
    this.resize()
    const loop = () => {
      this.raf = requestAnimationFrame(loop)
      if (!this.dirty && !this.last?.live.running) return
      this.dirty = false
      this.renderer.render(this.scene, this.camera)
    }
    this.raf = requestAnimationFrame(loop)
  }

  /** Colours of the active theme: the background and the table (one even colour, as the workplane's base). */
  applyTheme(): void {
    this.renderer.setClearColor(new Color(THEME.clear))
    const top = this.table.material as MeshStandardMaterial
    top.map?.dispose()
    top.map = null
    top.color.set(THEME.workBase)
    top.needsUpdate = true
    // from below: the same colour, see-through
    const bottom = this.under.material as MeshBasicMaterial
    bottom.map = null
    bottom.color.set(THEME.workBase)
    bottom.opacity = Math.max(0.35, THEME.workAlphaBottom)
    bottom.needsUpdate = true
    this.dirty = true
  }

  resize(): void {
    const w = this.host.clientWidth || 800
    const h = this.host.clientHeight || 600
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.dirty = true
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.controls.dispose()
    this.scene.traverse((o) => {
      const m = o as Mesh
      m.geometry?.dispose()
      const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
      for (const x of ms) {
        ;(x as MeshStandardMaterial).map?.dispose()
        x.dispose()
      }
    })
    this.sun.shadow.dispose()
    // give the context back now: browsers keep only a few, and the main 3D view needs its own
    this.renderer.forceContextLoss()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  /** Look at the whole circuit from the front, a little from above. */
  fit(c: Circuit, room: Room): void {
    const bs = [...c.parts.map(partBounds), ...room.items.map((it) => ({ x0: it.x - ITEM_SIZE[it.kind].hw, y0: it.y - ITEM_SIZE[it.kind].hh, x1: it.x + ITEM_SIZE[it.kind].hw, y1: it.y + ITEM_SIZE[it.kind].hh }))]
    const x0 = bs.length ? Math.min(...bs.map((b) => b.x0)) : -50
    const y0 = bs.length ? Math.min(...bs.map((b) => b.y0)) : -50
    const x1 = bs.length ? Math.max(...bs.map((b) => b.x1)) : 100
    const y1 = bs.length ? Math.max(...bs.map((b) => b.y1)) : 100
    const center = v3((x0 + x1) / 2, (y0 + y1) / 2, 0)
    const dir = new Vector3(0, -1, 1).normalize()
    this.controls.target.copy(center)
    // the nearest distance from which every corner of the circuit (and a little above it) is in view
    const corners = [x0, x1].flatMap((x) => [y0, y1].flatMap((y) => [0, 25].map((z) => v3(x, y, z))))
    const fits = (d: number) => {
      this.camera.position.copy(center).addScaledVector(dir, d)
      this.camera.lookAt(center)
      this.camera.updateMatrixWorld(true)
      return corners.every((c) => {
        const p = c.clone().project(this.camera)
        return p.z < 1 && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.88
      })
    }
    let lo = 20
    let hi = 20000
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    fits(hi)
    this.controls.update()
    this.fitted = true
    this.dirty = true
  }

  // ---------------------------------------------------------------- building

  /** Bring the scene up to date with the circuit, the room and the run. */
  sync(c: Circuit, room: Room, live: Live3D): void {
    // another circuit altogether (an example opened, a new project): look at it afresh
    if (this.parts.size && c.parts.length && !c.parts.some((p) => this.parts.has(p.id))) this.fitted = false
    this.last = { c, room, live }
    const seen = new Set<string>()
    const raised = this.raisedParts(c)
    for (const p of c.parts) {
      seen.add(p.id)
      const key = JSON.stringify([p.kind, p.x, p.y, p.rot, p.color, p.volts, p.mode, p.active, p.ohms, raised.has(p.id)])
      let o = this.parts.get(p.id)
      if (!o || o.key !== key) {
        if (o) this.drop(o.group)
        o = this.buildPart(p, raised.has(p.id))
        o.key = key
        this.parts.set(p.id, o)
        this.scene.add(o.group)
      }
      this.showPart(p, o, live)
    }
    for (const [id, o] of this.parts) {
      if (seen.has(id)) continue
      this.drop(o.group)
      this.parts.delete(id)
    }
    this.syncWires(c, raised)
    this.syncRoom(room)
    if (!this.fitted) this.fit(c, room)
    this.dirty = true
  }

  /** Parts whose legs are in a breadboard stand on it. */
  private raisedParts(c: Circuit): Set<string> {
    return new Set(contacts(c).map(([leg]) => leg.split(':')[0]))
  }

  private drop(o: Object3D): void {
    this.scene.remove(o)
    o.traverse((x) => {
      const m = x as Mesh
      m.geometry?.dispose()
      const ms = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
      for (const q of ms) {
        ;(q as MeshStandardMaterial).map?.dispose()
        q.dispose()
      }
    })
  }

  /** Put a part's flat drawing (the rectangle x0 y0 – x1 y1 of it, local mm) on its top at height z. */
  private addDecal(g: Group, p: Part, z: number, rect?: [number, number, number, number]): void {
    const b = SPECS[p.kind].box
    const r = rect ?? [b.x, b.y, b.x + b.w, b.y + b.h]
    // lit like the rest: the board's print darkens at night too
    const m = new MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false, roughness: 0.7, metalness: 0 })
    const plane = new Mesh(new PlaneGeometry(r[2] - r[0], r[3] - r[1]), m)
    plane.receiveShadow = true
    plane.position.copy(v3((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, z))
    plane.renderOrder = 1
    g.add(plane)
    void this.decal({ ...p, rot: 0, x: 0, y: 0 }, r).then((img) => {
      if (!img || !plane.parent) return
      const t = new Texture(img)
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 4
      t.needsUpdate = true
      m.map = t
      m.opacity = 1
      m.needsUpdate = true
      this.dirty = true
    })
  }

  private buildPart(p: Part, raised: boolean): PartObj {
    const g = new Group()
    g.name = `part-${p.id}`
    g.userData.part = p.id
    const o: PartObj = { group: g, key: '', glow: new Map() }
    const base = 0
    const leg = mat('#b9bec6', { metalness: 0.6, roughness: 0.35 })
    const legsAt = (pins: string[], top: number) => {
      for (const id of pins) {
        const pin = SPECS[p.kind].pins.find((x) => x.id === id)!
        g.add(post(pin.x, pin.y, 0.3, raised ? -3 : 0, top, leg, 6))
      }
    }
    const ids = SPECS[p.kind].pins.map((x) => x.id)
    const glowMat = (color: string) => mat(color, { emissive: new Color(color), emissiveIntensity: 0, transparent: true, opacity: 0.85, roughness: 0.25 })
    switch (p.kind) {
      case 'arduino': {
        g.add(slab(0, 0, 68.6, 53.3, 0, UNO_PCB, mat('#00979d')))
        this.addDecal(g, p, UNO_PCB + 0.05, [0, 0, 68.6, 53.3])
        const black = mat('#1a1a1a')
        // female headers along the pin rows (their tops are where wires plug in)
        for (const [x0, x1, y] of [
          [17.5, 40.36, 2.54],
          [44.2, 61.98, 2.54],
          [29.24, 44.48, 50.8],
          [49.8, 62.5, 50.8]
        ])
          g.add(slab(x0 - 1.27, y - 1.27, x1 + 1.27, y + 1.27, UNO_PCB, HEADER_TOP, black))
        g.add(slab(-6.4, 9.3, 9.6, 21.3, UNO_PCB, UNO_PCB + 11, mat('#c9ced6', { metalness: 0.7, roughness: 0.3 })))
        g.add(slab(-1.8, 39.5, 11.7, 48.5, UNO_PCB, UNO_PCB + 11, black))
        g.add(slab(31, 31.5, 60, 39.1, UNO_PCB, UNO_PCB + 3.5, mat('#1d1f22')))
        const l = glowMat('#ffb020')
        g.add(slab(27.2, 8.6, 29, 9.6, UNO_PCB, UNO_PCB + 0.8, l))
        o.glow.set('L', l)
        const on = glowMat('#58ff6a')
        g.add(slab(57, 19, 58.8, 20, UNO_PCB, UNO_PCB + 0.8, on))
        o.glow.set('ON', on)
        break
      }
      case 'breadboard': {
        const b = SPECS.breadboard.box
        g.add(slab(b.x, b.y, b.x + b.w, b.y + b.h, 0, BOARD_H - 0.05, mat('#f3f2ec', { roughness: 0.8 })))
        this.addDecal(g, p, BOARD_H)
        break
      }
      case 'resistor': {
        legsAt(['1', '2'], base + 1.5)
        const wire = new Mesh(new CylinderGeometry(0.28, 0.28, 4 * P, 6), leg)
        wire.rotation.z = Math.PI / 2
        wire.position.copy(v3(2 * P, 0, base + 1.5))
        g.add(wire)
        const body = new Mesh(new CylinderGeometry(1.2, 1.2, 5.8, 16), mat('#e3c79a'))
        body.rotation.z = Math.PI / 2
        body.position.copy(v3(2 * P, 0, base + 1.5))
        body.castShadow = true
        g.add(body)
        break
      }
      case 'led':
      case 'rgb': {
        const pins = ids
        legsAt(pins, base + 3)
        const cx = p.kind === 'led' ? P / 2 : 1.5 * P
        const color = p.kind === 'led' ? LED_RGB[p.color ?? 'red'] : '#f4f5f7'
        const dome = glowMat(color)
        dome.opacity = 0.75
        g.add(post(cx, 0, 2.5, base + 3, base + 8, dome))
        const top = new Mesh(new SphereGeometry(2.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), dome)
        top.rotation.x = Math.PI / 2
        top.position.copy(v3(cx, 0, base + 8))
        g.add(top)
        g.add(post(cx, 0, 2.9, base + 3, base + 4, dome))
        o.glow.set('dome', dome)
        break
      }
      case 'button': {
        legsAt(ids, base + 1)
        g.add(slab(-1.2, -2 * P - 1.2, 2 * P + 1.2, 1.2, base + 1, base + 4.5, mat('#2a2c31')))
        const cap = post(P, -P, 1.9, base + 4.5, base + 6.5, mat('#d8352a'))
        g.add(cap)
        o.cap = cap
        break
      }
      case 'switch': {
        legsAt(ids, base + 1)
        g.add(slab(-1.8, -1.2, 2 * P + 1.8, 1.2, base + 1, base + 6, mat('#2d6fd0')))
        const s = slab(0, -0.8, 2, 0.8, base + 6, base + 9, mat('#f4f5f7'))
        g.add(s)
        o.slider = s
        break
      }
      case 'buzzer': {
        legsAt(ids, base + 1)
        g.add(post(1.5 * P, -0.5, 6, base + 1, base + 9.5, mat('#1d1f22')))
        g.add(post(1.5 * P, -0.5, 1, base + 9.5, base + 9.6, mat('#000000')))
        break
      }
      case 'ldr': {
        legsAt(ids, base + 3)
        g.add(post(P, 0, 2.6, base + 3, base + 5, mat('#d9a441')))
        break
      }
      case 'battery': {
        const nine = (p.volts ?? 9) === 9
        const bx = P / 2 - 13
        g.add(slab(bx, -51, bx + 26, -9, 0, nine ? 17 : 15, mat(nine ? '#2b2d33' : '#1d1f22')))
        this.addDecal(g, p, (nine ? 17 : 15) + 0.05, [bx, -51, bx + 26, -9])
        this.leads(g, [
          [0, '#d8352a'],
          [P, '#222222']
        ], -9)
        break
      }
      case 'meter': {
        g.add(slab(P - 16, -61, P + 16, -10, 0, 12, mat('#f2c230')))
        this.addDecal(g, p, 12.05, [P - 16, -61, P + 16, -10])
        this.leads(g, [
          [0, '#222222'],
          [2 * P, '#d8352a']
        ], -10)
        o.screen = this.screen(g, P - 11.5, -55.5, P + 11.5, -45.5, 12.1, 256, 112)
        break
      }
      case 'seg7': {
        legsAt(ids, base + 1)
        g.add(slab(-2.2, -6 * P - 1.4, 4 * P + 2.2, 1.4, base + 1, base + 8, mat('#1d1f22')))
        const segs: Record<string, [number, number, number, number]> = {
          a: [-2.4, -6.6, 2.4, -6.0],
          b: [2.5, -6.2, 3.1, -1.6],
          c: [2.5, 0.2, 3.1, 4.8],
          d: [-2.4, 4.9, 2.4, 5.5],
          e: [-3.1, 0.2, -2.5, 4.8],
          f: [-3.1, -6.2, -2.5, -1.6],
          g: [-2.4, -1.0, 2.4, -0.4],
          dp: [3.9, 5.0, 4.5, 5.6]
        }
        for (const [s, [x0, y0, x1, y1]] of Object.entries(segs)) {
          const m = mat('#3a2826', { emissive: new Color('#ff3b30'), emissiveIntensity: 0 })
          g.add(slab(2 * P + x0, -3 * P + y0, 2 * P + x1, -3 * P + y1, base + 8, base + 8.2, m))
          o.glow.set(s, m)
        }
        break
      }
      case 'motor': {
        this.leads(g, [
          [0, '#d8352a'],
          [3 * P, '#222222']
        ], -5)
        // it stands on its end, the shaft up: the propeller turns over it
        const cx = 1.5 * P
        g.add(post(cx, -14, 10, 0, 25, mat('#c9ced6', { metalness: 0.7, roughness: 0.3 }), 28))
        g.add(post(cx, -14, 4, 25, 26.5, mat('#9aa0a6', { metalness: 0.8 })))
        const shaft = new Group()
        shaft.position.copy(v3(cx, -14, 26.5))
        shaft.add(post(0, 0, 1, 0, 6, mat('#9aa0a6', { metalness: 0.8 }), 12))
        const prop = new Mesh(new BoxGeometry(30, 4, 1.4), mat('#ef7d1a'))
        prop.position.z = 5
        prop.rotation.x = 0.25
        prop.castShadow = true
        shaft.add(prop)
        g.add(shaft)
        o.spin = shaft
        break
      }
      case 'npn':
      case 'tmp36': {
        legsAt(ids, base + 2)
        const body = new Mesh(new CylinderGeometry(2.4, 2.4, 4.5, 20, 1, false, 0, Math.PI), mat('#1d1f22'))
        body.rotation.x = Math.PI / 2
        body.rotation.y = Math.PI / 2
        body.position.copy(v3(P, -0.2, base + 4.25))
        body.castShadow = true
        g.add(body)
        break
      }
      case 'diode': {
        legsAt(['A', 'K'], base + 1.5)
        const wire = new Mesh(new CylinderGeometry(0.3, 0.3, 4 * P, 6), leg)
        wire.rotation.z = Math.PI / 2
        wire.position.copy(v3(2 * P, 0, base + 1.5))
        g.add(wire)
        const body = new Mesh(new CylinderGeometry(1.25, 1.25, 5.4, 16), mat('#1d1f22'))
        body.rotation.z = Math.PI / 2
        body.position.copy(v3(2 * P, 0, base + 1.5))
        g.add(body)
        const band = new Mesh(new CylinderGeometry(1.3, 1.3, 0.8, 16), mat('#c9ced6'))
        band.rotation.z = Math.PI / 2
        band.position.copy(v3(7, 0, base + 1.5))
        g.add(band)
        break
      }
      case 'pot': {
        legsAt(ids, base + 1)
        g.add(slab(P - 4.9, -10, P + 4.9, -1.6, base + 1, base + 5, mat('#2f63c7')))
        const knob = new Group()
        knob.position.copy(v3(P, -5.8, base + 5))
        knob.add(post(0, 0, 3.4, 0, 3, mat('#f1f3f6')))
        knob.add(slab(-0.45, -3.2, 0.45, 0, 3, 3.3, mat('#3a3f47')))
        g.add(knob)
        o.spin = knob
        break
      }
      case 'servo': {
        this.leads(g, [
          [0, '#6b4423'],
          [P, '#d8352a'],
          [2 * P, '#ef7d1a']
        ], -21)
        g.add(slab(P - 11.5, -33.6, P + 11.5, -21.4, 0, 22, mat('#2f7ae0')))
        g.add(slab(P - 13.9, -29.4, P + 13.9, -25.8, 15, 17.5, mat('#2a6fd0')))
        const horn = new Group()
        horn.position.copy(v3(P - 4.5, -27.6, 22))
        horn.add(post(0, 0, 2.6, 0, 3, mat('#2a6fd0')))
        const arm = slab(0, -1, 9, 1, 3, 4.4, mat('#f4f5f7'))
        horn.add(arm)
        g.add(horn)
        o.spin = horn
        break
      }
      case 'lcd': {
        const x0 = 1.5 * P - 40
        g.add(slab(x0, -37, x0 + 80, -1, 0, 1.6, mat('#1f7a3a')))
        this.addDecal(g, p, 1.65, [x0, -37, x0 + 80, -1])
        g.add(slab(x0 + 4, -33, x0 + 76, -9, 1.6, 8, mat('#1d1f22')))
        o.screen = this.screen(g, x0 + 6.5, -30.5, x0 + 73.5, -11.5, 8.05, 512, 144)
        break
      }
      case 'joystick': {
        g.add(slab(2 * P - 12.5, -31.5, 2 * P + 12.5, -1.5, 0, 1.6, mat('#1d1f22')))
        g.add(post(2 * P, -17, 9.5, 1.6, 9, mat('#33363c')))
        const stick = new Group()
        stick.position.copy(v3(2 * P, -17, 9))
        stick.add(post(0, 0, 1.5, 0, 10, mat('#5d6168')))
        stick.add(post(0, 0, 6.2, 10, 15, mat('#3b3e45')))
        g.add(stick)
        o.stick = stick
        break
      }
      case 'hcsr04': {
        // it stands on its pin header: the board upright in front of the pins, the two cans looking forward (−y)
        const cx = 1.5 * P
        g.add(slab(cx - 22.5, -2.4, cx + 22.5, -0.8, 0.5, 21, mat('#2f63c7')))
        for (const x of [cx - 13, cx + 13]) {
          const can = new Mesh(new CylinderGeometry(8, 8, 11.2, 28), mat('#c9ced6', { metalness: 0.7, roughness: 0.3 }))
          can.position.copy(v3(x, -8, 11))
          can.castShadow = true
          g.add(can)
          const mesh = new Mesh(new CylinderGeometry(6.4, 6.4, 0.3, 28), mat('#3b3e45', { roughness: 0.9 }))
          mesh.position.copy(v3(x, -13.7, 11))
          g.add(mesh)
        }
        const xtal = new Mesh(new CylinderGeometry(1.4, 1.4, 2.2, 12), mat('#d6d9de', { metalness: 0.7 }))
        xtal.rotation.z = Math.PI / 2
        xtal.position.copy(v3(cx, -3.5, 18))
        g.add(xtal)
        break
      }
      case 'ir': {
        g.add(slab(P - 7, -31.5, P + 7, -1.5, 0, 1.6, mat('#1d1f22')))
        this.addDecal(g, p, 1.65, [P - 7, -31.5, P + 7, -1.5])
        g.add(post(P - 2.6, -29, 2, 1.6, 7, mat('#e8eaee')))
        g.add(post(P + 2.6, -29, 2, 1.6, 7, mat('#2a2c31')))
        const ind = glowMat('#2bff88')
        g.add(post(P + 3.5, -10, 0.9, 1.6, 2.4, ind))
        o.glow.set('active', ind)
        break
      }
      case 'pir': {
        g.add(slab(P - 12, -24.5, P + 12, -1.5, 0, 1.6, mat('#1f7a3a')))
        const dome = new Mesh(new SphereGeometry(10.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#f4f5f7', { roughness: 0.4 }))
        dome.rotation.x = Math.PI / 2
        dome.position.copy(v3(P, -13, 1.6))
        dome.castShadow = true
        g.add(dome)
        const ind = glowMat('#ff3b30')
        g.add(post(P + 9.5, -3.5, 0.9, 1.6, 2.4, ind))
        o.glow.set('active', ind)
        break
      }
    }
    // a module's pin header: wires plug onto its pins
    if (MODULES.has(p.kind)) {
      const xs = SPECS[p.kind].pins.map((x) => x.x)
      g.add(slab(Math.min(...xs) - 1.27, -1.27, Math.max(...xs) + 1.27, 1.27, 0, 2.5, mat('#1a1a1a')))
      legsAt(ids, MODULE_PIN)
    }
    // where it stands and how it is turned
    g.position.set(p.x, -p.y, raised ? BOARD_H : 0)
    g.rotation.z = (-p.rot * Math.PI) / 180
    g.traverse((x) => (x.userData.part = p.id))
    // the bits that are taken hold of during a run
    o.stick?.traverse((x) => (x.userData.handle = 'stick'))
    if (p.kind === 'pot') o.spin?.traverse((x) => (x.userData.handle = 'knob'))
    return o
  }

  /** Two (or three) leads from a module's body down to its plug. */
  private leads(g: Group, wires: [number, string][], fromY: number): void {
    for (const [x, color] of wires) {
      const curve = new CatmullRomCurve3([v3(x, 0, 1), v3(x, -3, 2.5), v3(x * 0.6 + P * 0.2, fromY + 2, 4), v3(x * 0.4 + P * 0.3, fromY, 5)])
      g.add(new Mesh(new TubeGeometry(curve, 12, 0.45, 6), mat(color)))
    }
    g.add(slab(-1.2, -1.4, wires[wires.length - 1][0] + 1.2, 1.4, 0, 2.5, mat('#1d1f22')))
  }

  /** A screen whose picture is drawn on a canvas (the LCD, the multimeter). */
  private screen(g: Group, x0: number, y0: number, x1: number, y1: number, z: number, w: number, h: number): PartObj['screen'] {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    const plane = new Mesh(new PlaneGeometry(x1 - x0, y1 - y0), new MeshBasicMaterial({ map: tex }))
    plane.position.copy(v3((x0 + x1) / 2, (y0 + y1) / 2, z))
    g.add(plane)
    return { canvas, tex, text: '\u0000' }
  }

  private drawScreen(o: PartObj, text: string, kind: 'lcd' | 'meter', on: boolean): void {
    const s = o.screen
    if (!s || s.text === `${on}|${text}`) return
    s.text = `${on}|${text}`
    const c = s.canvas.getContext('2d')
    if (!c) return
    const { width: w, height: h } = s.canvas
    if (kind === 'lcd') {
      c.fillStyle = on ? '#3f8ff0' : '#26364a'
      c.fillRect(0, 0, w, h)
      if (on) {
        c.fillStyle = '#f2f6ff'
        c.font = `${Math.round(h * 0.36)}px Consolas, 'Cascadia Mono', monospace`
        c.textBaseline = 'middle'
        const lines = text.split('\n')
        lines.forEach((l, i) => c.fillText(l, w * 0.03, h * (0.3 + 0.42 * i)))
      }
    } else {
      c.fillStyle = on ? '#b9d7a0' : '#7d8f70'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#1a2a12'
      c.font = `bold ${Math.round(h * 0.55)}px Consolas, 'Cascadia Mono', monospace`
      c.textAlign = 'right'
      c.textBaseline = 'middle'
      c.fillText(on ? text : '--.--', w * 0.95, h * 0.55)
    }
    s.tex.needsUpdate = true
  }

  /** What a part shows now: lights, turning parts, screens. */
  private showPart(p: Part, o: PartObj, live: Live3D): void {
    const r = live.result
    const lit = (id: string) => (live.burnt.has(id) ? 0 : (r?.leds.get(id)?.brightness ?? 0))
    const glow = (key: string, b: number, max = 2.5) => {
      const m = o.glow.get(key)
      if (m) m.emissiveIntensity = b * max
    }
    const l = live.live[p.id]
    switch (p.kind) {
      case 'arduino':
        glow('L', r?.builtin.get(p.id) ?? 0)
        glow('ON', live.running ? 1 : 0)
        break
      case 'led':
        glow('dome', lit(p.id), 3)
        o.glow.get('dome')?.color.set(live.burnt.has(p.id) ? '#444444' : LED_RGB[p.color ?? 'red'])
        break
      case 'rgb': {
        const m = o.glow.get('dome')!
        const [cr, cg, cb] = ['R', 'G', 'B'].map((c) => lit(`${p.id}:${c}`))
        m.emissive.setRGB(cr, cg, cb)
        m.emissiveIntensity = Math.max(cr, cg, cb) > 0 ? 3 : 0
        break
      }
      case 'seg7':
        for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']) glow(s, lit(`${p.id}:${s}`), 3)
        break
      case 'button':
        if (o.cap) o.cap.position.z = (o.cap.userData.z0 ??= o.cap.position.z) - (live.pressed.has(p.id) ? 1.2 : 0)
        break
      case 'switch':
        if (o.slider) o.slider.position.x = (live.running ? (live.switches[p.id] ?? !!p.on) : !!p.on) ? 2 * P - 1 : 1
        break
      case 'motor':
        if (o.spin) o.spin.rotation.z = -((l?.angle ?? 0) * Math.PI) / 180
        break
      case 'pot': {
        const k = live.running ? (live.knobs[p.id] ?? p.knob ?? 0.5) : (p.knob ?? 0.5)
        if (o.spin) o.spin.rotation.z = -((-135 + 270 * k) * Math.PI) / 180
        break
      }
      case 'servo': {
        const a = live.servos[p.id]?.angle ?? 90
        if (o.spin) o.spin.rotation.z = (a * Math.PI) / 180
        break
      }
      case 'joystick': {
        const [jx, jy] = live.joy[p.id] ?? [0.5, 0.5]
        if (o.stick) {
          o.stick.rotation.set(((jy - 0.5) * 0.9), ((jx - 0.5) * 0.9), 0)
          o.stick.position.z = 9 - (live.pressed.has(p.id) ? 1 : 0)
        }
        break
      }
      case 'lcd':
        this.drawScreen(o, (l?.lines ?? ['', '']).join('\n'), 'lcd', !!l?.powered)
        break
      case 'meter': {
        const v = l?.reading
        const text = v === undefined ? '--.--' : p.mode === 'A' ? (Math.abs(v) < 1 ? `${(v * 1000).toFixed(1)}mA` : `${v.toFixed(2)}A`) : `${v.toFixed(2)}V`
        this.drawScreen(o, text, 'meter', live.running)
        break
      }
      case 'ir':
      case 'pir':
        glow('active', l?.active ? 1 : 0, 3)
        break
    }
  }

  // ---------------------------------------------------------------- wires and the room

  /** Where a pin is in 3D: on a header's top, a breadboard's top, or a leg's foot. */
  private pinPoint(c: Circuit, raised: Set<string>, partId: string, pin: string): Vector3 | null {
    const p = c.parts.find((x) => x.id === partId)
    if (!p) return null
    const at = pinPos(p, pin)
    if (!at) return null
    const z = p.kind === 'arduino' ? HEADER_TOP : p.kind === 'breadboard' ? BOARD_H : (raised.has(p.id) ? BOARD_H : 0) + (MODULES.has(p.kind) ? MODULE_PIN : 1)
    return v3(at[0], at[1], z)
  }

  /** How high the parts stand at a point of the table (mm): a wire lies over them. */
  private heightAt(c: Circuit, raised: Set<string>, x: number, y: number, skip = ''): number {
    let top = 0
    for (const p of c.parts) {
      if (p.id === skip && p.kind !== 'breadboard' && p.kind !== 'arduino') continue
      const b = partBounds(p)
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue
      top = Math.max(top, HEIGHT[p.kind] + (raised.has(p.id) ? BOARD_H : 0))
    }
    return top
  }

  private syncWires(c: Circuit, raised: Set<string>): void {
    const key = JSON.stringify([c.wires, c.parts.map((p) => [p.id, p.x, p.y, p.rot]), [...raised]])
    if (key === this.wiresKey) return
    this.wiresKey = key
    for (const w of [...this.wires.children]) this.drop(w)
    this.wires.clear()
    for (const w of c.wires) {
      const a = this.pinPoint(c, raised, w.a.part, w.a.pin)
      const b = this.pinPoint(c, raised, w.b.part, w.b.pin)
      if (!a || !b) continue
      // up out of the pin, then draped along its bends over whatever lies under it, down into the other pin
      const flat: [number, number][] = [[a.x, -a.y], ...w.points, [b.x, -b.y]]
      const samples: [number, number][] = []
      for (let i = 0; i + 1 < flat.length; i++) {
        const [x0, y0] = flat[i]
        const [x1, y1] = flat[i + 1]
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3))
        for (let k = i ? 1 : 0; k <= n; k++) samples.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n])
      }
      // near its ends a wire does not climb over the part it is plugged into
      const near = (x: number, y: number, at: Vector3) => Math.hypot(x - at.x, y + at.y) < 6
      const under = samples.map(([x, y]) => this.heightAt(c, raised, x, y, near(x, y, a) ? w.a.part : near(x, y, b) ? w.b.part : '') + 1.2)
      under[0] = Math.max(under[0], a.z + 3)
      under[under.length - 1] = Math.max(under[under.length - 1], b.z + 3)
      // no steep steps: a wire bends softly over an edge
      const z = under.map((_, i) => Math.max(...under.slice(Math.max(0, i - 2), i + 3)))
      const soft = z.map((_, i) => (z[Math.max(0, i - 1)] + 2 * z[i] + z[Math.min(z.length - 1, i + 1)]) / 4)
      const pts = [a, ...samples.map(([x, y], i) => v3(x, y, Math.max(soft[i], under[i]))), b]
      const curve = new CatmullRomCurve3(dedupe(pts), false, 'centripetal')
      const tube = new Mesh(new TubeGeometry(curve, Math.min(600, Math.max(16, pts.length * 3)), 0.5, 6), mat(w.color, { roughness: 0.5 }))
      tube.castShadow = true
      this.wires.add(tube)
    }
  }

  private syncRoom(room: Room): void {
    // the room's light: from a dark night to daylight
    // (an ordinary room, 300 lx, is lit like the 3D tab; brighter is a little brighter, darker fades to night)
    const k = Math.min(1.15, Math.pow(Math.max(0, room.light) / 300, 0.6))
    for (const [l, i] of this.base) (l as DirectionalLight).intensity = i * k
    const seen = new Set<string>()
    for (const it of room.items) {
      seen.add(it.id)
      const key = `${it.kind}:${it.x}:${it.y}:${!!it.on}`
      const old = this.items.get(it.id)
      if (old && old.key === key) continue
      if (old) {
        this.drop(old.group)
        this.items.delete(it.id)
      }
      const made = this.buildItem(it)
      made.key = key
      this.items.set(it.id, made)
      this.scene.add(made.group)
    }
    for (const [id, o] of this.items) {
      if (seen.has(id)) continue
      this.drop(o.group)
      this.items.delete(id)
    }
  }

  private buildItem(it: RoomItem): { group: Group; key: string; light?: PointLight } {
    const g = new Group()
    g.position.set(it.x, -it.y, 0)
    const s = ITEM_SIZE[it.kind]
    let light: PointLight | undefined
    switch (it.kind) {
      case 'box': {
        g.add(slab(-s.hw, -s.hh, s.hw, s.hh, 0, 40, mat('#c8955a', { roughness: 0.9 })))
        g.add(slab(-8, -s.hh - 0.1, 8, s.hh + 0.1, 0, 40.2, mat('#d9c08a', { roughness: 0.7 })))
        break
      }
      case 'lamp': {
        const metal = mat('#5d6168', { metalness: 0.6, roughness: 0.35 })
        g.add(post(0, 0, s.hw, 0, 4, metal))
        g.add(post(0, 0, 1.6, 4, 60, metal))
        const head = mat(it.on ? '#fff3b0' : '#8a9099', it.on ? { emissive: new Color('#ffe680'), emissiveIntensity: 2 } : {})
        const shade = new Mesh(new SphereGeometry(14, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat('#2a2c31', { side: DoubleSide }))
        shade.rotation.x = Math.PI / 2
        shade.scale.z = -1
        shade.position.set(0, 0, 66)
        g.add(shade)
        g.add(post(0, 0, 6, 58, 62, head))
        if (it.on) {
          light = new PointLight('#fff1c8', 6000, LAMP_RANGE, 2)
          light.position.set(0, 0, 55)
          light.castShadow = false
          g.add(light)
        }
        break
      }
      case 'heater': {
        g.add(post(0, 0, s.hw, 0, 35, mat('#f4f5f7', { roughness: 0.3 })))
        g.add(post(0, 0, s.hw - 2, 35, 35.2, mat('#7a4a24', { roughness: 0.2 })))
        const handle = new Mesh(new TorusGeometry(8, 2, 8, 20, Math.PI), mat('#f4f5f7'))
        handle.rotation.set(Math.PI / 2, 0, -Math.PI / 2)
        handle.position.set(s.hw, 0, 18)
        g.add(handle)
        break
      }
      case 'hand': {
        const skin = mat('#f0c19a', { roughness: 0.7 })
        const palm = new Mesh(new SphereGeometry(1, 20, 14), skin)
        palm.scale.set(17, 20, 6)
        palm.position.set(0, -8, 30)
        palm.castShadow = true
        g.add(palm)
        for (const [x, y, a, len] of [
          [-15, 8, 0.5, 18],
          [-6, 16, 0.14, 22],
          [3, 18, 0, 24],
          [12, 14, -0.17, 20],
          [18, -8, -0.9, 16]
        ]) {
          const f = new Mesh(new CylinderGeometry(3.6, 3.6, len, 10), skin)
          f.position.set(x, y + len / 2 - 4, 30)
          f.rotation.z = a
          f.castShadow = true
          g.add(f)
        }
        break
      }
    }
    g.traverse((x) => (x.userData.item = it.id))
    return { group: g, key: '', light }
  }

  // ---------------------------------------------------------------- picking

  /** What is under the pointer: a part, a thing of the room, and the table point there (mm). */
  pick(clientX: number, clientY: number): { part?: string; item?: string; handle?: string; at: [number, number] | null } {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.ray.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera)
    const at = this.tableAt(clientX, clientY)
    const hits = this.ray.intersectObjects([...[...this.items.values()].map((o) => o.group), ...[...this.parts.values()].map((o) => o.group)], true)
    const h = hits[0]?.object
    return { part: h?.userData.part, item: h?.userData.item, handle: h?.userData.handle, at }
  }

  /** The table point under the pointer, mm on the flat board. */
  tableAt(clientX: number, clientY: number): [number, number] | null {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.ray.setFromCamera(new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera)
    const p = new Vector3()
    if (!this.ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), 0), p)) return null
    return [p.x, -p.y]
  }

  /** The screen point of a table point (for the tests). */
  toScreen(x: number, y: number, z = 0): { x: number; y: number } {
    const r = this.renderer.domElement.getBoundingClientRect()
    const v = v3(x, y, z).project(this.camera)
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height }
  }

  /** The screen point of a point of a part (its local mm on the flat board, at height z). */
  partScreen(id: string, lx: number, ly: number, z: number): { x: number; y: number } | null {
    const o = this.parts.get(id)
    if (!o) return null
    o.group.updateMatrixWorld(true)
    const w = v3(lx, ly, z).applyMatrix4(o.group.matrixWorld)
    return this.toScreen(w.x, -w.y, w.z)
  }

  /** what a kind of part is built of (the tests count them) */
  meshCount(kind: PartKind): number {
    let n = 0
    for (const [id, o] of this.parts) {
      if (this.last?.c.parts.find((p) => p.id === id)?.kind !== kind) continue
      o.group.traverse((x) => (n += (x as Mesh).isMesh ? 1 : 0))
    }
    return n
  }
}

/** Points too close together make a tube twist: keep only distinct ones. */
function dedupe(pts: Vector3[]): Vector3[] {
  const out: Vector3[] = []
  for (const p of pts) if (!out.length || out[out.length - 1].distanceTo(p) > 0.05) out.push(p)
  if (out.length < 2) out.push(out[0].clone().add(new Vector3(0, 0, 0.1)))
  return out
}
