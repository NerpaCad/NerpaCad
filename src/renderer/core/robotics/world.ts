/**
 * The programmed side of a simulation run: tiles on the floor, robots driving over them with their
 * sensors and flashlights, lamps and seals, and all their programs. It knows nothing about the
 * screen or the physics engine, so whole runs can be tested headless. Shapes that fall and get
 * pushed are handled by `physics.ts`; questions about solid things (the ultrasonic ray, the touch
 * button, shadows for the light sensor) go to a `Probe` when one is given.
 */
import type { Doc, DocNode, LightParams, PrimNode, RobotSensor } from '../doc/model'
import { transformMatrix } from '../doc/model'
import { Vector3 } from 'three'
import { type Done, type LampIO, type NerpaIO, Program, type RobotIO, type SoundIO, type TargetKind } from './interpreter'
import type { SoundSink } from './sounds'
import { IN_AIR, type SurfaceKind, surfaceAt, topSurfaceAt } from './surface'
import { type Pose, drive, toWorld, wheelSpeed } from './kinematics'
import {
  MODULE,
  type PadSpec,
  type RobotSpec,
  SONAR_HALF_ANGLE,
  SONAR_MAX_CM,
  SONAR_MIN_CM,
  padOf,
  padPoint,
  robotSpec,
  sensorPoint
} from './robot'
import { type PlacedTile, SURFACE_LIGHT, lineSensor } from './sensors'
import { type LightSource, type V3, lightReading } from './lighting'
import { type Probe, occlusionFrom } from './probe'
import { postsOf } from './decor'
import { JUMP_HEIGHT, SimCreature, leapTop } from './nerpa'
import { CEILING, CRUISE, GLIDE_DOWN, canFly, canLeap, canRun, canCrawl, canSwim, profileOf } from './creatures'
import {
  CLIMB,
  GROUND_HEIGHT,
  type PlacedTerrain,
  STEP,
  type Stance,
  nearestSurface,
  placedTerrain,
  stance,
  supportHit,
  surfacesAt,
  topAt,
  topSurface,
  wallAt,
  wetAt
} from './terrain'

/** physics step and program tick, seconds */
export const PHYS_DT = 1 / 120
export const PROGRAM_DT = 1 / 60

export interface Flash {
  on: boolean
  /** 0…100 % */
  brightness: number
}

export interface SimRobot {
  id: string
  spec: RobotSpec
  pose: Pose
  /** height of the ground under the robot (the surface it stands on), mm */
  z: number
  /** how it leans on a ramp: nose up (pitch) and left side up (roll), radians */
  pitch: number
  roll: number
  /** falling off an edge: vertical speed, mm/s */
  vz: number
  left: number
  right: number
  sensors: RobotSensor[]
  /** latest sensor values by port */
  readings: Map<number, number>
  /** flashlights by port */
  flash: Map<number, Flash>
  program: Program | null
}

export interface SimLight {
  id: string
  kind: 'spot' | 'point'
  /** the bulb, mm */
  x: number
  y: number
  z: number
  /** where a cone lamp points: around Z, and down from level (radians) */
  heading: number
  tilt: number
  /** full opening angle of the cone, radians */
  angle: number
  color: string
  brightness: number
  on: boolean
  program: Program | null
}

export interface SimSeal {
  seal: SimCreature
  program: Program | null
}

/** A solid shape on the field, for the seal's "distance to" and glowing shapes for light sensors. */
export interface ShapeSpot {
  id: string
  pos: V3
  /** about how big it is (half its diagonal), mm */
  radius: number
  glow: boolean
}

/** How strongly a glowing shape lights the sensors, % */
export const GLOW_BRIGHTNESS = 60
export const LAMP_SIZE = 22

const isPrim = (n: DocNode, t: string): n is PrimNode => n.kind === 'prim' && n.prim === t
const DEG = Math.PI / 180

/** Heading (radians around Z) and position of a node on the floor. */
export function floorPose(n: DocNode): { pose: Pose; z: number } {
  const m = transformMatrix(n.transform)
  const fwd = new Vector3(1, 0, 0).transformDirection(m)
  const p = n.transform.position
  return { pose: { x: p[0], y: p[1], theta: Math.atan2(fwd.y, fwd.x) }, z: p[2] }
}

/** Platforms, ramps and bridges of the field. */
export function terrainOf(doc: Doc): PlacedTerrain[] {
  return doc.nodes.filter((n) => isPrim(n, 'terrain')).map((n) => {
    const { pose } = floorPose(n)
    return placedTerrain(n.id, (n as PrimNode).params.terrain, pose.x, pose.y, pose.theta, n.transform.position[2])
  })
}

