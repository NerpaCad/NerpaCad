/**
 * What robotics objects look like: tile pictures, the robot and pad-module 3D models (FBX), the
 * animated seal (glTF), lamps with real three.js lights, and the markers of the robot's mounting pads. The document only stores the model name and the ports
 * that have sensors; everything visual is built here.
 */
import {
  type AnimationClip,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LoadingManager,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
  type Object3D,
  PlaneGeometry,
  PointLight,
  SRGBColorSpace,
  type SkinnedMesh,
  SpotLight,
  Texture,
  Vector3
} from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { type LightParams, type RobotSensor, SENSOR_TYPES, type SensorType, type TileKind } from '../core/doc/model'
import { type ColorRule, MODULE, type ModelPlacement, type PadSpec, ROBOTS, type RobotSpec } from '../core/robotics/robot'
import { PROPS, axisVector } from '../core/robotics/mods'
import { loadProps } from './modProps'
import { MODULE_COLORS, buildModule, buildNerpaBot } from './nerpabot'

export { MODULE_COLORS }
import { FLASH_HALF, FLASH_UP } from '../core/robotics/world'
import { creaturesReady, loadCreatures } from './creatureVisuals'
import { LAMP_RADIUS } from '../core/geom/engine'
import { TILE_SIZE, TILE_THICKNESS, drawTile } from '../core/robotics/tiles'

// ---------------------------------------------------------------- GPU memory

/**
 * Geometries, materials and textures used by many objects (the loaded models, tile pictures,
 * part colours). Everything else belongs to one visual and is freed with it.
 */
const shared = new WeakSet<object>()
export function keep<T extends object>(x: T): T {
  shared.add(x)
  return x
}
export function keepTree(o: Object3D): void {
  o.traverse((c) => {
    const m = c as Mesh
    if (m.geometry) shared.add(m.geometry)
    for (const x of materials(m)) {
      shared.add(x)
      for (const t of textures(x)) shared.add(t)
    }
  })
}
const materials = (m: Mesh): Material[] => (!m.material ? [] : Array.isArray(m.material) ? m.material : [m.material])
const textures = (x: Material): Texture[] =>
  Object.values(x as unknown as Record<string, unknown>).filter((v): v is Texture => v instanceof Texture)

/** Free the GPU memory of a visual that is thrown away (the shared parts stay). */
export function disposeTree(o: Object3D): void {
  o.traverse((c) => {
    const m = c as Mesh
    if (m.geometry && !shared.has(m.geometry)) m.geometry.dispose()
    for (const x of materials(m)) {
      if (shared.has(x)) continue
      for (const t of textures(x)) if (!shared.has(t)) t.dispose()
      x.dispose()
    }
    if ((c as SpotLight).isLight) (c as SpotLight).dispose?.()
    // a hero's bones live in a texture of their own (each copy of the model has its skeleton)
    if ((c as SkinnedMesh).isSkinnedMesh) (c as SkinnedMesh).skeleton?.dispose()
  })
}

// ---------------------------------------------------------------- tiles

const tileMats = new Map<TileKind, MeshStandardMaterial>()

export function tileMaterial(kind: TileKind): MeshStandardMaterial {
  let m = tileMats.get(kind)
  if (!m) {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    drawTile(c.getContext('2d')!, kind, 512)
    const tex = new CanvasTexture(c)
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = 8
    // drawn like a decal: pulled toward the camera in depth, so the slab under it never shows
    // through at grazing angles or from far away
    m = new MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    tileMats.set(kind, keep(m))
    keep(tex)
  }
  return m
}

const tilePlane = keep(new PlaneGeometry(TILE_SIZE, TILE_SIZE))

/** The picture on top of a tile (the slab below it is the pickable shape). */
export function tileTop(kind: TileKind): Mesh {
  const m = new Mesh(tilePlane, tileMaterial(kind))
  m.position.z = TILE_THICKNESS + 0.2
  noPick(m)
  return m
}

