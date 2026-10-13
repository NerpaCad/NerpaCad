/**
 * NerpaBot, the app's own robot, and the pad modules (sensors and the flashlight), built from
 * simple shapes in code — no model files. The robot frame: mm, X forward, Y to the left, Z up,
 * origin on the floor between the drive wheels (see `core/robotics/robot.ts`). A module is built in
 * its pad's frame: X out along the pad's facing, Z up from the pad surface (see `MODULE`).
 *
 * Every geometry and material here is shared by all copies (`keep`), so clones cost nothing.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  Shape,
  SphereGeometry
} from 'three'
import type { SensorType } from '../core/doc/model'
import { MODULE, NERPABOT } from '../core/robotics/robot'

/** shared parts are registered with the caller's keep() so that disposing a copy never frees them */
type Keep = <T extends object>(x: T) => T

const COLORS = {
  deck: '#eef1f6',
  rim: '#ffc61a',
  tray: '#2b3040',
  pad: '#3d4558',
  tyre: '#22252c',
  hub: '#ffc61a',
  head: '#2b3040',
  screen: '#11141c',
  eye: '#4be3ff',
  metal: '#b9c0cb',
  black: '#1b1b1f'
}

/** Board colour of each pad module, so the kinds are told apart at a glance. */
export const MODULE_COLORS: Record<SensorType, string> = {
  line: '#1d7a45',
  ultrasonic: '#1f5fbf',
  touch: '#c62828',
  light: '#d9a400',
  flashlight: '#e06a00'
}

let mats: Record<string, MeshStandardMaterial> | null = null
const mat = (keep: Keep) => {
  if (mats) return mats
  const m = (color: string, extra: Partial<MeshStandardMaterial> = {}) =>
    keep(new MeshStandardMaterial({ color: new Color(color), roughness: 0.5, metalness: 0.05, ...extra }))
  mats = {
    deck: m(COLORS.deck, { roughness: 0.45 }),
    rim: m(COLORS.rim, { roughness: 0.4 }),
    tray: m(COLORS.tray, { roughness: 0.7 }),
    pad: m(COLORS.pad, { roughness: 0.8 }),
    tyre: m(COLORS.tyre, { roughness: 0.95 }),
    hub: m(COLORS.hub, { roughness: 0.4, metalness: 0.1 }),
    head: m(COLORS.head, { roughness: 0.6 }),
    screen: m(COLORS.screen, { roughness: 0.25 }),
    eye: m(COLORS.eye, { emissive: new Color(COLORS.eye), emissiveIntensity: 0.9, roughness: 0.3 }),
    metal: m(COLORS.metal, { metalness: 0.6, roughness: 0.35 }),
    black: m(COLORS.black, { roughness: 0.5 }),
    white: m('#f4f4f4', { roughness: 0.3 }),
    red: m('#e0322b', { roughness: 0.45 }),
    dome: m('#ffe9a8', { roughness: 0.15, transparent: true, opacity: 0.85 }),
    led: m('#fff6d8', { roughness: 0.2, emissive: new Color('#fff1c0'), emissiveIntensity: 0.15 }),
    ...Object.fromEntries(Object.entries(MODULE_COLORS).map(([k, c]) => [`board_${k}`, m(c, { roughness: 0.6 })]))
  }
  return mats
}

/** A rounded rectangle from (x0, y0) to (x1, y1) with corner radius r (front corners rf). */
function roundRect(x0: number, y0: number, x1: number, y1: number, r: number, rf = r): Shape {
  const s = new Shape()
  s.moveTo(x0 + r, y0)
  s.lineTo(x1 - rf, y0)
  s.quadraticCurveTo(x1, y0, x1, y0 + rf)
  s.lineTo(x1, y1 - rf)
  s.quadraticCurveTo(x1, y1, x1 - rf, y1)
  s.lineTo(x0 + r, y1)
  s.quadraticCurveTo(x0, y1, x0, y1 - r)
  s.lineTo(x0, y0 + r)
  s.quadraticCurveTo(x0, y0, x0 + r, y0)
  return s
}

