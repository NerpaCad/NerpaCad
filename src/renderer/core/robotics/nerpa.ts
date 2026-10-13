/**
 * The characters of the field — the seal Нерпа, the cheetah Читик and the pigeon Геннадий —
 * programmed like Scratch sprites. They walk, turn, say things and change their look; each can
 * also do what its species can (creatures.ts): the seal swims, the cheetah runs and jumps onto
 * ledges, the pigeon flies. Moves take time and the block waits for them, so a program reads like
 * a story. Coordinates in blocks are centimetres; inside, mm.
 *
 * This class only moves the character as its program says; the world (world.ts) holds it to the
 * terrain: walls, water, edges, ramps, landing places.
 *
 * Frame of a character: origin on the ground under its middle, X forward (its nose), Z up.
 */
import type { Species } from '../doc/model'
import { CLIMB_SPEED, LEAP_TIME, type Profile, PROFILES } from './creatures'

/** the seal's body at 100 % size, mm (older code and the 3D stand-in use these) */
export const NERPA_LENGTH = PROFILES.seal.length
export const NERPA_WIDTH = PROFILES.seal.width
export const NERPA_HEIGHT = PROFILES.seal.height
/** the seal's walking pace, mm/s, and turning speed, rad/s */
export const NERPA_SPEED = PROFILES.seal.walk
export const NERPA_TURN = PROFILES.seal.turn
/** the seal's hop on the spot: how long and how high */
export const JUMP_TIME = 0.6
export const JUMP_HEIGHT = 90
/** how high a jump forward rises over the straight line between its ends (`dz` up or down), mm */
export const leapTop = (dz: number, k = 1) => Math.abs(dz) * 0.5 + 60 * k

/**
 * What a creature's model shows. `takeoff`: rising from the ground; `land`: coming down;
 * `touchdown`: the last bit of coming down (the pigeon puts its legs out and brakes).
 */
export type NerpaAnim = 'idle' | 'walk' | 'run' | 'swim' | 'leap' | 'fly' | 'takeoff' | 'land' | 'touchdown' | 'fall' | 'crouch' | 'crawl'

/** the last mm of a landing shown as touching down */
export const TOUCHDOWN = 180

/** Block maths can overflow to ±Infinity or NaN: such a number moves nothing. */
const fin = (v: number) => (Number.isFinite(v) ? v : 0)

type Gait = 'walk' | 'run' | 'fly' | 'crawl'

type Motion =
  /** along its heading at the pace of its gait, `left` mm still to go (dir: 1 forward, −1 back) */
  | { kind: 'move'; left: number; dir: 1 | -1; gait: Gait; token: number }
  | { kind: 'glide'; x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; token: number }
  | { kind: 'turn'; from: number; to: number; t0: number; dur: number; token: number }
  /** a jump forward along an arc from one surface to another (`top`: the arc over the straight line) */
  | { kind: 'leap'; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; top: number; t0: number; dur: number; token: number }
  /** straight up or down to height `z` (taking off, landing); `land`: on the ground at the end */
  | { kind: 'climb'; z: number; land: boolean; ground?: boolean; token: number }

type MotionSpec = Motion extends infer T ? (T extends Motion ? Omit<T, 'token'> : never) : never

export class SimCreature {
  x: number
  y: number
  /** heading, radians (0 = world +X) */
  theta: number
  /** lift above the ground while hopping, mm */
  lift = 0
  /** height of its feet: the ground it stands on, or where it flies, mm */
  z = 0
  /** falling off an edge, mm/s */
  vz = 0
  /** it is in water (swimming) */
  wet = false
  /** it is in the air by its own wings (the pigeon) */
  flying = false
  /**
   * crouched low (the cheetah crawling): lower and slower; it stays so while there is no room
   * over it to stand up (the world stands it up)
   */
  crouched = false
  /** it was just put somewhere with "go to" (the world lands it on the surface there) */
  teleported = false
  /** how it leans on a ramp (radians) */
  pitch = 0
  roll = 0
  visible = true
  color: string
  /** 10…300 % */
  size = 100
  say: string | null = null
  private sayUntil: number | null = null
  private sayToken = 0
  private motion: Motion | null = null
  private hopT0: number | null = null
  private token = 0
  /** time of the world, s (set by `step`) */
  private now = 0

  constructor(
    readonly id: string,
    x: number,
    y: number,
    theta: number,
    color: string,
    readonly profile: Profile = PROFILES.seal
  ) {
    this.x = x
    this.y = y
    this.theta = theta
    this.color = color
  }

  get species(): Species {
    return this.profile.species
  }

  /** the size factor (1 at 100 %) */
  get k(): number {
    return Math.max(0.1, this.size / 100)
  }