// ---------------------------------------------------------------- models

/**
 * The robots' models. NerpaBot and the pad modules are built in code (`nerpabot.ts`) the first
 * time they are needed; a mod's robot is loaded from its files (glTF or FBX) and placed as its
 * `mod.json` says. Modules a mod does not bring are the built-in ones.
 */
interface RobotModels {
  robot: Object3D
  modules: Partial<Record<SensorType, Object3D>>
}
let builtin: RobotModels | null = null
/** mod robots by id: their models once loaded (null: the files could not be loaded) */
const modModels = new Map<string, RobotModels | null>()
const modLoading = new Map<string, Promise<void>>()
let creatures: Promise<void> | null = null

function builtinModels(): RobotModels {
  if (!builtin) {
    builtin = {
      robot: buildNerpaBot(keep),
      modules: Object.fromEntries(SENSOR_TYPES.map((t) => [t, buildModule(t, keep)])) as Record<SensorType, Object3D>
    }
  }
  return builtin
}

const EMPTY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

/** Materials of a mod's colour rules (made once per rule). */
const ruleMats = new Map<string, MeshStandardMaterial>()
function ruleMaterial(r: ColorRule): MeshStandardMaterial {
  const key = JSON.stringify(r)
  let m = ruleMats.get(key)
  if (!m) {
    const transparent = r.opacity !== undefined && r.opacity < 1
    m = keep(
      new MeshStandardMaterial({
        color: new Color(r.color),
        roughness: r.roughness ?? 0.55,
        metalness: r.metalness ?? 0.05,
        ...(transparent ? { transparent: true, opacity: r.opacity, depthWrite: false, side: DoubleSide } : {}),
        ...(r.emissive ? { emissive: new Color(r.emissive), emissiveIntensity: 0.3 } : {})
      })
    )
    ruleMats.set(key, m)
  }
  return m
}
const boardMats = new Map<SensorType, MeshStandardMaterial>()
const boardMaterial = (type: SensorType) => {
  let m = boardMats.get(type)
  if (!m) boardMats.set(type, (m = keep(new MeshStandardMaterial({ color: new Color(MODULE_COLORS[type]), roughness: 0.6, metalness: 0.05 }))))
  return m
}

/**
 * Load a model file of a mod and put it in its frame (a robot's, a pad's for a module, a hero's,
 * a field piece's). Its animation clips, if any, are in `userData.clips` of the group returned.
 */
export async function loadPlaced(p: ModelPlacement, module?: SensorType): Promise<Object3D> {
  // a model painted by the mod's colours does not need its own pictures (missing ones are fine)
  const manager = new LoadingManager()
  if (p.defaultColor) manager.setURLModifier((u) => (/\.(png|jpe?g|tga|bmp|dds|tif)$/i.test(u) ? EMPTY_PNG : u))
  let clips: AnimationClip[] = []
  let model: Object3D
  if (/\.fbx$/i.test(p.url)) {
    model = await new FBXLoader(manager).loadAsync(p.url)
    clips = (model as Object3D & { animations: AnimationClip[] }).animations ?? []
  } else {
    const g = await new GLTFLoader(manager).loadAsync(p.url)
    model = g.scene
    clips = g.animations
  }
  const rules = p.colors.map((r) => ({ re: new RegExp(r.match, 'i'), mat: ruleMaterial(r) }))
  const board = p.board ? new RegExp(p.board, 'i') : null
  const fallback = p.defaultColor ? ruleMaterial({ match: '', color: p.defaultColor }) : null
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return
    const own = Array.isArray(o.material) ? o.material : [o.material]
    let m: Material | null = module && board?.test(o.name) ? boardMaterial(module) : (rules.find((r) => r.re.test(o.name))?.mat ?? fallback)
    if (m) {
      own.forEach((x) => x.dispose())
      o.material = m
    }
    o.castShadow = false
  })
  // the model's axes onto the frame's: rows are the model axes that point forward, left and up
  const [f, l, u] = [axisVector(p.forward), axisVector(p.left), axisVector(p.up)]
  const k = p.scale
  const m = new Matrix4().set(f[0] * k, f[1] * k, f[2] * k, p.offset[0], l[0] * k, l[1] * k, l[2] * k, p.offset[1], u[0] * k, u[1] * k, u[2] * k, p.offset[2], 0, 0, 0, 1)
  model.applyMatrix4(m)
  const g = new Group()
  g.add(model)
  keepTree(g)
  g.userData.clips = clips
  return g
}

