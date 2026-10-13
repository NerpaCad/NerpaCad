/**
 * Mods: robots made by anyone, added without changing the app. A mod is a folder in the app's
 * mods folder with a `mod.json` and the 3D model files it names. It is data only — sizes, pads,
 * colours, model files — never code, so a mod cannot do anything but look and drive like a robot.
 * The format is described for mod makers in `MODS.md`.
 *
 * `parseMod` checks a `mod.json` and turns it into robot descriptions (`RobotSpec`), with every
 * number clamped to something the field can work with. What is wrong is reported, not guessed.
 */
import { SENSOR_TYPES, type SensorType } from '../doc/model'
import { type Axis, type ColorRule, type LocalText, type ModelPlacement, type PadSpec, ROBOT_ID, type RobotSpec } from './robot'

/** what `mod.json` says it is */
export const MOD_FORMAT = 'nerpacad-mod'
/** the version of the format this app reads (a mod for a newer one is refused, not half read) */
export const MOD_FORMAT_VERSION = 1

/** A mod as the app shows it (the About window lists them). */
export interface ModInfo {
  id: string
  name: LocalText
  version: string
  author: string
  license: string
  description?: LocalText
  homepage?: string
  robots: RobotSpec[]
}

export interface ParsedMod {
  mod: ModInfo | null
  /** what is wrong (the mod is not used when `mod` is null; otherwise these are only warnings) */
  errors: string[]
}

const AXES: Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z']
const MODEL_EXT = /\.(glb|gltf|fbx)$/i
const COLOR = /^#[0-9a-f]{6}$/i
const MAX_ROBOTS = 16
const MAX_PADS = 16
const MAX_RULES = 64

type Json = Record<string, unknown>
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Check a mod: `text` is its `mod.json`, `base` the URL its files are under (ending in /). Ids of
 * robots that are already taken (`taken`) are refused, so a mod cannot replace another's robot.
 */
export function parseMod(text: string, base: string, taken: ReadonlySet<string> = new Set()): ParsedMod {
  const errors: string[] = []
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch (e) {
    return { mod: null, errors: [`mod.json: ${String((e as Error).message)}`] }
  }
  if (!isObj(j) || j.format !== MOD_FORMAT) return { mod: null, errors: [`mod.json: "format" must be "${MOD_FORMAT}"`] }
  const fv = j.formatVersion
  if (typeof fv !== 'number' || fv < 1) return { mod: null, errors: ['mod.json: "formatVersion" must be 1'] }
  if (fv > MOD_FORMAT_VERSION) return { mod: null, errors: [`mod.json: made for a newer NerpaCad (format ${fv}, this one reads ${MOD_FORMAT_VERSION})`] }
  const id = j.id
  if (typeof id !== 'string' || !ROBOT_ID.test(id)) return { mod: null, errors: ['mod.json: "id" must be letters, digits, ".", "_" or "-" (up to 64)'] }
  const name = text_(j.name) ?? id
  const robots: RobotSpec[] = []
  const list = Array.isArray(j.robots) ? j.robots : []
  if (!list.length) errors.push('mod.json: no "robots"')
  for (const [i, r] of list.slice(0, MAX_ROBOTS).entries()) {
    const where = `robots[${i}]`
    const spec = robot(r, base, id, where, errors)
    if (!spec) continue
    if (taken.has(spec.id) || robots.some((x) => x.id === spec.id)) {
      errors.push(`${where}: the robot id "${spec.id}" is already taken`)
      continue
    }
    robots.push(spec)
  }
  if (!robots.length) return { mod: null, errors }
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '')
  const homepage = typeof j.homepage === 'string' && /^https?:\/\//.test(j.homepage) ? j.homepage.slice(0, 300) : undefined
  return {
    mod: { id, name, version: str(j.version, 40), author: str(j.author), license: str(j.license, 100), description: text_(j.description), homepage, robots },
    errors
  }
}

