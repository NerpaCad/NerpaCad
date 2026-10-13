import { signal } from '@preact/signals'

/**
 * Dimension labels drawn over the 3D view (TinkerCad style): the size of the selected shape
 * next to its edges and its height above the workplane. Positions are CSS pixels in the view.
 */
export interface DimLabel {
  id: string
  /** size / elevation of the selection, distance from the ruler, or the ruler's own buttons */
  kind: 'size' | 'elev' | 'ruler' | 'rulerOrigin'
  axis: 0 | 1 | 2
  value: number
  x: number
  y: number
}

export const dims = signal<DimLabel[]>([])

export function sameDims(a: DimLabel[], b: DimLabel[]): boolean {
  if (a.length !== b.length) return false
  return a.every(
    (d, i) =>
      d.id === b[i].id &&
      Math.abs(d.value - b[i].value) < 1e-6 &&
      Math.abs(d.x - b[i].x) < 0.5 &&
      Math.abs(d.y - b[i].y) < 0.5
  )
}