/** Load a mod robot's model and its own modules (once). */
function loadModRobot(spec: RobotSpec): Promise<void> {
  let p = modLoading.get(spec.id)
  if (!p) {
    p = (async () => {
      try {
        const robot = await loadPlaced(spec.model!)
        const modules: RobotModels['modules'] = {}
        await Promise.all(
          Object.entries(spec.modules ?? {}).map(async ([type, placed]) => {
            try {
              modules[type as SensorType] = await loadPlaced(placed!, type as SensorType)
            } catch (e) {
              console.error(`mod ${spec.mod}: module ${type}`, e)
            }
          })
        )
        modModels.set(spec.id, { robot, modules })
      } catch (e) {
        // the files are missing or broken: the robot is shown as NerpaBot
        console.error(`mod ${spec.mod}: robot ${spec.id}`, e)
        modModels.set(spec.id, null)
      }
    })()
    modLoading.set(spec.id, p)
  }
  return p
}

/** Load the heroes, the robots and the field pieces of the installed mods (once each). Resolves when they are ready. */
export function loadRoboModels(): Promise<void> {
  creatures ??= loadCreatures().catch((e) => console.error('creature models', e))
  const mods = Object.values(ROBOTS)
    .filter((r) => r.model)
    .map((r) => loadModRobot(r))
  return Promise.all([creatures, loadProps(Object.values(PROPS)), ...mods]).then(() => undefined)
}

/** The models of a robot: its mod's once loaded, NerpaBot's for the rest (null: still loading). */
function modelsOf(spec: RobotSpec): RobotModels | null {
  if (!spec.model) return builtinModels()
  if (!modModels.has(spec.id)) {
    void loadModRobot(spec)
    return null
  }
  return modModels.get(spec.id) ?? builtinModels()
}

const mat = (color: string, extra: Partial<MeshStandardMaterial> = {}) =>
  new MeshStandardMaterial({ color: new Color(color), roughness: 0.55, metalness: 0.05, ...extra })

/** Are the heroes' models loaded (NerpaBot needs no loading)? */
export const roboModelsReady = () => creaturesReady()

export function noPick(o: Object3D): void {
  o.traverse((c) => {
    c.raycast = () => undefined
    c.userData.noBox = true
  })
}

/** How the flashlight's beam leaves the module: out along the pad, a little up (as in `world.ts`). */
const FLASH_DIR = new Vector3(Math.cos(FLASH_UP), 0, Math.sin(FLASH_UP))

/**
 * A pad module (a sensor or the flashlight) sitting on a pad (in the robot frame): the robot's
 * own module from its mod if it has one, the built-in one otherwise. Null while the mod loads.
 */
export function sensorOnPad(pad: PadSpec, type: SensorType = 'line', spec?: RobotSpec): Object3D | null {
  const models = spec ? modelsOf(spec) : builtinModels()
  if (!models) return null
  const template = models.modules[type] ?? builtinModels().modules[type]!
  const s = template.clone()
  s.position.set(pad.x, pad.y, pad.z)
  s.rotation.set(0, 0, pad.facing)
  s.name = `sensor-${pad.port}`
  s.userData.port = pad.port
  s.userData.type = type
  if (type === 'flashlight') {
    // its own LED material (it lights up) and a real spotlight, both off until switched on
    const led = mat('#fff6d8', { roughness: 0.2, emissive: new Color('#fff1c0'), emissiveIntensity: 0 })
    const ledName = new RegExp((models.modules.flashlight && spec?.modules?.flashlight?.led) || '^diode$', 'i')
    s.traverse((o) => {
      if (o instanceof Mesh && ledName.test(o.name)) o.material = led
    })
    const spot = new SpotLight('#fff1c8', 0, 0, FLASH_HALF, 0.35, 2)
    spot.position.set(MODULE.eyeX, 0, MODULE.eyeZ)
    spot.target.position.copy(spot.position).addScaledVector(FLASH_DIR, 100)
    s.add(spot, spot.target)
    s.userData.led = led
    s.userData.light = spot
  }
  noPick(s)
  return s
}