/**
 * The tiles with the surface each lies on: the surface at its centre nearest to its own height
 * (so a tile follows a platform that is made taller, and one on the floor under a bridge stays
 * there). On a ramp it follows the slope.
 */
export function tilesOf(doc: Doc, terrain: PlacedTerrain[] = terrainOf(doc)): PlacedTile[] {
  // roads with a line on landscape tiles first: track tiles laid over them are on top
  const roads: PlacedTile[] = terrain
    .filter((t) => t.kind === 'ground' && t.surface === 'road' && t.line)
    .map((t) => ({ kind: t.line!, x: t.x, y: t.y, angle: t.angle, z: GROUND_HEIGHT, paper: SURFACE_LIGHT.road }))
  return [...roads, ...doc.nodes.filter((n) => isPrim(n, 'tile')).map((n) => {
    const { pose, z } = floorPose(n)
    const s = nearestSurface(terrain, pose.x, pose.y, z)
    const t: PlacedTile = { kind: (n as PrimNode).params.tile ?? 'straight', x: pose.x, y: pose.y, angle: pose.theta, z: s.z }
    if (s.piece?.kind === 'ramp') t.ramp = s.piece
    return t
  })]
}

/** falling: gravity in mm/s² */
const GRAVITY = 9810

export const DEFAULT_LIGHT: LightParams = { kind: 'point', brightness: 100, on: true, angle: 60, tilt: 30 }

export class RoboWorld {
  time = 0
  private steps = 0
  /** answers questions about solid things; without one the ultrasonic sees nothing and touch stays 0 */
  probe: Probe | null = null
  /** solid shapes on the field (where they are now); set together with the probe */
  shapes: () => ShapeSpot[] = () => []
  /** where the heroes' sounds go (the app plays them); none: the run is silent */
  sounds: SoundSink | null = null

  constructor(
    readonly tiles: PlacedTile[],
    readonly robots: SimRobot[],
    readonly lights: SimLight[] = [],
    readonly seals: SimSeal[] = [],
    readonly terrain: PlacedTerrain[] = []
  ) {
    for (const r of robots) this.read(r)
  }

  /** what a pigeon says when told to land on water (the app sets it in the user's language) */
  static waterSay = 'Тут вода!'
  /** what the "under me" block says for each surface (the app sets them in the user's language) */
  static surfaceWords: Partial<Record<SurfaceKind, string>> = {}

  static fromDoc(doc: Doc): RoboWorld {
    const robots: SimRobot[] = []
    const lights: SimLight[] = []
    const seals: SimSeal[] = []
    // the scenery blocks the way like terrain does (but tiles do not lie on it)
    const pieces = terrainOf(doc)
    const terrain = [...pieces, ...postsOf(doc)]
    const w = new RoboWorld(tilesOf(doc, pieces), robots, lights, seals, terrain)
    for (const n of doc.nodes) {
      if (isPrim(n, 'robot') && n.params.robot) {
        const { pose, z } = floorPose(n)
        const spec = robotSpec(n.params.robot.model)
        // it stands on the surface nearest to where it was put, leaning as that surface does
        const ground = nearestSurface(terrain, pose.x, pose.y, z).z
        const st = stance(terrain, pose.x, pose.y, pose.theta, ground, spec.radius, spec.height, spec.centerX)
        const r: SimRobot = {
          id: n.id,
          spec,
          pose,
          z: st.blocked ? ground : st.z,
          pitch: st.blocked ? 0 : st.pitch,
          roll: st.blocked ? 0 : st.roll,
          vz: 0,
          left: 0,
          right: 0,
          sensors: n.params.robot.sensors,
          readings: new Map(),
          flash: new Map(),
          program: null
        }
        for (const s of r.sensors) if (s.type === 'flashlight') r.flash.set(s.port, { on: false, brightness: 100 })
        r.program = new Program(n.params.robot.program, { ...w.robotIO(r), broadcast: w.broadcast })
        robots.push(r)
      } else if (isPrim(n, 'light') && n.params.light) {
        const p = { ...DEFAULT_LIGHT, ...n.params.light }
        const { pose } = floorPose(n)
        const l: SimLight = {
          id: n.id,
          kind: p.kind,
          x: pose.x,
          y: pose.y,
          z: n.transform.position[2],
          heading: pose.theta,
          tilt: p.tilt * DEG,
          angle: p.angle * DEG,
          color: n.color,
          brightness: p.brightness,
          on: p.on,
          program: null
        }
        l.program = new Program(n.params.light.program, { lamp: lampIO(l), broadcast: w.broadcast })
        lights.push(l)
      } else if (isPrim(n, 'nerpa') && n.params.nerpa) {
        const { pose, z } = floorPose(n)
        const s: SimSeal = { seal: new SimCreature(n.id, pose.x, pose.y, pose.theta, n.color, profileOf(n.params.nerpa.species)), program: null }
        const under = nearestSurface(terrain, pose.x, pose.y, z)
        s.seal.z = under.z
        s.seal.wet = !!under.water && canSwim(s.seal.profile)
        s.program = new Program(n.params.nerpa.program, { nerpa: w.nerpaIO(s.seal), sound: w.soundIO(s.seal.id), broadcast: w.broadcast })
        seals.push(s)
      }
    }
    for (const r of robots) w.read(r)
    return w
  }