  get anim(): NerpaAnim {
    const m = this.motion
    if (m?.kind === 'leap') return 'leap'
    if (m?.kind === 'climb') {
      if (m.land) return this.z - m.z < TOUCHDOWN ? 'touchdown' : 'land'
      return m.ground ? 'takeoff' : 'fly'
    }
    if (this.flying) return 'fly'
    if (this.vz < -60) return 'fall'
    if (m?.kind === 'glide') return 'swim'
    if (this.crouched) return m?.kind === 'move' || m?.kind === 'turn' ? 'crawl' : 'crouch'
    if (m?.kind === 'move') return m.gait === 'run' ? 'run' : this.wet ? 'swim' : 'walk'
    if (m?.kind === 'turn') return this.wet ? 'swim' : 'walk'
    return this.wet ? 'swim' : 'idle'
  }

  /** in the middle of a "crawl" move (it stays crouched until it is over) */
  get crawling(): boolean {
    return this.motion?.kind === 'move' && this.motion.gait === 'crawl'
  }

  /** hopping on the spot (the seal's jump) */
  get jumping(): boolean {
    return this.hopT0 !== null
  }

  /** in the middle of a jump forward (the world leaves its height to it) */
  get leaping(): boolean {
    return this.motion?.kind === 'leap'
  }

  /** going straight up or down (the world leaves its height to it) */
  get climbing(): boolean {
    return this.motion?.kind === 'climb'
  }

  /** The pace of a gait now, mm/s (the seal is quicker in water). */
  private pace(g: Gait): number {
    const p = this.profile
    if (g === 'fly' || this.flying) return p.fly ?? p.walk
    // crouched it cannot run: it crawls whatever it was told
    if (g === 'crawl' || this.crouched) return p.crawl ?? p.walk
    if (g === 'run') return p.run ?? p.walk
    return this.wet && p.swim ? p.swim : p.walk
  }

  /** Advance to world time `t` (seconds). */
  step(t: number): void {
    const dt = Math.max(0, t - this.now)
    this.now = t
    const m = this.motion
    if (m) {
      if (m.kind === 'move') {
        const d = Math.min(m.left, this.pace(m.gait) * dt)
        this.x += m.dir * d * Math.cos(this.theta)
        this.y += m.dir * d * Math.sin(this.theta)
        m.left -= d
        if (m.left <= 1e-9) this.motion = null
      } else if (m.kind === 'climb') {
        const d = CLIMB_SPEED * dt
        this.z = m.z > this.z ? Math.min(m.z, this.z + d) : Math.max(m.z, this.z - d)
        if (Math.abs(this.z - m.z) < 1e-9) {
          if (m.land) this.flying = false
          this.motion = null
        }
      } else {
        const k = m.dur > 0 ? Math.min(1, (t - m.t0) / m.dur) : 1
        if (m.kind === 'turn') this.theta = m.from + (m.to - m.from) * k
        else {
          this.x = m.x0 + (m.x1 - m.x0) * k
          this.y = m.y0 + (m.y1 - m.y0) * k
        }
        if (m.kind === 'leap') {
          // from one surface to the other, along an arc `top` mm high over the straight line
          this.z = m.z0 + (m.z1 - m.z0) * k + 4 * m.top * k * (1 - k)
          if (k >= 1) {
            this.z = m.z1
            this.vz = 0
          }
        }
        if (k >= 1) this.motion = null
      }
    }
    if (this.hopT0 !== null) {
      const k = (t - this.hopT0) / JUMP_TIME
      if (k >= 1) {
        this.hopT0 = null
        this.lift = 0
      } else this.lift = 4 * JUMP_HEIGHT * k * (1 - k)
    }
    if (this.sayUntil !== null && t >= this.sayUntil - 1e-9) {
      this.say = null
      this.sayUntil = null
    }
  }

  /** A new move replaces the one going on; the returned check is true once this move is over. */
  private start(m: MotionSpec): () => boolean {
    const token = ++this.token
    this.motion = { ...m, token } as Motion
    return () => this.motion?.token !== token
  }

  /** Walk `mm` forward (negative: backward); swims in water, flies in the air. */
  walk(mm: number): () => boolean {
    mm = fin(mm)
    return this.start({ kind: 'move', left: Math.abs(mm), dir: mm < 0 ? -1 : 1, gait: this.flying ? 'fly' : 'walk' })
  }

  /** Crawl `mm` forward crouched (the cheetah; the others walk). */
  crawl(mm: number): () => boolean {
    mm = fin(mm)
    if (this.profile.crouch !== undefined && !this.flying) this.crouched = true
    return this.start({ kind: 'move', left: Math.abs(mm), dir: mm < 0 ? -1 : 1, gait: this.crouched ? 'crawl' : 'walk' })
  }

  /** Run `mm` forward (the cheetah; the others walk). */
  run(mm: number): () => boolean {
    mm = fin(mm)
    return this.start({ kind: 'move', left: Math.abs(mm), dir: mm < 0 ? -1 : 1, gait: this.profile.run ? 'run' : 'walk' })
  }

