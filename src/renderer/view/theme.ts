/**
 * Colors of the 3D scene for the active theme. The object is mutated in place when the
 * theme changes (see ../themes.ts), so modules can keep a reference to it.
 */
export interface SceneColors {
  clear: string

  workBase: string
  workMinor: string
  workMajor: string
  workBorder: string
  /** workplane opacity seen from above / from below */
  workAlphaTop: number
  workAlphaBottom: number

  select: string

  handleCorner: string
  handleSide: string
  handleOutline: string
  handleHot: string
  lift: string

  rotate: string
  rotateHot: string
  protractor: string
  sweep: string

  ghostEdge: string
  /** smart guide lines while moving */
  guide: string
  /** footprint under a lifted shape */
  shadow: string
  shadowOpacity: number
  hole: string
  /** how much solids glow with their own color (0 = none) */
  emissive: number

  /** sketch mode: lines, helper lines, points, selection/hover, fully constrained, errors, rubber band */
  sketchLine: string
  sketchConstruction: string
  sketchPoint: string
  sketchSelect: string
  sketchHover: string
  sketchDone: string
  sketchConflict: string
  sketchPreview: string

  cubeFace: string
  cubeText: string
  cubeEdge: string
  /** hover: emissive added (dark themes) and color multiplied (light themes) */
  cubeHoverGlow: string
  cubeHoverTint: string
  cubeFont: string
}

export const THEME: SceneColors = {
  clear: '#07080e',

  workBase: '#0b111d',
  workMinor: '#142235',
  workMajor: '#1a5066',
  workBorder: '#00f0ff',
  workAlphaTop: 0.82,
  workAlphaBottom: 0.3,

  select: '#00f0ff',

  handleCorner: '#fcee0a',
  handleSide: '#00f0ff',
  handleOutline: '#05060a',
  handleHot: '#ffffff',
  lift: '#ff003c',

  rotate: '#00f0ff',
  rotateHot: '#fcee0a',
  protractor: '#00f0ff',
  sweep: '#fcee0a',

  ghostEdge: '#00f0ff',
  guide: '#ff2a9d',
  shadow: '#00f0ff',
  shadowOpacity: 0.16,
  hole: '#56708f',
  emissive: 0.12,

  sketchLine: '#fcee0a',
  sketchConstruction: '#00f0ff',
  sketchPoint: '#ffffff',
  sketchSelect: '#ff2a9d',
  sketchHover: '#ffffff',
  sketchDone: '#39ff88',
  sketchConflict: '#ff003c',
  sketchPreview: '#00f0ff',
  cubeFace: '#121828',
  cubeText: '#00f0ff',
  cubeEdge: '#2e4a66',
  cubeHoverGlow: '#3a3408',
  cubeHoverTint: '#ffffff',
  cubeFont: 'Bahnschrift, "Segoe UI", system-ui, sans-serif'
}