/** A text: a string, or one per language ({ "ru": …, "en": …, "zh": … }). */
function text_(v: unknown): LocalText | undefined {
  if (typeof v === 'string') return v.slice(0, 200)
  if (!isObj(v)) return undefined
  const out: Partial<Record<'ru' | 'en' | 'zh', string>> = {}
  for (const k of ['ru', 'en', 'zh'] as const) if (typeof v[k] === 'string') out[k] = (v[k] as string).slice(0, 200)
  return Object.keys(out).length ? out : undefined
}

/** A number within [lo, hi]; missing or not a number: `def` (and an error if there is no default). */
function num(v: unknown, lo: number, hi: number, def: number | undefined, what: string, errors: string[]): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < lo || v > hi) errors.push(`${what}: ${v} is out of ${lo}…${hi}, ${Math.max(lo, Math.min(hi, v))} is used`)
    return Math.max(lo, Math.min(hi, v))
  }
  if (def === undefined) errors.push(`${what}: a number is needed`)
  return def ?? lo
}

function robot(r: unknown, base: string, mod: string, where: string, errors: string[]): RobotSpec | null {
  if (!isObj(r)) {
    errors.push(`${where}: not an object`)
    return null
  }
  if (typeof r.id !== 'string' || !ROBOT_ID.test(r.id)) {
    errors.push(`${where}: "id" must be letters, digits, ".", "_" or "-"`)
    return null
  }
  const before = errors.length
  const n = (k: string, lo: number, hi: number, def?: number) => num(r[k], lo, hi, def, `${where}.${k}`, errors)
  const radius = n('radius', 20, 300)
  const pads: PadSpec[] = []
  const rawPads = Array.isArray(r.pads) ? r.pads.slice(0, MAX_PADS) : []
  for (const [k, p] of rawPads.entries()) {
    const w = `${where}.pads[${k}]`
    if (!isObj(p)) {
      errors.push(`${w}: not an object`)
      continue
    }
    const port = p.port
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 32 || pads.some((q) => q.port === port)) {
      errors.push(`${w}: "port" must be a whole number 1…32, each once`)
      continue
    }
    const f = (key: string, lo: number, hi: number, def?: number) => num(p[key], lo, hi, def, `${w}.${key}`, errors)
    pads.push({ port, x: f('x', -400, 400), y: f('y', -400, 400), z: f('z', 0, 300), facing: (f('facing', -360, 360, 0) * Math.PI) / 180 })
  }
  const spec: RobotSpec = {
    id: r.id,
    name: text_(r.name) ?? r.id,
    mod,
    wheelRadius: n('wheelRadius', 5, 150),
    track: n('track', 20, 600),
    maxSpeed: n('maxSpeed', 10, 2000),
    radius,
    height: n('height', 10, 500),
    centerX: n('centerX', -200, 200, 0),
    pads,
    sensorSpot: n('sensorSpot', 1, 30, 4),
    sensorReach: n('sensorReach', 0, 200, 50)
  }
  // only a missing required number makes the robot unusable; values out of range are clamped
  if (errors.slice(before).some((e) => e.endsWith('a number is needed'))) return null
  const model = placement(r.model, base, `${where}.model`, errors)
  if (!model) return null
  spec.model = model
  if (isObj(r.modules)) {
    const modules: RobotSpec['modules'] = {}
    for (const [k, v] of Object.entries(r.modules)) {
      if (!SENSOR_TYPES.includes(k as SensorType)) {
        errors.push(`${where}.modules: unknown kind "${k}" (${SENSOR_TYPES.join(', ')})`)
        continue
      }
      const m = placement(v, base, `${where}.modules.${k}`, errors)
      if (m) modules[k as SensorType] = m
    }
    spec.modules = modules
  }
  return spec
}

