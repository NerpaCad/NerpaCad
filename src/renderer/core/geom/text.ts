import type { Font, PathCommand } from 'opentype.js'

export type Contour = [number, number][]

const CURVE_STEPS = 8

/**
 * Lay out a single line of text glyph by glyph and flatten the outlines to polygons.
 * We avoid font.getPath() because opentype.js's shaper throws on some GSUB tables
 * (e.g. DejaVu's ccmp), and a CAD label needs no complex shaping anyway.
 * Returned contours are in mm, Y up, baseline at y = 0.
 */
export function textContours(font: Font, text: string, size: number): Contour[] {
  const scale = size / font.unitsPerEm
  const contours: Contour[] = []
  let x = 0
  let prev: ReturnType<Font['charToGlyph']> | null = null
  for (const ch of text) {
    const g = font.charToGlyph(ch)
    if (prev) x += font.getKerningValue(prev, g) * scale
    flatten(g.getPath(x, 0, size).commands, contours)
    x += (g.advanceWidth ?? 0) * scale
    prev = g
  }
  return contours
}

function flatten(cmds: PathCommand[], out: Contour[]): void {
  let cur: Contour = []
  let px = 0
  let py = 0
  const push = (x: number, y: number) => {
    const last = cur[cur.length - 1]
    // opentype paths are Y-down; flip to Y-up
    if (!last || Math.abs(last[0] - x) > 1e-7 || Math.abs(last[1] + y) > 1e-7) cur.push([x, -y])
    px = x
    py = y
  }
  const close = () => {
    if (cur.length > 2) {
      const a = cur[0]
      const b = cur[cur.length - 1]
      if (Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7) cur.pop()
      if (cur.length > 2) out.push(cur)
    }
    cur = []
  }
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        close()
        push(c.x!, c.y!)
        break
      case 'L':
        push(c.x!, c.y!)
        break
      case 'Q': {
        const x0 = px
        const y0 = py
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS
          const u = 1 - t
          push(
            u * u * x0 + 2 * u * t * c.x1! + t * t * c.x!,
            u * u * y0 + 2 * u * t * c.y1! + t * t * c.y!
          )
        }
        break
      }
      case 'C': {
        const x0 = px
        const y0 = py
        for (let i = 1; i <= CURVE_STEPS; i++) {
          const t = i / CURVE_STEPS
          const u = 1 - t
          push(
            u * u * u * x0 + 3 * u * u * t * c.x1! + 3 * u * t * t * c.x2! + t * t * t * c.x!,
            u * u * u * y0 + 3 * u * u * t * c.y1! + 3 * u * t * t * c.y2! + t * t * t * c.y!
          )
        }
        break
      }
      case 'Z':
        close()
        break
    }
  }
  close()
}
