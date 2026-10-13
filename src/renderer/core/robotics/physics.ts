/**
 * Real physics for the shapes on the field (Rapier): they fall onto the floor, topple and get
 * pushed by robots. Robots themselves drive exactly as their motors say (kinematic bodies), so
 * a program always behaves the same way.
 *
 * Rapier works in metres and kilograms; the rest of the app in millimetres and grams.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { ShapeSpot, SimRobot, SimSeal } from './world'
import type { Probe } from './probe'
import type { V3 } from './lighting'
import type { Profile } from './creatures'
import { BRIDGE_DECK, type PlacedTerrain, WATER_FLOOR, halfSize } from './terrain'
import { bodyQuat } from './lean'

const MM = 0.001
/** gap under the robot's body, mm */
const CLEARANCE = 5
/** density of PLA plastic, g/mm³ (used when a shape has no weight set) */
export const PLA_DENSITY = 1.24e-3

let ready: Promise<void> | null = null
/** Load the physics engine (WebAssembly) once. */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init()
  return ready
}

export interface ShapeBody {
  id: string
  /** vertices in world coordinates, mm */
  points: Float32Array
  /** grams */
  mass: number
  /** glowing material: light sensors see it as a lamp */
  glow?: boolean
}

interface Dyn {
  id: string
  body: RAPIER.RigidBody
  /** where the body started (its centre), mm */
  start: Vector3
  /** half the diagonal of its bounding box, mm */
  radius: number
  glow: boolean
}

/**
 * Physics of a run, and the answers to the sensors' questions about solid things (`Probe`):
 * the robot bodies, the seals and the shapes can be hit by the ultrasonic ray or press a touch
 * button; the floor cannot.
 */
export class Physics implements Probe {
  private world: RAPIER.World
  private dyn: Dyn[] = []
  private robots = new Map<string, RAPIER.RigidBody>()
  private seals = new Map<string, { body: RAPIER.RigidBody; collider: RAPIER.Collider; size: number }>()
  /** collider handle → node id */
  private owner = new Map<number, string>()
  private floorHandle: number

