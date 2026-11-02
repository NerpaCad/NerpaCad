import { signal } from '@preact/signals'

/**
 * Dimension labels drawn over the 3D view (TinkerCad style): the size of the selected shape
 * next to its edges and its height above the workplane. Positions are CSS pixels in the view.
 */
export interface DimLabel {
  id: string
  /**
   * size / elevation of the selection, distance from the ruler, the ruler's own buttons, or the
   * pin over a static shape of the robotics field (not a number: it only shows it does not move)
   */
  kind: 'size' | 'elev' | 'ruler' | 'rulerOrigin' | 'pin'
  axis: 0 | 1 | 2
  value: number
  x: number
  y: number
  /** which way (unit screen vector) the label may move to get out of another's way */
  push?: [number, number]
}

/** How big a label is on screen (it is a little button with the number in a monospace font). */
export function dimSize(d: DimLabel): { w: number; h: number } {
  if (d.kind === 'rulerOrigin') return { w: 56, h: 24 }
  if (d.kind === 'pin') return { w: 22, h: 22 }
  const text = (d.kind === 'elev' ? '↑ ' : '') + String(Math.round(d.value * 100) / 100)
  return { w: Math.max(34, text.length * 7.3 + 16), h: 22 }
}

/**
 * Move labels apart so none covers another, nor the handles of the selection: earlier labels stay,
 * a later one that overlaps is pushed step by step along its own `push` direction (away from the
 * shape) until it is clear. `handles`: screen points of the handles (arrows, squares, the lift
 * cone), each counted `reach` pixels round.
 */
export function separateDims(list: DimLabel[], gap = 4, handles: [number, number][] = [], reach = 6): DimLabel[] {
  const out = list.map((d) => ({ ...d }))
  const hit = (a: DimLabel, b: DimLabel) => {
    const sa = dimSize(a)
    const sb = dimSize(b)
    return Math.abs(a.x - b.x) < (sa.w + sb.w) / 2 + gap && Math.abs(a.y - b.y) < (sa.h + sb.h) / 2 + gap
  }
  const onHandle = (d: DimLabel) => {
    const s = dimSize(d)
    return handles.some(([x, y]) => Math.abs(d.x - x) < s.w / 2 + reach && Math.abs(d.y - y) < s.h / 2 + reach)
  }
  for (let i = 0; i < out.length; i++) {
    const d = out[i]
    // the ruler's buttons and the pins stay where they are
    if (d.kind === 'rulerOrigin' || d.kind === 'pin') continue
    const [px, py] = d.push ?? [0, 1]
    for (let step = 0; step < 80 && (out.slice(0, i).some((e) => hit(d, e)) || onHandle(d)); step++) {
      d.x += px * 3
      d.y += py * 3
    }
  }
  return out
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