  /** Every program in the world, with the id of its object. */
  programs(): { id: string; program: Program }[] {
    const out: { id: string; program: Program }[] = []
    for (const r of this.robots) if (r.program) out.push({ id: r.id, program: r.program })
    for (const s of this.seals) if (s.program) out.push({ id: s.seal.id, program: s.program })
    for (const l of this.lights) if (l.program) out.push({ id: l.id, program: l.program })
    return out
  }

  /** A key was pressed during the run (a name from `EVENT_KEYS`). */
  pressKey(key: string): boolean {
    let used = false
    for (const p of this.programs()) used = p.program.fire('key', key) || used
    return used
  }

  /** An object was clicked during the run. */
  click(id: string): void {
    // a hidden seal is not there to be clicked
    if (this.seals.some((s) => s.seal.id === id && !s.seal.visible)) return
    for (const p of this.programs()) if (p.id === id) p.program.fire('click')
  }

  /** messages sent during the run, in order (time, name) — for tests and a future message log */
  readonly messages: { t: number; name: string }[] = []

  /**
   * A message to every program on the field. The check is true once every script it started
   * is over.
   */
  readonly broadcast = (name: string): Done => {
    this.messages.push({ t: this.time, name })
    if (this.messages.length > 500) this.messages.shift()
    const dones = this.programs().map((p) => p.program.receive(name))
    return () => dones.every((d) => d())
  }

  /** A hero's sound blocks: passed on to the app's player. */
  private soundIO(source: string): SoundIO {
    return {
      play: (id, volume) => this.sounds?.play(id, volume, source),
      note: (midi, seconds, volume) => this.sounds?.note(midi, seconds, volume, source),
      stopAll: () => this.sounds?.stop()
    }
  }

  // ------------------------------------------------------------ robots

  private robotIO(r: SimRobot): RobotIO {
    return {
      setMotors: (l, rr) => {
        r.left = clampPower(l)
        r.right = clampPower(rr)
      },
      sensor: (port) => {
        // a switched flashlight shows its new state at once
        const f = r.flash.get(port)
        if (f) return f.on ? f.brightness : 0
        return r.readings.get(port) ?? NaN
      },
      flashlight: (port, on, brightness) => {
        const f = r.flash.get(port)
        if (!f) return
        if (on !== null) f.on = on
        if (brightness !== undefined) {
          f.brightness = brightness
          if (on === null) f.on = brightness > 0
        }
      }
    }
  }

  /** Where a sensor looks at the floor, in world coordinates. */
  sensorSpot(r: SimRobot, port: number): [number, number] | null {
    const pad = padOf(r.spec, port)
    if (!pad) return null
    const [lx, ly] = sensorPoint(r.spec, pad)
    const p = bodyPoint(r, lx, ly, 0)
    return [p[0], p[1]]
  }

  /** A point of the module on `pad`, in world coordinates. */
  private modulePoint(r: SimRobot, pad: PadSpec, x: number, z: number): V3 {
    const [lx, ly, lz] = padPoint(pad, x, z)
    return bodyPoint(r, lx, ly, lz)
  }

  private read(r: SimRobot): void {
    for (const s of r.sensors) {
      const pad = padOf(r.spec, s.port)
      if (!pad) continue
      r.readings.set(s.port, this.readSensor(r, pad, s.type))
    }
  }

  /** How light the bare ground is here for a line sensor: grass, sand, stone, a road, water; white elsewhere. */
  private groundLight(x: number, y: number, z: number): number {
    const s = nearestSurface(this.terrain, x, y, z)
    if (s.water) return SURFACE_LIGHT.water
    if (s.piece?.kind === 'ground') return SURFACE_LIGHT[s.piece.surface ?? 'grass']
    return 1
  }

