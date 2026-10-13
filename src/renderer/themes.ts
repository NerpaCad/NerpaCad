/**
 * Color themes. Each theme sets the UI (CSS variables), the 3D scene colors and the default
 * colors of new shapes. Cyberpunk is original; the other three follow palettes from Canva's
 * "100 color combinations" (№ 1, 16, 69) — colors picked from their descriptions.
 */
import { effect, signal } from '@preact/signals'
import type { PrimType } from './core/doc/model'
import { DEFAULT_COLORS, PALETTE } from './core/doc/shapes'
import { type SceneColors, THEME } from './view/theme'

interface UiColors {
  bg: string
  panel: string
  panel2: string
  panel3: string
  line: string
  line2: string
  text: string
  text2: string
  muted: string
  /** main accent (selected buttons, titles) and the text drawn on top of it */
  primary: string
  primaryInk: string
  /** interaction accent (hover, focus) */
  accent: string
  danger: string
  font: string
  titleCase: 'uppercase' | 'none'
  tracking: string
  /** chamfer size for cut corners (0 = plain) and corner radius */
  cut: string
  radius: string
  glow: string
}

export interface Theme {
  id: string
  name: { ru: string; en: string; zh: string }
  dark: boolean
  ui: UiColors
  scene: Omit<SceneColors, 'cubeFont'>
  shapes: Record<PrimType, string>
  palette: string[]
}

// the CJK families at the end cover Simplified Chinese on Windows, macOS and Linux
const SANS =
  '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "WenQuanYi Micro Hei", sans-serif'
const TECH = `Bahnschrift, ${SANS}`

