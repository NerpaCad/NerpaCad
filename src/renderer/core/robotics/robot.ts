/**
 * Robot descriptions. Everything specific to a robot model lives in its `RobotSpec`: the app's
 * own NerpaBot is built in, more robots come from mods (see `mods.ts`), registered here.
 *
 * Robot frame: origin on the floor between the drive wheels, X forward, Y to the left, Z up;
 * millimetres. The node's rotation around Z is the heading (0° = facing world +X).
 */

export interface PadSpec {
  port: number
  /** pad centre in the robot frame, mm */
  x: number
  y: number
  /** height of the pad surface above the floor, mm */
  z: number
  /** which way a sensor on this pad points (radians around Z, 0 = forward) */
  facing: number
}

/** A text in the user's language: one for all, or per language (missing ones fall back to English, then Russian). */
export type LocalText = string | Partial<Record<'ru' | 'en' | 'zh', string>>

export const localText = (v: LocalText | undefined, lang: string): string =>
  v === undefined ? '' : typeof v === 'string' ? v : (v[lang as 'ru'] ?? v.en ?? v.ru ?? Object.values(v)[0] ?? '')

/** How a 3D model file is placed in the robot's (or a pad's) frame — see `mods.ts`. */
export interface ModelPlacement {
  /** the file, as a URL the app can load (a mod's files: mod://…) */
  url: string
  /** model units → mm */
  scale: number
  /** the model's axes that point the frame's forward (X), left (Y) and up (Z) */
  forward: Axis
  left: Axis
  up: Axis
  /** moved by this much (mm, in the frame) after turning and scaling */
  offset: [number, number, number]
  /** meshes painted by name (regular expressions), the first matching rule wins */
  colors: ColorRule[]
  /** meshes no rule matches: painted this colour (none: they keep the model's own materials) */
  defaultColor?: string
  /** pad modules: the mesh painted in the colour of the sensor kind, and the flashlight's LED */
  board?: string
  led?: string
}

export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'

export interface ColorRule {
  match: string
  color: string
  roughness?: number
  metalness?: number
  opacity?: number
  emissive?: string
}

export interface RobotSpec {
  id: string
  /** shown in the panel and the inspector */
  name?: LocalText
  /** the mod it comes from (none: built in) */
  mod?: string
  /** its 3D model (none: the built-in NerpaBot look) and its own pad modules */
  model?: ModelPlacement
  modules?: Partial<Record<'line' | 'ultrasonic' | 'touch' | 'light' | 'flashlight', ModelPlacement>>
  /** wheel radius and distance between the wheel centres (track), mm */
  wheelRadius: number
  track: number
  /** speed at 100 % motor power, mm/s */
  maxSpeed: number
  /** collision and picking shape: a cylinder of this radius and height, centred at (centerX, 0) */
  radius: number
  height: number
  centerX: number
  pads: PadSpec[]
  /** line sensor: radius of the patch of floor it averages, mm */
  sensorSpot: number
  /** how far from the pad centre (along the pad's facing) the sensor looks at the floor, mm */
  sensorReach: number
}

/**
 * NerpaBot, the app's own robot: a two-wheeled platform with a ball caster and five mounting pads
 * on its top deck (its look is built in code, `view/nerpabot.ts`). Its size, wheels, speed and
 * pads are those of the robot the field and the examples were made with, so programs carry over.
 */
export const NERPABOT: RobotSpec = {
  id: 'nerpabot',
  name: 'NerpaBot',
  wheelRadius: 21.3,
  track: 121.6,
  maxSpeed: 200,
  radius: 85,
  height: 58,
  centerX: 5,
  // five mounting pads on the top deck, numbered front-left to back-right
  pads: [
    { port: 1, x: 37.7, y: 35, z: 16.5, facing: 0 },
    { port: 2, x: 59.7, y: 0, z: 16.5, facing: 0 },
    { port: 3, x: 37.7, y: -35, z: 16.5, facing: 0 },
    { port: 4, x: -34.7, y: 35, z: 16.5, facing: Math.PI },
    { port: 5, x: -34.7, y: -35, z: 16.5, facing: Math.PI }
  ],
  sensorSpot: 4,
  // the sensor module is 75 mm long: 11 mm sit over the pad, the reading eye is near the far end
  sensorReach: 50
}

/** the robot a new one is (and what is shown for a robot whose mod is not installed) */
export const DEFAULT_ROBOT = NERPABOT.id

/** Every robot model the app knows: NerpaBot and those of the installed mods. */
export const ROBOTS: Record<string, RobotSpec> = { [NERPABOT.id]: NERPABOT }

/** Add a robot from a mod (a later one with the same id replaces it; NerpaBot stays). */
export function registerRobot(spec: RobotSpec): boolean {
  if (spec.id === NERPABOT.id) return false
  ROBOTS[spec.id] = spec
  return true
}

/** A model's description; an unknown one (its mod not installed) is shown and run as NerpaBot. */
export const robotSpec = (model: string | undefined): RobotSpec => ROBOTS[model ?? DEFAULT_ROBOT] ?? NERPABOT

/** Is this robot model known (built in or from an installed mod)? */
export const knownRobot = (model: string | undefined): boolean => !!model && model in ROBOTS

/** What a robot model id may look like in a file. */
export const ROBOT_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/i

/** Every pad number of every known robot (the blocks' port menus). */
export const allPorts = (): number[] => [...new Set(Object.values(ROBOTS).flatMap((r) => r.pads.map((p) => p.port)))].sort((a, b) => a - b)

export const padOf = (spec: RobotSpec, port: number): PadSpec | undefined => spec.pads.find((p) => p.port === port)

/**
 * The pad modules (sensors and the flashlight) share one board: 70 × 31 mm, 22 mm tall. On the
 * pad it starts 11 mm behind the pad centre and reaches 59 mm out along the pad's facing
 * (the touch module's button 5 mm further). These are the points that matter for each device,
 * in the pad frame: X out along the facing, Z up from the pad surface (mm).
 */
export const MODULE = {
  /** ultrasonic: the transducers at the far end, pointing out */
  sonarX: 59,
  sonarZ: 13,
  /** touch: the button at the tip; it counts as pressed when something is inside this box */
  touchX: 66,
  touchZ: 12,
  touchHalf: [6, 9, 8] as [number, number, number],
  /** light sensor and flashlight: the LED near the far end, on top of the board */
  eyeX: 52,
  eyeZ: 15
}

/** Ultrasonic range, cm (like the common HC-SR04 module): nothing in range reads the maximum. */
export const SONAR_MIN_CM = 2
export const SONAR_MAX_CM = 400
/** half the opening of the ultrasonic beam, radians (it is checked with a fan of rays) */
export const SONAR_HALF_ANGLE = (8 * Math.PI) / 180

/** A point of a pad module in the robot frame (mm). */
export function padPoint(pad: PadSpec, x: number, z: number): [number, number, number] {
  return [pad.x + x * Math.cos(pad.facing), pad.y + x * Math.sin(pad.facing), pad.z + z]
}

/** Where a sensor on this pad looks at the floor, in the robot frame (mm). */
export function sensorPoint(spec: RobotSpec, pad: PadSpec): [number, number] {
  return [pad.x + spec.sensorReach * Math.cos(pad.facing), pad.y + spec.sensorReach * Math.sin(pad.facing)]
}