/** The robot model with its pad modules; null while a mod's model is still loading. */
export function robotModel(spec: RobotSpec, sensors: RobotSensor[]): Object3D | null {
  const models = modelsOf(spec)
  if (!models) return null
  const g = new Group()
  g.name = 'robot-visual'
  g.add(models.robot.clone())
  for (const sn of sensors) {
    const pad = spec.pads.find((x) => x.port === sn.port)
    const s = pad && sensorOnPad(pad, sn.type, spec)
    if (s) g.add(s)
  }
  noPick(g)
  return g
}

/** Light a robot's flashlight (0…100 %; 0 = off). */
export function setFlash(robotVisual: Object3D, port: number, brightness: number): void {
  for (const c of robotVisual.children) {
    if (c.userData.port !== port || c.userData.type !== 'flashlight') continue
    const k = Math.max(0, Math.min(100, brightness)) / 100
    ;(c.userData.led as MeshStandardMaterial).emissiveIntensity = 2.5 * k
    ;(c.userData.light as SpotLight).intensity = FLASH_INTENSITY * k
  }
}

// ---------------------------------------------------------------- lamps

/** Candela of a lamp at 100 % (the scene is in mm and the lights fall off physically, 1/r²). */
export const LAMP_INTENSITY = 160000
export const FLASH_INTENSITY = 90000

export interface LampLook {
  on: boolean
  brightness: number
  color: string
}

/**
 * What goes with a lamp besides its body: a thin pole to the floor, the real three.js light and,
 * for a cone lamp, a faint cone showing where the beam goes. `mat` is the lamp body's material.
 */
export function lampVisual(p: LightParams, height: number, color: string): Object3D {
  const g = new Group()
  g.name = 'lamp-visual'
  const pole = new Mesh(new CylinderGeometry(2.5, 2.5, Math.max(1, height), 8), mat('#9aa1ad', { metalness: 0.5, roughness: 0.4 }))
  pole.rotation.x = Math.PI / 2
  // from under the bulb (or the shade's mouth) down to the floor
  const top = p.kind === 'point' ? LAMP_RADIUS : 0
  pole.position.z = -(height + top) / 2
  pole.scale.y = Math.max(0.01, (height - top) / Math.max(1, height))
  g.add(pole)
  let light: PointLight | SpotLight
  if (p.kind === 'spot') {
    const tilt = (p.tilt * Math.PI) / 180
    const dir = new Vector3(Math.cos(tilt), 0, -Math.sin(tilt))
    const half = ((p.angle / 2) * Math.PI) / 180
    const spot = new SpotLight(color, 0, 0, Math.min(Math.PI / 2 - 0.01, half), 0.3, 2)
    spot.target.position.copy(dir).multiplyScalar(100)
    g.add(spot.target)
    light = spot
    // the beam: a see-through cone as long as it takes to reach the floor (at most 60 cm)
    const toFloor = dir.z < -0.05 ? height / -dir.z : 600
    const len = Math.min(600, toFloor)
    const r = Math.tan(half) * len
    const cone = new Mesh(
      new ConeGeometry(r, len, 32, 1, true),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false, side: DoubleSide })
    )
    // ConeGeometry points its tip up (+Y): put the tip at the lamp and the base along the beam
    cone.geometry.translate(0, -len / 2, 0)
    cone.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), dir)
    cone.name = 'beam'
    g.add(cone)
  } else light = new PointLight(color, 0, 0, 2)
  light.name = 'lamp-light'
  g.add(light)
  noPick(g)
  return g
}