/** A flat slab of a shape from z0 to z1. */
const slab = (shape: Shape, z0: number, z1: number): BufferGeometry => {
  const g = new ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, curveSegments: 10 })
  g.translate(0, 0, z0)
  return g
}

const geos = new Map<string, BufferGeometry>()
/** a shared geometry, made once */
function geo(key: string, make: () => BufferGeometry, keep: Keep): BufferGeometry {
  let g = geos.get(key)
  if (!g) geos.set(key, (g = keep(make())))
  return g
}

const part = (g: BufferGeometry, m: Material, name: string, x = 0, y = 0, z = 0): Mesh => {
  const o = new Mesh(g, m)
  o.name = name
  o.position.set(x, y, z)
  return o
}

/** The deck's outline: from just behind the back pads to just past the front one, inside the wheels. */
const DECK = { x0: -66, x1: 84, half: 52 }
/** the pad surface height (where modules sit) */
const PAD_Z = NERPABOT.pads[0].z

/** NerpaBot's body: deck, tray, wheels, caster, head with a face, antenna, five pads. */
export function buildNerpaBot(keep: Keep): Object3D {
  const m = mat(keep)
  const g = new Group()
  g.name = 'nerpabot'
  const { wheelRadius: R, track } = NERPABOT
  // the tray underneath (battery and motors) and the deck with a yellow rim
  g.add(part(geo('tray', () => slab(roundRect(-58, -44, 72, 44, 14, 22), 7, 12.5), keep), m.tray, 'tray'))
  g.add(part(geo('rim', () => slab(roundRect(DECK.x0 - 2, -DECK.half - 2, DECK.x1 + 2, DECK.half + 2, 20, 34), 12, 14.5), keep), m.rim, 'rim'))
  g.add(part(geo('deck', () => slab(roundRect(DECK.x0, -DECK.half, DECK.x1, DECK.half, 18, 32), 14.5, PAD_Z - 0.5), keep), m.deck, 'deck'))
  // the pads: dark sockets where modules go
  const padGeo = geo('pad', () => slab(roundRect(-15, -11, 15, 11, 3), PAD_Z - 0.5, PAD_Z), keep)
  for (const p of NERPABOT.pads) {
    const pad = part(padGeo, m.pad, `pad-${p.port}`, p.x, p.y)
    pad.rotation.z = p.facing
    g.add(pad)
  }
  // wheels: tyre, yellow hub with a cap; motors on the deck beside them
  const tyre = geo('tyre', () => new CylinderGeometry(R, R, 12, 36), keep)
  const hub = geo('hub', () => new CylinderGeometry(R * 0.58, R * 0.58, 13, 24), keep)
  const cap = geo('cap', () => new CylinderGeometry(3.5, 3.5, 15, 12), keep)
  const motor = geo('motor', () => new BoxGeometry(26, 9, 12), keep)
  for (const side of [1, -1]) {
    const y = (side * track) / 2
    g.add(part(tyre, m.tyre, 'wheel', 0, y, R))
    g.add(part(hub, m.hub, 'hub', 0, y, R))
    g.add(part(cap, m.metal, 'axle', 0, y, R))
    g.add(part(motor, m.head, 'motor', 0, side * 47, PAD_Z + 6))
  }
  // the ball caster at the back
  g.add(part(geo('caster', () => new SphereGeometry(7, 16, 12), keep), m.metal, 'caster', -50, 0, 7))
  g.add(part(geo('casterMount', () => new CylinderGeometry(9, 9, 5, 16).rotateX(Math.PI / 2), keep), m.tray, 'caster-mount', -50, 0, 10.5))
  // the head between the pads: a dark box with a screen face and two glowing eyes, looking forward
  const head = new Group()
  head.name = 'head'
  head.add(part(geo('head', () => slab(roundRect(-17, -22, 19, 22, 6, 8), 0, 22), keep), m.head, 'head-box'))
  head.add(part(geo('screen', () => new BoxGeometry(1.5, 34, 14), keep), m.screen, 'screen', 19.5, 0, 12))
  const eye = geo('eye', () => new BoxGeometry(1, 7, 6), keep)
  head.add(part(eye, m.eye, 'eye', 20.4, 7.5, 13))
  head.add(part(eye, m.eye, 'eye', 20.4, -7.5, 13))
  head.position.z = PAD_Z
  g.add(head)
  // a little antenna (the top of the robot: its height)
  g.add(part(geo('antenna', () => new CylinderGeometry(1.2, 1.2, 14, 8).rotateX(Math.PI / 2), keep), m.metal, 'antenna', -8, 12, PAD_Z + 22 + 7))
  g.add(part(geo('antennaTip', () => new SphereGeometry(3.2, 12, 10), keep), m.rim, 'antenna-tip', -8, 12, NERPABOT.height - 3.2))
  return g
}