export const THEMES: Theme[] = [
  {
    id: 'cyberpunk',
    name: { ru: 'Киберпанк', en: 'Cyberpunk', zh: '赛博朋克' },
    dark: true,
    ui: {
      bg: '#07080e',
      panel: '#0e1019',
      panel2: '#151827',
      panel3: '#1c2033',
      line: '#262b42',
      line2: '#1b1f31',
      text: '#e4e8f5',
      text2: '#b9c1d9',
      muted: '#7c86a3',
      primary: '#fcee0a',
      primaryInk: '#000000',
      accent: '#00f0ff',
      danger: '#ff003c',
      font: TECH,
      titleCase: 'uppercase',
      tracking: '0.1em',
      cut: '8px',
      radius: '0px',
      glow: '12px'
    },
    scene: {
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
      cubeHoverTint: '#ffffff'
    },
    shapes: {
      box: '#ff003c',
      cylinder: '#fcee0a',
      sphere: '#00f0ff',
      cone: '#b026ff',
      pyramid: '#ff8a00',
      wedge: '#2bff88',
      torus: '#ff2a9d',
      polygon: '#5a4bff',
      icosahedron: '#00c2a8',
      hemisphere: '#4dd8ff',
      roundRoof: '#ff5e3a',
      text: '#fcee0a',
      mesh: '#8a96b0',
      sketch: '#2bff88',
      tile: '#ffffff',
      terrain: '#b8c2cc',
      decor: '#4f9a3a',
      robot: '#e8ecf4',
      gear: '#00f0ff',
      light: '#ffd84a',
      nerpa: '#8f9aa6',
      bolt: '#8a96b0',
      nut: '#ffffff',
      jar: '#00c2a8',
      rack: '#00c2a8',
      wheel: '#fcee0a',
      pulley: '#ff8a00',
      washer: '#ffffff',
      spring: '#ff2a9d',
      boxLid: '#5a4bff',
      hinge: '#2bff88',
      knob: '#ff003c',
      tag: '#fcee0a'
    },
    palette: ['#ff003c', '#ff2a9d', '#b026ff', '#5a4bff', '#00f0ff', '#00c2a8', '#2bff88', '#fcee0a', '#ff8a00', '#9b6b43', '#ffffff', '#8a96b0', '#3a4258', '#15171f']
  },
  {
    id: 'desert',
    name: { ru: 'Пустыня', en: 'Desert', zh: '沙漠' },
    dark: false,
    ui: {
      bg: '#f1e2cc',
      panel: '#fbf4ea',
      panel2: '#f4e7d5',
      panel3: '#ead5bb',
      line: '#dcc3a3',
      line2: '#ecdcc6',
      text: '#3b2416',
      text2: '#5c3a24',
      muted: '#9a7658',
      primary: '#d9642b',
      primaryInk: '#ffffff',
      accent: '#8c4a2f',
      danger: '#b3261e',
      font: SANS,
      titleCase: 'none',
      tracking: '0.02em',
      cut: '0px',
      radius: '8px',
      glow: '0px'
    },
    scene: {
      clear: '#efdcc2',
      workBase: '#e8cfab',
      workMinor: '#dbbd95',
      workMajor: '#c4966a',
      workBorder: '#b5602f',
      workAlphaTop: 0.85,
      workAlphaBottom: 0.35,
      select: '#6b2c10',
      handleCorner: '#fffaf2',
      handleSide: '#6b3e26',
      handleOutline: '#3b2416',
      handleHot: '#d9642b',
      lift: '#d9642b',
      rotate: '#6b3e26',
      rotateHot: '#d9642b',
      protractor: '#6b3e26',
      sweep: '#d9642b',
      ghostEdge: '#6b3e26',
      guide: '#c1440e',
      shadow: '#3b2416',
      shadowOpacity: 0.22,
      hole: '#b69b7e',
      emissive: 0.04,
      sketchLine: '#3b1f0e',
      sketchConstruction: '#8c7b6b',
      sketchPoint: '#6b2c10',
      sketchSelect: '#d9642b',
      sketchHover: '#1f6f8b',
      sketchDone: '#2e7d32',
      sketchConflict: '#b3261e',
      sketchPreview: '#d9642b',
      cubeFace: '#fbf4ea',
      cubeText: '#8c4a2f',
      cubeEdge: '#c9a882',
      cubeHoverGlow: '#000000',
      cubeHoverTint: '#f5c9a6'
    },
    shapes: {
      box: '#d9642b',
      cylinder: '#e3a857',
      sphere: '#8c4a2f',
      cone: '#c1440e',
      pyramid: '#f0c987',
      wedge: '#a0522d',
      torus: '#e07a5f',
      polygon: '#6b3e26',
      icosahedron: '#7a8450',
      hemisphere: '#d8c3a5',
      roundRoof: '#5d7b8a',
      text: '#6b3e26',
      mesh: '#b69b7e',
      sketch: '#d9642b',
      tile: '#ffffff',
      terrain: '#b8c2cc',
      decor: '#4f9a3a',
      robot: '#e8ecf4',
      gear: '#8c4a2f',
      light: '#ffd84a',
      nerpa: '#8f9aa6',
      bolt: '#ffffff',
      nut: '#5d7b8a',
      jar: '#a0522d',
      rack: '#a0522d',
      wheel: '#6b3e26',
      pulley: '#3b2416',
      washer: '#5d7b8a',
      spring: '#d9642b',
      boxLid: '#e3a857',
      hinge: '#8c4a2f',
      knob: '#c1440e',
      tag: '#6b3e26'
    },
    palette: ['#c1440e', '#d9642b', '#e07a5f', '#e3a857', '#f0c987', '#a0522d', '#8c4a2f', '#6b3e26', '#3b2416', '#7a8450', '#5d7b8a', '#ffffff', '#d8c3a5', '#2b2b2b']
  },
  {
    id: 'sea',
    name: { ru: 'Морская волна', en: 'Sea wave', zh: '海浪' },
    dark: false,
    ui: {
      bg: '#dce8f3',
      panel: '#f4f8fc',
      panel2: '#e8f0f8',
      panel3: '#d3e1ef',
      line: '#b8cde2',
      line2: '#dbe6f1',
      text: '#0b2545',
      text2: '#13315c',
      muted: '#5b7aa0',
      primary: '#134074',
      primaryInk: '#ffffff',
      accent: '#2a7ab8',
      danger: '#c0392b',
      font: SANS,
      titleCase: 'none',
      tracking: '0.02em',
      cut: '0px',
      radius: '8px',
      glow: '0px'
    },
    scene: {
      clear: '#d6e4f0',
      workBase: '#c2d6ea',
      workMinor: '#a7c1dd',
      workMajor: '#6f97c2',
      workBorder: '#134074',
      workAlphaTop: 0.85,
      workAlphaBottom: 0.35,
      select: '#0b2545',
      handleCorner: '#ffffff',
      handleSide: '#134074',
      handleOutline: '#0b2545',
      handleHot: '#2a9df4',
      lift: '#134074',
      rotate: '#134074',
      rotateHot: '#2a9df4',
      protractor: '#134074',
      sweep: '#2a9df4',
      ghostEdge: '#0b2545',
      guide: '#e0457b',
      shadow: '#0b2545',
      shadowOpacity: 0.2,
      hole: '#8aa6c1',
      emissive: 0.04,
      sketchLine: '#0b2545',
      sketchConstruction: '#5fa8d3',
      sketchPoint: '#134074',
      sketchSelect: '#e0457b',
      sketchHover: '#2a7ab8',
      sketchDone: '#1b7f4a',
      sketchConflict: '#c0392b',
      sketchPreview: '#e0457b',
      cubeFace: '#f4f8fc',
      cubeText: '#134074',
      cubeEdge: '#8da9c4',
      cubeHoverGlow: '#000000',
      cubeHoverTint: '#bcd4ee'
    },
    shapes: {
      box: '#134074',
      cylinder: '#2a7ab8',
      sphere: '#5fa8d3',
      cone: '#0b2545',
      pyramid: '#8da9c4',
      wedge: '#1d4e89',
      torus: '#62b6cb',
      polygon: '#13315c',
      icosahedron: '#bee9e8',
      hemisphere: '#cae9ff',
      roundRoof: '#7f8c8d',
      text: '#13315c',
      mesh: '#8aa6c1',
      sketch: '#2a7ab8',
      tile: '#ffffff',
      terrain: '#b8c2cc',
      decor: '#4f9a3a',
      robot: '#e8ecf4',
      gear: '#5fa8d3',
      light: '#ffd84a',
      nerpa: '#8f9aa6',
      bolt: '#eef4ed',
      nut: '#ffffff',
      jar: '#5fa8d3',
      rack: '#5fa8d3',
      wheel: '#8da9c4',
      pulley: '#bee9e8',
      washer: '#ffffff',
      spring: '#13315c',
      boxLid: '#1d4e89',
      hinge: '#62b6cb',
      knob: '#0b2545',
      tag: '#8da9c4'
    },
    palette: ['#0b2545', '#13315c', '#134074', '#1d4e89', '#2a7ab8', '#5fa8d3', '#62b6cb', '#8da9c4', '#bee9e8', '#cae9ff', '#ffffff', '#eef4ed', '#7f8c8d', '#2c3e50']
  },
  {
    id: 'industrial',
    name: { ru: 'Индустриальная строгость', en: 'Industrial', zh: '工业风' },
    dark: false,
    ui: {
      bg: '#d6d6d3',
      panel: '#efefed',
      panel2: '#e4e4e1',
      panel3: '#d0d0cc',
      line: '#b5b5b0',
      line2: '#d6d6d2',
      text: '#1e1f21',
      text2: '#34363a',
      muted: '#6d6f73',
      primary: '#2f3e46',
      primaryInk: '#ffffff',
      accent: '#b5651d',
      danger: '#c0392b',
      font: TECH,
      titleCase: 'uppercase',
      tracking: '0.08em',
      cut: '0px',
      radius: '2px',
      glow: '0px'
    },
    scene: {
      clear: '#cdcecb',
      workBase: '#b8bab5',
      workMinor: '#a3a5a0',
      workMajor: '#7b7e7a',
      workBorder: '#2f3e46',
      workAlphaTop: 0.85,
      workAlphaBottom: 0.35,
      select: '#b5651d',
      handleCorner: '#ffffff',
      handleSide: '#2f3e46',
      handleOutline: '#1e1f21',
      handleHot: '#e07b24',
      lift: '#b5651d',
      rotate: '#2f3e46',
      rotateHot: '#e07b24',
      protractor: '#2f3e46',
      sweep: '#e07b24',
      ghostEdge: '#2f3e46',
      guide: '#e07b24',
      shadow: '#1e1f21',
      shadowOpacity: 0.22,
      hole: '#8b8f94',
      emissive: 0.03,
      sketchLine: '#1e1f21',
      sketchConstruction: '#6d7a85',
      sketchPoint: '#2f3e46',
      sketchSelect: '#e07b24',
      sketchHover: '#b5651d',
      sketchDone: '#2e7d32',
      sketchConflict: '#c0392b',
      sketchPreview: '#e07b24',
      cubeFace: '#efefed',
      cubeText: '#2f3e46',
      cubeEdge: '#9a9c98',
      cubeHoverGlow: '#000000',
      cubeHoverTint: '#f0d2b4'
    },
    shapes: {
      box: '#52616b',
      cylinder: '#b5651d',
      sphere: '#8d99a6',
      cone: '#2f3e46',
      pyramid: '#c9a227',
      wedge: '#6b705c',
      torus: '#a3a5a8',
      polygon: '#354f52',
      icosahedron: '#84a98c',
      hemisphere: '#c9ccd1',
      roundRoof: '#e07b24',
      text: '#1e1f21',
      mesh: '#8b8f94',
      sketch: '#b5651d',
      tile: '#ffffff',
      terrain: '#b8c2cc',
      decor: '#4f9a3a',
      robot: '#e8ecf4',
      gear: '#8d99a6',
      light: '#ffd84a',
      nerpa: '#8f9aa6',
      bolt: '#8d99a6',
      nut: '#c9a227',
      jar: '#ffffff',
      rack: '#ffffff',
      wheel: '#a5a58d',
      pulley: '#b5651d',
      washer: '#c9a227',
      spring: '#2f3e46',
      boxLid: '#8d99a6',
      hinge: '#6b705c',
      knob: '#1e1f21',
      tag: '#a5a58d'
    },
    palette: ['#1e1f21', '#2f3e46', '#52616b', '#8d99a6', '#c9ccd1', '#ffffff', '#6b705c', '#a5a58d', '#b5651d', '#e07b24', '#c9a227', '#7f1d1d', '#354f52', '#84a98c']
  }
]