  /** Fly `mm` forward at its height (it must be in the air). */
  fly(mm: number): () => boolean {
    mm = fin(mm)
    return this.start({ kind: 'move', left: Math.abs(mm), dir: mm < 0 ? -1 : 1, gait: 'fly' })
  }

  /** Face a point and fly (or walk) straight to it. */
  flyTo(x: number, y: number): () => boolean {
    x = fin(x)
    y = fin(y)
    const d = Math.hypot(x - this.x, y - this.y)
    if (d < 1e-6) return () => true
    this.theta = Math.atan2(y - this.y, x - this.x)
    return this.start({ kind: 'move', left: d, dir: 1, gait: 'fly' })
  }

  /** Up into the air to height `z` (feet, mm). */
  takeOff(z: number): () => boolean {
    const ground = !this.flying
    this.flying = true
    this.vz = 0
    return this.start({ kind: 'climb', z: Math.max(this.z, fin(z)), land: false, ground })
  }

  /** Change height in the air to `z`. */
  climbTo(z: number): () => boolean {
    return this.start({ kind: 'climb', z: fin(z), land: false })
  }

  /** Come down to the ground at height `z` and stand there. */
  landOn(z: number): () => boolean {
    return this.start({ kind: 'climb', z: Math.min(this.z, fin(z)), land: true })
  }

  /** Jump forward along an arc to (x, y), landing at height `z` (the world found that place). */
  leap(x: number, y: number, z: number): () => boolean {
    const top = leapTop(z - this.z, this.k)
    return this.start({ kind: 'leap', x0: this.x, y0: this.y, z0: this.z, x1: x, y1: y, z1: z, top, t0: this.now, dur: LEAP_TIME })
  }

  /** Turn by `rad` (positive: to the left, counter-clockwise). */
  turn(rad: number): () => boolean {
    rad = fin(rad)
    return this.start({ kind: 'turn', from: this.theta, to: this.theta + rad, t0: this.now, dur: Math.abs(rad) / this.profile.turn })
  }

  /** Turn to face the heading `rad` the short way round. */
  turnTo(rad: number): () => boolean {
    let d = (fin(rad) - this.theta) % (2 * Math.PI)
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    return this.turn(d)
  }

  /** Turn toward a point of the floor. */
  face(x: number, y: number): () => boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return () => true
    if (Math.hypot(x - this.x, y - this.y) < 1e-6) return () => true
    return this.turnTo(Math.atan2(y - this.y, x - this.x))
  }

  /** Stop the move going on (it bumped into a wall); the block waiting for it goes on. */
  halt(): void {
    const m = this.motion
    if (m?.kind === 'turn' || m?.kind === 'leap' || m?.kind === 'climb') return
    this.token++
    this.motion = null
  }

  /**
   * Stop walking, gliding or turning (its script was started again by a message, as in Scratch);
   * a jump, a take-off or a landing goes on.
   */
  stopMove(): void {
    const m = this.motion
    if (m?.kind !== 'move' && m?.kind !== 'glide' && m?.kind !== 'turn') return
    this.token++
    this.motion = null
  }

  /** Stop going up or down (something is in the way); a landing is over. */
  haltClimb(): void {
    if (this.motion?.kind !== 'climb') return
    this.token++
    this.motion = null
  }

  /** Be at a point at once (Scratch's "go to"). */
  goTo(x: number, y: number): void {
    this.token++
    this.motion = null
    this.x = fin(x)
    this.y = fin(y)
    this.teleported = true
  }

  /** Swim to a point in `seconds`, facing where it goes. */
  glide(x: number, y: number, seconds: number): () => boolean {
    x = fin(x)
    y = fin(y)
    seconds = fin(seconds)
    if (Math.hypot(x - this.x, y - this.y) > 1e-6) this.theta = Math.atan2(y - this.y, x - this.x)
    return this.start({ kind: 'glide', x0: this.x, y0: this.y, x1: x, y1: y, t0: this.now, dur: Math.max(0, seconds) })
  }

  /** Hop on the spot. */
  jump(): () => boolean {
    if (this.hopT0 === null) this.hopT0 = this.now
    const t0 = this.hopT0
    return () => this.hopT0 !== t0
  }

  /** Show a speech bubble, for `seconds` or until the next one. Returns when it is over. */
  speak(text: string, seconds?: number): () => boolean {
    const token = ++this.sayToken
    this.say = text.trim() ? text : null
    const until = seconds !== undefined ? this.now + Math.max(0, fin(seconds)) : null
    this.sayUntil = until
    if (until === null) return () => true
    // over when the time is up (even for an empty bubble) or when the next "say" replaced it
    return () => this.sayToken !== token || this.now >= until - 1e-9
  }
}