/**
 * A pad module of `type` in its pad's frame: a board in the kind's colour (the mesh named
 * "board") with what that kind has at its far end. The flashlight's LED is the mesh "diode".
 */
export function buildModule(type: SensorType, keep: Keep): Object3D {
  const m = mat(keep)
  const g = new Group()
  g.name = `module-${type}`
  // the board: 70 × 31 mm from 11 mm behind the pad centre out along the facing
  const board = part(geo('board', () => slab(roundRect(-11, -15.5, 59, 15.5, 4), 0, 7), keep), m[`board_${type}`], 'board')
  g.add(board)
  g.add(part(geo('chip', () => new BoxGeometry(14, 10, 2), keep), m.black, 'chip', 14, 0, 8))
  switch (type) {
    case 'line': {
      // two small "eyes" on the end (it looks at the floor below)
      const eye = geo('lineEye', () => new CylinderGeometry(2.6, 2.6, 4, 12).rotateX(Math.PI / 2), keep)
      g.add(part(eye, m.black, 'eye', MODULE.eyeX, 4.5, 9))
      g.add(part(eye, m.white, 'eye', MODULE.eyeX, -4.5, 9))
      break
    }
    case 'ultrasonic': {
      // the two round transducers at the end, looking out
      const can = geo('sonarCan', () => new CylinderGeometry(7.5, 7.5, 12, 24).rotateZ(Math.PI / 2), keep)
      const mesh = geo('sonarMesh', () => new CylinderGeometry(6, 6, 0.6, 24).rotateZ(Math.PI / 2), keep)
      for (const y of [9, -9]) {
        g.add(part(can, m.metal, 'transducer', MODULE.sonarX - 6, y, MODULE.sonarZ))
        g.add(part(mesh, m.black, 'grille', MODULE.sonarX + 0.3, y, MODULE.sonarZ))
      }
      break
    }
    case 'touch': {
      // a red button at the tip
      g.add(part(geo('touchHolder', () => new BoxGeometry(6, 20, 10), keep), m.black, 'holder', MODULE.touchX - 9, 0, 9))
      g.add(part(geo('touchButton', () => new BoxGeometry(6, 16, 12), keep), m.red, 'button', MODULE.touchX - 3, 0, MODULE.touchZ))
      break
    }
    case 'light': {
      // a little dome (the light-dependent resistor) on a ring
      g.add(part(geo('ring', () => new CylinderGeometry(6, 6, 2, 20).rotateX(Math.PI / 2), keep), m.metal, 'ring', MODULE.eyeX, 0, 8))
      g.add(part(geo('dome', () => new SphereGeometry(5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2), keep), m.dome, 'dome', MODULE.eyeX, 0, 9))
      break
    }
    case 'flashlight': {
      // a reflector and the LED (lit by the program)
      g.add(part(geo('reflector', () => new CylinderGeometry(7, 5, 6, 20).rotateZ(Math.PI / 2), keep), m.metal, 'reflector', MODULE.eyeX - 2, 0, MODULE.eyeZ - 3))
      g.add(part(geo('led', () => new SphereGeometry(4, 16, 12), keep), m.led, 'diode', MODULE.eyeX + 2, 0, MODULE.eyeZ - 3))
      break
    }
  }
  return g
}
