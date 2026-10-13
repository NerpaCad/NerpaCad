/**
 * Screen-space overlay of a sketch: dimension lines with their editable numbers, and small
 * badges for the geometric constraints. Computed by the sketch editor after each render;
 * drawn by ui/SketchLayer.tsx. Coordinates are pixels inside the 3D view.
 */
import { signal } from '@preact/signals'
import type { ConstraintType, Sketch } from '../core/sketch/types'

export interface SkDim {
  id: string
  type: ConstraintType
  /** value as shown (lengths positive, angles in degrees) */
  shown: number
  x: number
  y: number
  /** polylines of the dimension graphics */
  lines: [number, number][][]
  /** arrow heads: tip and direction angle (radians, screen space) */
  arrows: [number, number, number][]
  /**
   * How many of the first `lines` are extension lines: they are drawn but not grabbed (they
   * start right at the measured points, which must stay easy to drag)
   */
  exts?: number
}

export interface SkBadge {
  /** constraint id (a constraint may show several badges, e.g. parallel on both lines) */
  id: string
  /** a regular polygon's badge stands for all of its constraints */
  type: ConstraintType | 'regular'
  x: number
  y: number
  /** what a click selects, when that is more than `id` (a regular polygon's constraints) */
  ids?: string[]
  /** group number of an "equal" badge (lines with the same number are equal) */
  n?: number
}

export interface SkOverlay {
  dims: SkDim[]
  badges: SkBadge[]
}

export const skOverlay = signal<SkOverlay>({ dims: [], badges: [] })
/** constraint ids to show in the error color for a moment */
export const skFlash = signal<Set<string>>(new Set())
/** the dimension whose number is being typed */
export const skEditDim = signal<string | null>(null)

const fmt = (v: number) => String(Math.round(v * 100) / 100)

/** The text on a dimension's number. */
export function dimText(d: SkDim): string {
  switch (d.type) {
    case 'distanceX':
      return `↔ ${fmt(d.shown)}`
    case 'distanceY':
      return `↕ ${fmt(d.shown)}`
    case 'radius':
      return `R ${fmt(d.shown)}`
    case 'diameter':
      return `⌀ ${fmt(d.shown)}`
    case 'angle':
      return `${fmt(d.shown)}°`
    default:
      return fmt(d.shown)
  }
}

export function sameOverlay(a: SkOverlay, b: SkOverlay): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** curves that keep the sketch from extruding cleanly (loose ends, crossings), for this sketch state */
export const skProblems = signal<{ sketch: Sketch; ids: Set<string> } | null>(null)

/** show the small constraint badges (they can crowd a small drawing) */
export const skShowBadges = signal(true)