/** Show a lamp on or off, at a brightness and colour. */
export function setLampLook(visual: Object3D, body: MeshStandardMaterial | null, look: LampLook): void {
  const k = look.on ? Math.max(0, Math.min(100, look.brightness)) / 100 : 0
  visual.traverse((o) => {
    if (o instanceof PointLight || o instanceof SpotLight) {
      o.color.set(look.color)
      o.intensity = LAMP_INTENSITY * k
    }
    if (o instanceof Mesh && o.name === 'beam') {
      const m = o.material as MeshBasicMaterial
      m.color.set(look.color)
      m.opacity = 0.14 * k
      o.visible = k > 0
    }
  })
  if (body) {
    body.color.set(look.color)
    body.emissive.set(look.color)
    body.emissiveIntensity = 0.15 + 1.2 * k
  }
}

/** A speech bubble drawn into a canvas: white, rounded, with a tail at the bottom left. */
export function bubbleTexture(text: string): { texture: CanvasTexture; w: number; h: number } {
  const font = '600 30px "Segoe UI", system-ui, sans-serif'
  const c = document.createElement('canvas')
  const g = c.getContext('2d')!
  g.font = font
  // wrap at about 22 characters a line, at most 4 lines
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (g.measureText(next).width > 360 && cur) {
      lines.push(cur)
      cur = w
    } else cur = next
  }
  if (cur) lines.push(cur)
  if (lines.length > 4) {
    lines.length = 4
    lines[3] += '…'
  }
  const pad = 18
  const lh = 38
  const tw = Math.max(60, ...lines.map((l) => g.measureText(l).width))
  const w = Math.ceil(tw + pad * 2)
  const h = Math.ceil(lines.length * lh + pad * 2 + 22)
  c.width = w
  c.height = h
  g.font = font
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#3a4258'
  g.lineWidth = 3
  const bh = h - 22
  g.beginPath()
  g.roundRect(1.5, 1.5, w - 3, bh - 3, 18)
  g.moveTo(26, bh - 2)
  g.lineTo(18, h - 2)
  g.lineTo(46, bh - 2)
  g.fill()
  g.stroke()
  g.fillStyle = '#ffffff'
  g.fillRect(24, bh - 6, 20, 6)
  g.fillStyle = '#15171f'
  g.textBaseline = 'top'
  lines.forEach((l, i) => g.fillText(l, pad, pad + i * lh))
  const texture = new CanvasTexture(c)
  texture.colorSpace = SRGBColorSpace
  return { texture, w, h }
}

// ---------------------------------------------------------------- pad markers ("magnets")

const padGeo = keep(new PlaneGeometry(30, 22))
export const padFree = new MeshBasicMaterial({ color: '#2bd66b', transparent: true, opacity: 0.55, depthTest: false, side: DoubleSide })
export const padHot = new MeshBasicMaterial({ color: '#ffe500', transparent: true, opacity: 0.9, depthTest: false, side: DoubleSide })
export const padBusy = new MeshBasicMaterial({ color: '#ff8a00', transparent: true, opacity: 0.55, depthTest: false, side: DoubleSide })

/** Coloured rectangles over the pads, shown while a sensor is dragged toward a robot. */
export function padMarkers(spec: RobotSpec): Group {
  const g = new Group()
  g.name = 'pad-markers'
  for (const pad of spec.pads) {
    const m = new Mesh(padGeo, padFree)
    // the pad recess is 22 mm along the sensor and 30 mm across it
    m.position.set(pad.x, pad.y, pad.z + 12)
    m.rotation.set(0, 0, pad.facing + Math.PI / 2)
    m.renderOrder = 990
    m.userData.port = pad.port
    g.add(m)
  }
  noPick(g)
  g.visible = false
  return g
}