  private readSensor(r: SimRobot, pad: PadSpec, type: RobotSensor['type']): number {
    switch (type) {
      case 'line': {
        const p = this.sensorSpot(r, pad.port)!
        // it sees the surface under it at the robot's own level (not a bridge above, not the floor below)
        const ground = this.terrain.length ? nearestSurface(this.terrain, p[0], p[1], r.z).z : undefined
        // over the edge of a platform nothing reflects the light back: it reads like black
        if (ground !== undefined && r.z - ground > LINE_DROP) return 0
        return lineSensor(this.tiles, p[0], p[1], r.spec.sensorSpot, ground, this.terrain.length ? (x, y) => this.groundLight(x, y, ground ?? 0) : undefined)
      }
      case 'ultrasonic':
        return this.sonar(r, pad)
      case 'touch': {
        if (!this.probe) return 0
        const c = this.modulePoint(r, pad, MODULE.touchX, MODULE.touchZ)
        const yaw = r.pose.theta + pad.facing
        return this.probe.touching(c, MODULE.touchHalf, yaw, r.id, (id) => !this.climbable(id, c, yaw, r), pad.facing === 0 ? r.pitch : -r.pitch) ? 1 : 0
      }
      case 'light': {
        const at = this.modulePoint(r, pad, MODULE.eyeX, MODULE.eyeZ)
        const blocked = this.probe ? occlusionFrom(this.probe, r.id) : undefined
        return lightReading(at, [0, 0, 1], this.lightSources(), blocked)
      }
      case 'flashlight': {
        const f = r.flash.get(pad.port)
        return f?.on ? f.brightness : 0
      }
    }
  }

