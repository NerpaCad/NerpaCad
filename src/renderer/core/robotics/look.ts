/**
 * The «beautiful view» of the robotics field: real shadows, sky and ambient light, glass that
 * refracts, a glow around lamps and glowing shapes, soft shading in corners on the high quality.
 * The settings are kept in the project; the numbers of each time of day are here (the view reads
 * them, view/PrettyView.ts).
 */

export type TimeOfDay = 'day' | 'evening' | 'night'
export type Quality = 'low' | 'mid' | 'high'
export const TIMES: TimeOfDay[] = ['day', 'evening', 'night']
export const QUALITIES: Quality[] = ['low', 'mid', 'high']

export interface ViewSettings {
  /** the beautiful view is on (in the robotics tab) */
  on: boolean
  time: TimeOfDay
  /** where the sun stands, degrees round the field (0 = from +X, 90 = from +Y) */
  sun: number
  shadows: boolean
  /** strength of the glow, 0…100 % */
  glow: number
  quality: Quality
}

export const DEFAULT_VIEW: ViewSettings = { on: false, time: 'day', sun: 220, shadows: true, glow: 50, quality: 'mid' }

/** Settings from a file or a patch, made valid. */
export function normView(v: unknown): ViewSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<ViewSettings>
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d)
  return {
    on: o.on === true,
    time: TIMES.includes(o.time as TimeOfDay) ? (o.time as TimeOfDay) : DEFAULT_VIEW.time,
    sun: ((Math.round(num(o.sun, DEFAULT_VIEW.sun)) % 360) + 360) % 360,
    shadows: o.shadows !== false,
    glow: Math.max(0, Math.min(100, Math.round(num(o.glow, DEFAULT_VIEW.glow)))),
    quality: QUALITIES.includes(o.quality as Quality) ? (o.quality as Quality) : DEFAULT_VIEW.quality
  }
}

export const sameView = (a: ViewSettings, b: ViewSettings) =>
  a.on === b.on && a.time === b.time && a.sun === b.sun && a.shadows === b.shadows && a.glow === b.glow && a.quality === b.quality

/** The lower of two qualities (the view may lower the chosen one when the computer is slow). */
export const lowerQuality = (a: Quality, b: Quality): Quality => QUALITIES[Math.min(QUALITIES.indexOf(a), QUALITIES.indexOf(b))]
export const stepDown = (q: Quality): Quality => QUALITIES[Math.max(0, QUALITIES.indexOf(q) - 1)]

/** The light of a time of day. Colours are sRGB; intensities as three.js takes them. */
export interface Preset {
  /** the sun (the moon at night): height over the horizon in degrees, colour, strength */
  sunHeight: number
  sunColor: string
  sunIntensity: number
  /** light from the sky and from the ground */
  skyLight: string
  groundLight: string
  hemiIntensity: number
  /** reflections of the surroundings */
  envIntensity: number
  /** the sky: top, horizon; the floor of the field; haze toward the horizon */
  skyTop: string
  skyHorizon: string
  floor: string
  stars: boolean
  exposure: number
  /** how strongly glowing things glow (night: they are the only light) */
  glowBoost: number
}

export const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    sunHeight: 52,
    sunColor: '#fff3df',
    sunIntensity: 2.8,
    skyLight: '#d6e9ff',
    groundLight: '#8d8470',
    hemiIntensity: 0.9,
    envIntensity: 0.45,
    skyTop: '#5f9fe6',
    skyHorizon: '#d9ecfb',
    floor: '#cfd6c8',
    stars: false,
    exposure: 0.9,
    glowBoost: 1
  },
  evening: {
    sunHeight: 11,
    sunColor: '#ffad66',
    sunIntensity: 2.4,
    skyLight: '#ffcfa8',
    groundLight: '#5c4a5e',
    hemiIntensity: 0.55,
    envIntensity: 0.3,
    skyTop: '#3b4f8c',
    skyHorizon: '#f6a66b',
    floor: '#b9ae9e',
    stars: false,
    exposure: 1.05,
    glowBoost: 1.6
  },
  night: {
    sunHeight: 38,
    sunColor: '#9fb6ff',
    sunIntensity: 0.22,
    skyLight: '#2a3a66',
    groundLight: '#0d0f18',
    hemiIntensity: 0.12,
    envIntensity: 0.04,
    skyTop: '#03050d',
    skyHorizon: '#16203d',
    floor: '#3a4150',
    stars: true,
    exposure: 1.15,
    glowBoost: 3
  }
}

/** What each quality turns on. */
export interface QualitySpec {
  /** pixels per screen pixel (at most the screen's own) */
  pixelRatio: number
  shadowMap: number
  /** lamps (spotlights) that cast shadows too */
  lampShadows: number
  /** antialiasing samples of the picture */
  samples: number
  /** soft shading in corners */
  ao: boolean
}

export const QUALITY: Record<Quality, QualitySpec> = {
  low: { pixelRatio: 1, shadowMap: 1024, lampShadows: 0, samples: 0, ao: false },
  mid: { pixelRatio: 1.5, shadowMap: 2048, lampShadows: 1, samples: 4, ao: false },
  high: { pixelRatio: 2, shadowMap: 4096, lampShadows: 2, samples: 4, ao: true }
}

/** below this many frames a second during a run the view lowers its quality by a step */
export const MIN_FPS = 30

/** The direction toward the sun (unit vector, Z up). */
export function sunDirection(s: ViewSettings): [number, number, number] {
  const p = PRESETS[s.time]
  const az = (s.sun * Math.PI) / 180
  const el = (p.sunHeight * Math.PI) / 180
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
}