  /** `initPhysics()` must have finished. */
  constructor(shapes: ShapeBody[], robots: SimRobot[], seals: SimSeal[] = [], terrain: PlacedTerrain[] = []) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: -9.81 })
    // the floor: a thick slab whose top is z = 0
    const floor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, -0.5))
    this.floorHandle = this.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 100, 0.5).setFriction(0.7), floor).handle

    // platforms, ramps and bridges: fixed; shapes stand on them and fall off them, the sonar sees them
    for (const t of terrain) {
      // a piece built on another (or scenery on a platform) stands at its base
      const base = t.base ?? 0
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(t.x * MM, t.y * MM, base * MM).setRotation(zQuat(t.angle)))
      const [hx, hy] = halfSize(t)
      let desc: RAPIER.ColliderDesc | null
      if (t.kind === 'post') {
        // scenery: an upright cylinder (Rapier's stand along Y)
        const r = t.radius ?? 0
        desc = RAPIER.ColliderDesc.cylinder((t.height / 2) * MM, r * MM)
          .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })
          .setTranslation(0, 0, (t.height / 2) * MM)
      } else if (t.kind === 'ramp') {
        const h = t.height
        const pts = [-hx, -hy, 0, hx, -hy, 0, -hx, hy, 0, hx, hy, 0, -hx, hy, h, hx, hy, h].map((v) => v * MM)
        desc = RAPIER.ColliderDesc.convexHull(new Float32Array(pts))
      } else {
        // a pool is solid only up to its bottom (shapes sink to it)
        const bottom = t.kind === 'bridge' ? t.height - BRIDGE_DECK : 0
        const top = t.kind === 'water' ? WATER_FLOOR : t.height
        desc = RAPIER.ColliderDesc.cuboid(hx * MM, hy * MM, ((top - bottom) / 2) * MM).setTranslation(0, 0, ((top + bottom) / 2) * MM)
      }
      if (!desc) continue
      this.owner.set(this.world.createCollider(desc.setFriction(0.7), body).handle, t.id)
    }

    for (const s of shapes) {
      if (s.points.length < 12) continue
      const c = centroid(s.points)
      const local = new Float32Array(s.points.length)
      for (let i = 0; i < s.points.length; i += 3) {
        local[i] = (s.points[i] - c.x) * MM
        local[i + 1] = (s.points[i + 1] - c.y) * MM
        local[i + 2] = (s.points[i + 2] - c.z) * MM
      }
      const desc = RAPIER.ColliderDesc.convexHull(local)
      if (!desc) continue
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x * MM, c.y * MM, c.z * MM).setCcdEnabled(true)
          // a sleeping body is not woken by a kinematic robot driving into it
          .setCanSleep(false)
      )
      const col = this.world.createCollider(desc.setMass(Math.max(0.1, s.mass) / 1000).setFriction(0.6).setRestitution(0.1), body)
      this.owner.set(col.handle, s.id)
      this.dyn.push({ id: s.id, body, start: c, radius: halfDiagonal(s.points), glow: !!s.glow })
    }

    for (const r of robots) {
      const s = r.spec
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(r.pose.x * MM, r.pose.y * MM, r.z * MM)
          .setRotation(bodyQuat(r.pose.theta, r.pitch, r.roll))
      )
      // the body clears the floor by a few mm (only the wheels touch it);
      // Rapier cylinders stand along Y: turn it upright
      const h = s.height - CLEARANCE
      const desc = RAPIER.ColliderDesc.cylinder((h / 2) * MM, s.radius * MM)
        .setTranslation(s.centerX * MM, 0, (CLEARANCE + h / 2) * MM)
        .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })
        .setFriction(0.4)
      this.owner.set(this.world.createCollider(desc, body).handle, r.id)
      this.robots.set(r.id, body)
    }

    for (const { seal } of seals) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(seal.x * MM, seal.y * MM, seal.z * MM).setRotation(zQuat(seal.theta))
      )
      const collider = this.sealCollider(body, seal.id, seal.size, seal.profile)
      this.seals.set(seal.id, { body, collider, size: seal.size })
    }

    // Rapier builds what ray casts and shape queries search only inside a step: take a
    // vanishingly short one, so the sensors see the field from the very first program tick
    this.world.timestep = 1e-6
    this.world.step()
  }

  /** A character's body: a capsule lying along its length, scaled with its size (percent). */
  private sealCollider(body: RAPIER.RigidBody, id: string, size: number, p: Profile): RAPIER.Collider {
    const k = Math.max(0.1, size / 100)
    const r = (p.width / 2) * k
    const half = Math.max(1, (p.length / 2) * k - r)
    // Rapier capsules stand along Y: turn it to X
    const desc = RAPIER.ColliderDesc.capsule(half * MM, r * MM)
      .setTranslation(0, 0, ((p.height / 2) * k) * MM)
      .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
      .setFriction(0.4)
    const collider = this.world.createCollider(desc, body)
    this.owner.set(collider.handle, id)
    return collider
  }

  /** Move robots and seals to their new poses and advance the world by `dt` seconds. */
  step(dt: number, robots: SimRobot[], seals: SimSeal[] = []): void {
    for (const r of robots) {
      const b = this.robots.get(r.id)
      if (!b) continue
      b.setNextKinematicTranslation({ x: r.pose.x * MM, y: r.pose.y * MM, z: r.z * MM })
      b.setNextKinematicRotation(bodyQuat(r.pose.theta, r.pitch, r.roll))
    }
    for (const { seal } of seals) {
      const s = this.seals.get(seal.id)
      if (!s) continue
      s.body.setNextKinematicTranslation({ x: seal.x * MM, y: seal.y * MM, z: (seal.z + seal.lift) * MM })
      s.body.setNextKinematicRotation(bodyQuat(seal.theta, seal.pitch, seal.roll))
      if (s.size !== seal.size) {
        // resized by a block: a new capsule of the new size
        this.owner.delete(s.collider.handle)
        this.world.removeCollider(s.collider, false)
        s.collider = this.sealCollider(s.body, seal.id, seal.size, seal.profile)
        s.size = seal.size
      }
      // a hidden seal is not there for anything
      if (s.collider.isEnabled() !== seal.visible) s.collider.setEnabled(seal.visible)
    }
    this.world.timestep = dt
    this.world.step()
  }

  // ------------------------------------------------------------ Probe

  private skip(exclude?: string) {
    return (c: RAPIER.Collider) => c.handle !== this.floorHandle && this.owner.get(c.handle) !== exclude
  }

  ray(from: V3, dir: V3, max: number, exclude?: string): number | null {
    const ray = new RAPIER.Ray({ x: from[0] * MM, y: from[1] * MM, z: from[2] * MM }, { x: dir[0], y: dir[1], z: dir[2] })
    const hit = this.world.castRay(ray, max * MM, true, undefined, undefined, undefined, undefined, this.skip(exclude))
    return hit ? hit.timeOfImpact / MM : null
  }

  touching(center: V3, half: V3, yaw: number, exclude?: string, only?: (id: string) => boolean, pitch = 0): boolean {
    const shape = new RAPIER.Cuboid(half[0] * MM, half[1] * MM, half[2] * MM)
    const skip = this.skip(exclude)
    const hit = this.world.intersectionWithShape(
      { x: center[0] * MM, y: center[1] * MM, z: center[2] * MM },
      bodyQuat(yaw, pitch, 0),
      shape,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => skip(c) && (!only || only(this.owner.get(c.handle) ?? ''))
    )
    return hit !== null
  }

  /** The shapes where they are now. */
  shapes(): ShapeSpot[] {
    return this.dyn.map((d) => {
      const t = d.body.translation()
      return { id: d.id, pos: [t.x / MM, t.y / MM, t.z / MM] as V3, radius: d.radius, glow: d.glow }
    })
  }

  /**
   * How far each shape has moved since the start, as a world matrix to put in front of its
   * document transform: world = delta · original.
   */
  deltas(): Map<string, Matrix4> {
    const out = new Map<string, Matrix4>()
    for (const d of this.dyn) {
      const t = d.body.translation()
      const q = d.body.rotation()
      const m = new Matrix4().compose(
        new Vector3(t.x / MM, t.y / MM, t.z / MM),
        new Quaternion(q.x, q.y, q.z, q.w),
        new Vector3(1, 1, 1)
      )
      out.set(d.id, m.multiply(new Matrix4().makeTranslation(-d.start.x, -d.start.y, -d.start.z)))
    }
    return out
  }

  /** Centre of a shape now, mm (tests). */
  position(id: string): Vector3 | null {
    const d = this.dyn.find((x) => x.id === id)
    if (!d) return null
    const t = d.body.translation()
    return new Vector3(t.x / MM, t.y / MM, t.z / MM)
  }

  dispose(): void {
    this.world.free()
  }
}

function centroid(p: Float32Array): Vector3 {
  // centre of the bounding box: stable and good enough for a body origin
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k])
      max[k] = Math.max(max[k], p[i + k])
    }
  }
  return new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
}

function halfDiagonal(p: Float32Array): number {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k])
      max[k] = Math.max(max[k], p[i + k])
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2
}

const zQuat = (theta: number) => ({ x: 0, y: 0, z: Math.sin(theta / 2), w: Math.cos(theta / 2) })