  /** Ultrasonic: the nearest solid thing in its beam, cm (a fan of rays across the beam). */
  private sonar(r: SimRobot, pad: PadSpec): number {
    if (!this.probe) return SONAR_MAX_CM
    const from = this.modulePoint(r, pad, MODULE.sonarX, MODULE.sonarZ)
    const yaw = r.pose.theta + pad.facing
    let best = Infinity
    // on a ramp the beam tilts with the robot
    const up = pad.facing === 0 ? r.pitch : -r.pitch
    const cu = Math.cos(up)
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const a = yaw + k * SONAR_HALF_ANGLE
      const d = this.probe.ray(from, [Math.cos(a) * cu, Math.sin(a) * cu, Math.sin(up)], SONAR_MAX_CM * 10, r.id)
      if (d !== null && d < best) best = d
    }
    if (!Number.isFinite(best)) return SONAR_MAX_CM
    return Math.max(SONAR_MIN_CM, Math.min(SONAR_MAX_CM, Math.round(best / 10)))
  }

  /** Everything that gives light now: lamps, flashlights, glowing shapes. */
  lightSources(): LightSource[] {
    const out: LightSource[] = []
    for (const l of this.lights) {
      if (!l.on || l.brightness <= 0) continue
      const src: LightSource = { pos: [l.x, l.y, l.z], brightness: l.brightness, radius: LAMP_SIZE }
      if (l.kind === 'spot') {
        const c = Math.cos(l.tilt)
        src.dir = [Math.cos(l.heading) * c, Math.sin(l.heading) * c, -Math.sin(l.tilt)]
        src.cosHalf = Math.cos(l.angle / 2)
      }
      out.push(src)
    }
    for (const r of this.robots) {
      for (const [port, f] of r.flash) {
        if (!f.on || f.brightness <= 0) continue
        const pad = padOf(r.spec, port)
        if (!pad) continue
        out.push(flashSource(this.modulePoint(r, pad, MODULE.eyeX, MODULE.eyeZ), r.pose.theta + pad.facing, f.brightness))
      }
    }
    for (const s of this.shapes()) {
      if (s.glow) out.push({ pos: s.pos, brightness: GLOW_BRIGHTNESS, radius: s.radius })
    }
    return out
  }

  // ------------------------------------------------------------ seals

  /** Things of one kind with where they are and about how big (mm). */
  private things(kind: TargetKind, self?: string): { pos: V3; radius: number; id: string }[] {
    switch (kind) {
      case 'ROBOT':
        return this.robots.map((r) => {
          const [x, y] = toWorld(r.pose, r.spec.centerX, 0)
          return { id: r.id, pos: [x, y, r.z] as V3, radius: r.spec.radius }
        })
      case 'NERPA':
      case 'CHEETAH':
      case 'PIGEON': {
        const sp = kind === 'NERPA' ? 'seal' : kind === 'CHEETAH' ? 'cheetah' : 'pigeon'
        return this.seals
          .filter((s) => s.seal.id !== self && s.seal.visible && s.seal.species === sp)
          .map((s) => ({ id: s.seal.id, pos: [s.seal.x, s.seal.y, s.seal.z + s.seal.lift] as V3, radius: sealRadius(s.seal) }))
      }
      case 'LIGHT':
        return this.lights.map((l) => ({ id: l.id, pos: [l.x, l.y, l.z] as V3, radius: LAMP_SIZE }))
      case 'SHAPE':
        return this.shapes().map((s) => ({ id: s.id, pos: s.pos, radius: s.radius }))
    }
  }

  private nearest(n: SimCreature, kind: TargetKind): { pos: V3; d: number; radius: number } | null {
    let best: { pos: V3; d: number; radius: number } | null = null
    for (const t of this.things(kind, n.id)) {
      const d = Math.hypot(t.pos[0] - n.x, t.pos[1] - n.y)
      if (!best || d < best.d) best = { pos: t.pos, d, radius: t.radius }
    }
    return best
  }

  private nerpaIO(n: SimCreature): NerpaIO {
    return {
      walk: (mm) => n.walk(mm),
      turn: (rad) => n.turn(rad),
      turnTo: (rad) => n.turnTo(rad),
      face: (kind) => {
        const t = this.nearest(n, kind)
        return t ? n.face(t.pos[0], t.pos[1]) : () => true
      },
      goTo: (x, y) => this.goTo(n, x, y),
      glide: (x, y, s) => n.glide(x, y, s),
      jump: () => this.hop(n),
      stop: () => n.stopMove(),
      say: (text, s) => n.speak(text, s),
      setColor: (c) => (n.color = c),
      setVisible: (on) => (n.visible = on),
      setSize: (p) => (n.size = p),
      x: () => n.x,
      y: () => n.y,
      heading: () => n.theta,
      touching: (kind) => this.sealTouches(n, kind),
      distance: (kind) => this.nearest(n, kind)?.d ?? Infinity,
      run: (mm) => (canRun(n.profile) ? n.run(mm) : n.walk(mm)),
      crawl: (mm) => (canCrawl(n.profile) ? n.crawl(mm) : n.walk(mm)),
      leap: () => this.leap(n),
      ledgeAhead: () => this.ledgeAhead(n),
      waterAhead: () => this.waterAhead(n),
      inWater: () => n.wet,
      takeOff: (mm) => this.takeOff(n, mm),
      fly: (mm) => (canFly(n.profile) ? seq(n.flying ? null : this.takeOff(n, CRUISE), () => n.fly(mm)) : n.walk(mm)),
      flyTo: (x, y) => (canFly(n.profile) ? seq(n.flying ? null : this.takeOff(n, CRUISE), () => n.flyTo(x, y)) : () => true),
      land: () => this.land(n),
      altitude: () => (n.flying || n.climbing ? Math.max(0, n.z - this.groundUnder(n)) : 0),
      under: () => this.under(n),
      aheadKind: () => this.aheadKind(n),
      surfaceWord: (k) => RoboWorld.surfaceWords[k as SurfaceKind] ?? k
    }
  }

  // ------------------------------------------------------------ abilities

  /** a creature's body: the radius it bumps into things with and its height, mm */
  private body(n: SimCreature): { r: number; h: number } {
    const h = n.profile.height * n.k
    return { r: n.profile.rim * n.k, h: n.crouched ? h * (n.profile.crouch ?? 1) : h }
  }

  /** Is there room over a crouched creature to stand up (nothing low over its body)? */
  private roomToStand(n: SimCreature): boolean {
    return this.headroom(n, n.profile.height * n.k)
  }

  /**
   * Is nothing solid over a creature up to `h` mm above its feet (its middle and its rim)? On a
   * slope a rim point may be as much higher as the slope rises there (like `stance`).
   */
  private headroom(n: SimCreature, h: number): boolean {
    if (!this.terrain.length) return true
    const r = n.profile.rim * n.k * 0.92
    for (let i = 0; i <= 12; i++) {
      const a = (i * Math.PI) / 6
      const d = i === 12 ? 0 : r
      if (wallAt(this.terrain, n.x + d * Math.cos(a), n.y + d * Math.sin(a), n.z, h, CLIMB * d)) return false
    }
    return true
  }

  /**
   * The ground under a creature: the highest surface at or below its feet (a bridge deck over a
   * pigeon is not its ground), mm. Inside something solid (put there by "go to"): its top.
   */
  private groundUnder(n: SimCreature): number {
    if (!this.terrain.length) return 0
    return supportHit(this.terrain, n.x, n.y, n.z)?.z ?? topSurface(this.terrain, n.x, n.y)
  }

  /** Scenery that can be stood on: rocks (trees and bushes only take perching birds). */
  private standable(): PlacedTerrain[] {
    return this.terrain.filter((t) => t.kind !== 'post' || t.decor === 'rock')
  }

  /**
   * "Go to": be there at once, on the surface there nearest to the height it was at (under a
   * bridge it stays under it). One who cannot swim does not go into water: it says so instead.
   */
  private goTo(n: SimCreature, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (this.terrain.length && !n.flying && !canSwim(n.profile) && nearestSurface(this.standable(), x, y, n.z).water) {
      n.speak(RoboWorld.waterSay, 1.5)
      return
    }
    n.goTo(x, y)
  }

  /** A hop on the spot, if there is room over it (not crouched under something low). */
  private hop(n: SimCreature): Done {
    if (n.crouched || !this.headroom(n, this.body(n).h + JUMP_HEIGHT)) return () => true
    return n.jump()
  }

  /** A point just ahead of the creature's nose. */
  private ahead(n: SimCreature): [number, number] {
    const d = (n.profile.length * n.k) / 2 + 40
    return [n.x + d * Math.cos(n.theta), n.y + d * Math.sin(n.theta)]
  }

  /** What a creature stands on (in the air: flying, jumping or falling high enough over the ground). */
  under(n: SimCreature): SurfaceKind {
    if (n.leaping || n.z - this.groundUnder(n) > IN_AIR) return 'air'
    return surfaceAt(this.terrain, this.tiles, n.x, n.y, n.z)
  }

  /** What is right in front of a creature: where it would step (a flier: what is below there). */
  aheadKind(n: SimCreature): SurfaceKind {
    const [x, y] = this.ahead(n)
    if (n.flying) return topSurfaceAt(this.terrain, this.tiles, x, y)
    return surfaceAt(this.terrain, this.tiles, x, y, n.z)
  }

  /** "ledge ahead?": something higher than a step right in front (a platform side, a ramp's side). */
  private ledgeAhead(n: SimCreature): boolean {
    const [x, y] = this.ahead(n)
    const pieces = this.terrain.filter((t) => t.kind !== 'post')
    return wallAt(pieces, x, y, n.z, this.body(n).h)
  }

  /** "water ahead?": water right in front (for a flier: water anywhere below that point). */
  private waterAhead(n: SimCreature): boolean {
    if (!this.terrain.length) return false
    const [x, y] = this.ahead(n)
    if (n.flying) {
      const s = surfacesAt(this.terrain, x, y)
      return !!s[s.length - 1]?.water
    }
    return wetAt(this.terrain, x, y, n.z)
  }

  /**
   * The cheetah's jump: one cell forward onto whatever is there, up to its jump height (a
   * platform with no ramp, a rock), or down. Into water, at a wall too high or where there is no
   * room it only jumps up on the spot.
   */
  private leap(n: SimCreature): Done {
    const p = n.profile
    if (!canLeap(p)) return this.hop(n)
    // crouched under something low: no room to jump
    if (n.crouched) return () => true
    const L = p.leap
    const x1 = n.x + L * Math.cos(n.theta)
    const y1 = n.y + L * Math.sin(n.theta)
    const { r, h } = this.body(n)
    // on the spot: up its arc, if there is room over it
    const spot = () => (this.headroom(n, h + leapTop(0, n.k)) ? n.leap(n.x, n.y, n.z) : () => true)
    if (!this.terrain.length) return n.leap(x1, y1, 0)
    const reach = n.z + p.jumpUp * n.k
    // what it lands on: the highest surface there within its jump
    const land = supportHit(this.terrain, x1, y1, reach - STEP)
    if (!land || land.water) return spot()
    // nothing on the way into its body as it flies along its arc (over what is lower it jumps)
    const top = leapTop(land.z - n.z, n.k)
    for (let i = 1; i < 8; i++) {
      const q = i / 8
      const px = n.x + (x1 - n.x) * q
      const py = n.y + (y1 - n.y) * q
      const z = n.z + (land.z - n.z) * q + 4 * top * q * (1 - q)
      if (wallAt(this.terrain, px, py, z - STEP, h + STEP)) return spot()
    }
    // room to stand where it lands
    if (stance(this.terrain, x1, y1, n.theta, land.z, r, h).blocked) return spot()
    return n.leap(x1, y1, land.z)
  }

  /** Take off to `mm` above the ground under it (a pigeon); the others hop. */
  private takeOff(n: SimCreature, mm: number): Done {
    if (!canFly(n.profile)) return this.hop(n)
    const g = this.groundUnder(n)
    const z = Math.min(CEILING, g + Math.max(50, Number.isFinite(mm) ? mm : CRUISE))
    return n.flying ? n.climbTo(z) : n.takeOff(z)
  }

  /** Come down onto the ground below; over water it stays in the air and says so. */
  private land(n: SimCreature): Done {
    if (!n.flying) return () => true
    if (this.terrain.length && supportHit(this.terrain, n.x, n.y, n.z)?.water) return n.speak(RoboWorld.waterSay, 1.5)
    return n.landOn(this.groundUnder(n))
  }

  /**
   * Is terrain piece `id`, where the touch sensor's bumper (centre `c`, facing `yaw`) meets it,
   * low enough for the robot to drive onto (the foot of a ramp)? Then the bumper does not press.
   */
  private climbable(id: string, c: V3, yaw: number, r: SimRobot): boolean {
    const t = this.terrain.find((p) => p.id === id)
    if (!t) return false
    const [hx, hy] = MODULE.touchHalf
    const cs = Math.cos(yaw)
    const sn = Math.sin(yaw)
    let top: number | null = null
    for (const [fx, fy] of [[0, 0], [hx, hy], [hx, -hy], [-hx, hy], [-hx, -hy]]) {
      const h = topAt(t, c[0] + cs * fx - sn * fy, c[1] + sn * fx + cs * fy)
      if (h !== null && (top === null || h > top)) top = h
    }
    // platforms and bridges have upright sides; only a ramp's slope can be higher ahead
    const reach = t.kind === 'ramp' ? CLIMB * (Math.hypot(c[0] - r.pose.x, c[1] - r.pose.y) + hx) : 0
    return top !== null && top <= r.z + STEP + reach
  }

  private sealTouches(n: SimCreature, kind: TargetKind): boolean {
    if (!n.visible) return false
    if (kind === 'SHAPE') {
      if (!this.probe) return false
      const k = n.k
      const p = n.profile
      const others = new Set([...this.robots.map((r) => r.id), ...this.seals.map((s) => s.seal.id)])
      return this.probe.touching(
        [n.x, n.y, n.z + n.lift + (p.height * k) / 2],
        [(p.length * k) / 2 + 3, (p.width * k) / 2 + 3, (p.height * k) / 2],
        n.theta,
        n.id,
        (id) => !others.has(id)
      )
    }
    const me = sealRadius(n)
    return this.things(kind, n.id).some((t) => Math.hypot(t.pos[0] - n.x, t.pos[1] - n.y) < me + t.radius)
  }

  // ------------------------------------------------------------ time

  /** One physics step (PHYS_DT); programs tick on every other step. */
  step(): void {
    if (this.steps % Math.round(PROGRAM_DT / PHYS_DT) === 0) {
      for (const r of this.robots) this.read(r)
      for (const p of this.programs()) p.program.tick(PROGRAM_DT)
    }
    for (const r of this.robots) {
      const s = r.spec
      const next = drive(r.pose, wheelSpeed(r.left, s.maxSpeed), wheelSpeed(r.right, s.maxSpeed), s.track, PHYS_DT)
      this.moveOnTerrain(r, next)
    }
    this.steps++
    this.time = this.steps * PHYS_DT
    for (const s of this.seals) this.stepSeal(s.seal)
  }

  /** Drive to `next` over the terrain: climb ramps, stop at walls, fall off edges. */
  private moveOnTerrain(r: SimRobot, next: Pose): void {
    const s = r.spec
    const st = stance(this.terrain, next.x, next.y, next.theta, r.z, s.radius, s.height, s.centerX, r.pose)
    if (st.blocked) {
      // it stays where it is (a wall ahead) but still falls or stands where it is
      const here = stance(this.terrain, r.pose.x, r.pose.y, r.pose.theta, r.z, s.radius, s.height, s.centerX, r.pose)
      if (!here.blocked) this.settle(r, here)
      return
    }
    r.pose = next
    this.settle(r, st)
  }

  /** Stand on the ground the stance found, or fall toward it. */
  private settle(b: { z: number; vz: number; pitch: number; roll: number }, st: { z: number; pitch: number; roll: number; falling: boolean }): void {
    if (st.falling) {
      b.vz -= GRAVITY * PHYS_DT
      b.z = Math.max(st.z, b.z + b.vz * PHYS_DT)
      if (b.z <= st.z) b.vz = 0
      return
    }
    b.vz = 0
    b.z = st.z
    b.pitch = st.pitch
    b.roll = st.roll
  }

  /**
   * A creature moves as its program says; the terrain stops it at walls (and at water if it
   * cannot swim), carries it up ramps and lets it fall off edges (a flier glides down). In the
   * air a flier passes over everything lower than it; jumps and take-offs move it themselves.
   */
  private stepSeal(n: SimCreature): void {
    const prev = { x: n.x, y: n.y, theta: n.theta }
    if (!this.terrain.length) {
      n.step(this.time)
      if (n.teleported && !n.flying) n.z = 0
      n.teleported = false
      if (!n.flying && !n.leaping && n.z > 0) this.fall(n, { z: 0, falling: true } as Stance)
      return
    }
    const { r, h } = this.body(n)
    // "go to" moved it this tick: onto the surface there nearest to its height (a flier stays as
    // high, above whatever is under it)
    if (n.teleported) {
      n.teleported = false
      n.z = n.flying ? Math.max(n.z, this.groundUnder(n)) : nearestSurface(this.standable(), n.x, n.y, n.z).z
      n.vz = 0
    }
    n.step(this.time)
    if (n.leaping) return
    // crouched and done crawling: up again as soon as there is room
    if (n.crouched && !n.crawling && this.roomToStand(n)) n.crouched = false
    if (n.flying || n.climbing) {
      // in the air: only things reaching up to it are in the way
      let blocked = false
      for (let i = 0; i < 12 && !blocked; i++) {
        const a = (i * Math.PI) / 6
        const px = n.x + r * Math.cos(n.theta + a)
        const py = n.y + r * Math.sin(n.theta + a)
        blocked = wallAt(this.terrain, px, py, n.z - STEP, h)
      }
      if (blocked) {
        n.x = prev.x
        n.y = prev.y
        n.halt()
        // straight up or down into something: stop there
        if (wallAt(this.terrain, n.x, n.y, n.z - STEP, h)) n.haltClimb()
      }
      // never below the ground under it
      const g = this.groundUnder(n)
      if (n.z < g) n.z = g
      n.wet = false
      n.pitch = 0
      n.roll = 0
      return
    }
    const swim = canSwim(n.profile)
    const st = stance(this.terrain, n.x, n.y, n.theta, n.z, r, h, 0, prev, swim)
    if (st.blocked) {
      // it bumps into the wall (or the water's edge) and stops there, still falling or standing
      n.x = prev.x
      n.y = prev.y
      n.halt()
      const here = stance(this.terrain, n.x, n.y, n.theta, n.z, r, h, 0, prev, swim)
      if (!here.blocked) {
        this.fall(n, here)
        n.wet = !!here.wet && swim
      }
      return
    }
    this.fall(n, st)
    n.wet = !!st.wet && swim
  }

  /** Stand where the stance says, or fall toward it (a flier glides down slowly). */
  private fall(n: SimCreature, st: Stance): void {
    if (st.falling && canFly(n.profile)) {
      n.vz = Math.max(-GLIDE_DOWN, n.vz - GRAVITY * PHYS_DT)
      n.z = Math.max(st.z, n.z + n.vz * PHYS_DT)
      if (n.z <= st.z) n.vz = 0
      return
    }
    this.settle(n, st)
  }

  /** Run for `seconds` of simulated time (tests). */
  run(seconds: number, each?: (w: RoboWorld) => void): void {
    const n = Math.round(seconds / PHYS_DT)
    for (let i = 0; i < n; i++) {
      this.step()
      each?.(this)
    }
  }

  /** Read the sensors now (after moving things by hand, or when a probe was set). */
  refresh(): void {
    for (const r of this.robots) this.read(r)
  }
}

