/**
 * What each character of the field can do and how big and fast it is. One description per
 * species; the movement rules (world.ts) and the block palettes read it, so an ability missing
 * here is missing everywhere.
 *
 * Sizes are at 100 % (the "size" block scales them); mm and mm/s.
 */
import type { Species } from '../doc/model'
import { SPECIES } from '../doc/model'

export interface Profile {
  species: Species
  /** the body: length (nose to tail), width, height */
  length: number
  width: number
  height: number
  /** radius of the circle that bumps into walls and water (a long body reaches further) */
  rim: number
  /** paces: walking (crawling for the seal), running, swimming, flying */
  walk: number
  run?: number
  swim?: number
  fly?: number
  /** turning, rad/s */
  turn: number
  /** the highest ledge a jump gets onto, mm (0: no jump onto anything) */
  jumpUp: number
  /** how far forward a jump goes, mm */
  leap: number
  /** crawling (the cheetah): its height crouched, as a part of its height (it passes where the
   * gap is at least this high), and its pace, mm/s */
  crouch?: number
  crawl?: number
  /** default colour of a new one */
  color: string
}

const DEG = Math.PI / 180

export const PROFILES: Record<Species, Profile> = {
  seal: { species: 'seal', length: 250, width: 120, height: 100, rim: 60, walk: 150, swim: 300, turn: 270 * DEG, jumpUp: 0, leap: 0, color: '#8f9aa6' },
  cheetah: { species: 'cheetah', length: 340, width: 100, height: 170, rim: 120, walk: 220, run: 700, turn: 360 * DEG, jumpUp: 170, leap: 300, crouch: 2 / 3, crawl: 110, color: '#e2b56b' },
  pigeon: { species: 'pigeon', length: 160, width: 80, height: 110, rim: 50, walk: 90, fly: 400, turn: 300 * DEG, jumpUp: 0, leap: 0, color: '#d4dae4' }
}

export const speciesOf = (s: unknown): Species => (SPECIES.includes(s as Species) ? (s as Species) : 'seal')
export const profileOf = (s: unknown): Profile => PROFILES[speciesOf(s)]

export const canSwim = (p: Profile) => p.swim !== undefined
export const canFly = (p: Profile) => p.fly !== undefined
export const canRun = (p: Profile) => p.run !== undefined
export const canLeap = (p: Profile) => p.jumpUp > 0
export const canCrawl = (p: Profile) => p.crouch !== undefined

/** flying: how fast it climbs and comes down (mm/s), how high a "take off" goes by default, the ceiling (mm) */
export const CLIMB_SPEED = 300
export const CRUISE = 400
export const CEILING = 2500
/** a flier that steps off an edge comes down no faster than this, mm/s */
export const GLIDE_DOWN = 350
/** a jump onto a ledge takes this long, s */
export const LEAP_TIME = 0.55
