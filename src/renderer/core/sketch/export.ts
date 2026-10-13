/**
 * Sketch drawings as DXF (R12: LINE, ARC, CIRCLE) and SVG (millimetres). Construction
 * geometry is left out.
 */
import { arcAngles, splinePoints } from './geometry'
import type { Sketch } from './types'
import { pointPos } from './types'

const f = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6
  return String(Object.is(r, -0) ? 0 : r)
}
const DEG = 180 / Math.PI

/** DXF R12 text (units: millimetres), a header with the version and the ENTITIES section. */
export function toDxf(s: Sketch): string {
  const out: string[] = []
  const g = (code: number, value: string | number) => out.push(String(code), typeof value === 'number' ? f(value) : value)
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  for (const c of s.curves) {
    if (c.construction) continue
    if (c.kind === 'line') {
      const a = pointPos(s, c.p1)
      const b = pointPos(s, c.p2)
      if (!a || !b) continue
      g(0, 'LINE')
      g(8, '0')
      g(10, a[0])
      g(20, a[1])
      g(30, 0)
      g(11, b[0])
      g(21, b[1])
      g(31, 0)
    } else if (c.kind === 'circle') {
      const ctr = pointPos(s, c.c)
      if (!ctr) continue
      g(0, 'CIRCLE')
      g(8, '0')
      g(10, ctr[0])
      g(20, ctr[1])
      g(30, 0)
      g(40, c.r)
    } else if (c.kind === 'spline') {
      // a spline goes out as short straight lines: every program reads them
      const pts = splinePoints(s, c)
      for (let i = 0; i + 1 < pts.length; i++) {
        g(0, 'LINE')
        g(8, '0')
        g(10, pts[i][0])
        g(20, pts[i][1])
        g(30, 0)
        g(11, pts[i + 1][0])
        g(21, pts[i + 1][1])
        g(31, 0)
      }
    } else {
      const a = arcAngles(s, c)
      if (!a) continue
      // DXF arcs run counter-clockwise from the start angle to the end angle, like ours
      g(0, 'ARC')
      g(8, '0')
      g(10, a.c[0])
      g(20, a.c[1])
      g(30, 0)
      g(40, a.r)
      g(50, norm(a.sa * DEG))
      g(51, norm(a.ea * DEG))
    }
  }
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return out.join('\n') + '\n'
}

const norm = (deg: number) => ((deg % 360) + 360) % 360

/** SVG sized in millimetres; Y points up in the sketch, so it is flipped for SVG. */
export function toSvg(s: Sketch): string {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const grow = (x: number, y: number, r = 0) => {
    x0 = Math.min(x0, x - r)
    y0 = Math.min(y0, y - r)
    x1 = Math.max(x1, x + r)
    y1 = Math.max(y1, y + r)
  }
  const parts: string[] = []
  for (const c of s.curves) {
    if (c.construction) continue
    if (c.kind === 'line') {
      const a = pointPos(s, c.p1)
      const b = pointPos(s, c.p2)
      if (!a || !b) continue
      grow(...a)
      grow(...b)
      parts.push(`<line x1="${f(a[0])}" y1="${f(-a[1])}" x2="${f(b[0])}" y2="${f(-b[1])}"/>`)
    } else if (c.kind === 'circle') {
      const ctr = pointPos(s, c.c)
      if (!ctr) continue
      grow(ctr[0], ctr[1], c.r)
      parts.push(`<circle cx="${f(ctr[0])}" cy="${f(-ctr[1])}" r="${f(c.r)}"/>`)
    } else if (c.kind === 'spline') {
      const pts = splinePoints(s, c)
      if (pts.length < 2) continue
      for (const q of pts) grow(q[0], q[1])
      parts.push(`<polyline points="${pts.map((q) => `${f(q[0])},${f(-q[1])}`).join(' ')}"/>`)
    } else {
      const a = arcAngles(s, c)
      if (!a) continue
      const p = [a.c[0] + a.r * Math.cos(a.sa), a.c[1] + a.r * Math.sin(a.sa)]
      const q = [a.c[0] + a.r * Math.cos(a.ea), a.c[1] + a.r * Math.sin(a.ea)]
      grow(a.c[0], a.c[1], a.r)
      const large = a.ea - a.sa > Math.PI ? 1 : 0
      // Y is flipped, so the arc still looks counter-clockwise on screen: sweep flag 0
      parts.push(
        `<path d="M ${f(p[0])} ${f(-p[1])} A ${f(a.r)} ${f(a.r)} 0 ${large} 0 ${f(q[0])} ${f(-q[1])}"/>`
      )
    }
  }
  if (!parts.length) {
    x0 = y0 = 0
    x1 = y1 = 1
  }
  const m = 2
  const w = x1 - x0 + 2 * m
  const h = y1 - y0 + 2 * m
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(w)}mm" height="${f(h)}mm" viewBox="${f(x0 - m)} ${f(-y1 - m)} ${f(w)} ${f(h)}">`,
    '<g fill="none" stroke="#000000" stroke-width="0.3" stroke-linecap="round">',
    ...parts,
    '</g>',
    '</svg>',
    ''
  ].join('\n')
}