/** a line sensor this high (mm) over the surface below it sees nothing (over a platform's edge) */
export const LINE_DROP = 45

/** The flashlight's beam: out along the pad, a little up, 60° wide. */
export const FLASH_UP = 15 * DEG
export const FLASH_HALF = 30 * DEG
export function flashSource(pos: V3, yaw: number, brightness: number): LightSource {
  const c = Math.cos(FLASH_UP)
  return { pos, brightness, dir: [Math.cos(yaw) * c, Math.sin(yaw) * c, Math.sin(FLASH_UP)], cosHalf: Math.cos(FLASH_HALF), radius: 6 }
}

/** A creature as a circle on the floor (for touching). */
export const sealRadius = (n: SimCreature) => n.profile.length * 0.42 * n.k

/** Waits for `first` (if any), then starts `next` and waits for it. */
function seq(first: Done | null, next: () => Done): Done {
  let second: Done | null = null
  return () => {
    if (first && !first()) return false
    second ??= next()
    return second()
  }
}

function lampIO(l: SimLight): LampIO {
  return {
    setOn: (on) => (l.on = on),
    setBrightness: (b) => {
      l.brightness = b
    },
    setColor: (c) => (l.color = c)
  }
}

const clampPower = (v: number) => (Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0)

/** A point of the robot's body (robot frame, mm) in the world, with the robot's lean. */
export function bodyPoint(r: SimRobot, lx: number, ly: number, lz: number): V3 {
  // roll around the robot's X (left side up), then pitch around its Y (nose up), then heading
  const cr = Math.cos(r.roll)
  const sr = Math.sin(r.roll)
  const y1 = ly * cr - lz * sr
  const z1 = ly * sr + lz * cr
  const cp = Math.cos(r.pitch)
  const sp = Math.sin(r.pitch)
  const x2 = lx * cp - z1 * sp
  const z2 = lx * sp + z1 * cp
  const [wx, wy] = toWorld(r.pose, x2, y1)
  return [wx, wy, r.z + z2]
}