/** Where a model file goes in its frame (a robot's, or a pad's for a module). */
function placement(v: unknown, base: string, where: string, errors: string[]): ModelPlacement | null {
  if (!isObj(v)) {
    errors.push(`${where}: an object with "file" is needed`)
    return null
  }
  const file = v.file
  // a plain path inside the mod's folder: no way out of it, no other scheme
  if (typeof file !== 'string' || !MODEL_EXT.test(file) || file.includes('..') || file.includes('\\') || file.startsWith('/') || /^[a-z]+:/i.test(file)) {
    errors.push(`${where}.file: a .glb, .gltf or .fbx file in the mod's folder is needed`)
    return null
  }
  const axis = (k: string, def: Axis): Axis => {
    if (v[k] === undefined) return def
    if (AXES.includes(v[k] as Axis)) return v[k] as Axis
    errors.push(`${where}.${k}: one of ${AXES.join(' ')}`)
    return def
  }
  const forward = axis('forward', '+x')
  const left = axis('left', '+y')
  const up = axis('up', '+z')
  if (new Set([forward[1], left[1], up[1]]).size < 3) {
    errors.push(`${where}: "forward", "left" and "up" must be three different axes`)
    return null
  }
  // a mirrored set (left and right swapped) would turn the model inside out
  if (axesDeterminant(forward, left, up) < 0) {
    errors.push(`${where}: "forward", "left" and "up" mirror the model (swap the sign of one of them)`)
    return null
  }
  const off = Array.isArray(v.offset) && v.offset.length === 3 && v.offset.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v.offset as number[]) : [0, 0, 0]
  const colors: ColorRule[] = []
  for (const [i, c] of (Array.isArray(v.colors) ? v.colors.slice(0, MAX_RULES) : []).entries()) {
    const w = `${where}.colors[${i}]`
    if (!isObj(c) || typeof c.match !== 'string' || !validRegex(c.match) || typeof c.color !== 'string' || !COLOR.test(c.color)) {
      errors.push(`${w}: needs "match" (a regular expression) and "color" (#rrggbb)`)
      continue
    }
    const rule: ColorRule = { match: c.match, color: c.color }
    const unit = (k: 'roughness' | 'metalness' | 'opacity') => {
      if (typeof c[k] === 'number' && Number.isFinite(c[k])) rule[k] = Math.max(0, Math.min(1, c[k] as number))
    }
    unit('roughness')
    unit('metalness')
    unit('opacity')
    if (typeof c.emissive === 'string' && COLOR.test(c.emissive)) rule.emissive = c.emissive
    colors.push(rule)
  }
  const regex = (k: string) => {
    if (v[k] === undefined) return undefined
    if (typeof v[k] === 'string' && validRegex(v[k] as string)) return v[k] as string
    errors.push(`${where}.${k}: a regular expression is needed`)
    return undefined
  }
  return {
    url: base + file.split('/').map(encodeURIComponent).join('/'),
    scale: num(v.scale, 0.001, 10000, 1, `${where}.scale`, errors),
    forward,
    left,
    up,
    offset: off.map((x) => Math.max(-1000, Math.min(1000, x))) as [number, number, number],
    colors,
    defaultColor: typeof v.defaultColor === 'string' && COLOR.test(v.defaultColor) ? v.defaultColor : undefined,
    board: regex('board'),
    led: regex('led')
  }
}

/** A model axis as a vector. */
export const axisVector = (a: Axis): [number, number, number] => {
  const v: [number, number, number] = [0, 0, 0]
  v['xyz'.indexOf(a[1])] = a[0] === '-' ? -1 : 1
  return v
}

/** +1 for a turn, −1 for a mirror. */
function axesDeterminant(f: Axis, l: Axis, u: Axis): number {
  const [a, b, c] = [axisVector(f), axisVector(l), axisVector(u)]
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
}

function validRegex(s: string): boolean {
  if (s.length > 200) return false
  try {
    new RegExp(s, 'i')
    return true
  } catch {
    return false
  }
}