function initialTheme(): string {
  try {
    const saved = localStorage.getItem('cad.theme')
    if (saved && THEMES.some((t) => t.id === saved)) return saved
  } catch {
    /* storage unavailable */
  }
  return 'cyberpunk'
}

export const themeId = signal<string>(initialTheme())

export const currentTheme = (): Theme => THEMES.find((t) => t.id === themeId.value) ?? THEMES[0]

/** Push a theme into CSS variables, the scene color table and the new-shape colors. */
export function applyTheme(t: Theme): void {
  Object.assign(THEME, t.scene, { cubeFont: t.ui.font })
  Object.assign(DEFAULT_COLORS, t.shapes)
  PALETTE.splice(0, PALETTE.length, ...t.palette)

  const s = document.documentElement.style
  const u = t.ui
  const vars: Record<string, string> = {
    bg: u.bg,
    panel: u.panel,
    'panel-2': u.panel2,
    'panel-3': u.panel3,
    line: u.line,
    'line-2': u.line2,
    text: u.text,
    'text-2': u.text2,
    muted: u.muted,
    primary: u.primary,
    'primary-ink': u.primaryInk,
    accent: u.accent,
    danger: u.danger,
    font: u.font,
    'title-case': u.titleCase,
    tracking: u.tracking,
    cut: u.cut,
    radius: u.radius,
    glow: u.glow,
    'sk-done': t.scene.sketchDone,
    'sk-line': t.scene.sketchLine,
    'sk-select': t.scene.sketchSelect,
    'sk-conflict': t.scene.sketchConflict
  }
  for (const [k, v] of Object.entries(vars)) s.setProperty(`--${k}`, v)
  s.setProperty('color-scheme', t.dark ? 'dark' : 'light')
  document.documentElement.dataset.theme = t.id
}

effect(() => {
  const t = currentTheme()
  applyTheme(t)
  try {
    localStorage.setItem('cad.theme', t.id)
  } catch {
    /* ignore */
  }
})
