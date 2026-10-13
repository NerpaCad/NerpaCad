/**
 * Geometry of the parametric parts (see core/doc/parts.ts). Each builder returns a manifold in
 * real millimetres, standing on z = 0 the way it is best printed; the engine centres it.
 *
 * Threads: a single-start thread is a cross-section whose radius changes with the angle (one
 * tooth per turn), extruded with a twist of one turn per pitch: every horizontal slice is the
 * same outline, turned. That gives a true helix with no sweeping maths.
 */
import type { CrossSection, Manifold, ManifoldToplevel, Vec2 } from 'manifold-3d'
import type { Font } from 'opentype.js'
import { METRIC, type PartType, type PartValue, type PartValues, jarNeck, jarPitch } from '../doc/parts'
import { textContours } from './text'

type Obj = Manifold | CrossSection

/** Collects the intermediate objects of a build and frees them all except the result. */
class Bin {
  private all: Obj[] = []
  k<T extends Obj>(o: T): T {
    this.all.push(o)
    return o
  }
  done(result: Manifold): Manifold {
    for (const o of this.all) if (o !== result) o.delete()
    this.all = []
    return result
  }
}

/** ISO metric thread: depth of an external thread for a pitch */
const threadDepth = (pitch: number) => 0.6134 * pitch

/** The tooth profile over one pitch (u in 0…1): 0 at the root, 1 at the crest. */
function tooth(u: number): number {
  u -= Math.floor(u)
  if (u < 1 / 8 || u >= 7 / 8) return 0
  if (u < 7 / 16) return (u - 1 / 8) / (5 / 16)
  if (u < 9 / 16) return 1
  return 1 - (u - 9 / 16) / (5 / 16)
}

/** The slice of a thread at z = 0: radius by angle (counter-clockwise points). */
export function threadOutline(major: number, pitch: number, steps = 96): Vec2[] {
  const h = threadDepth(pitch)
  const minor = major - h
  // the corners of the tooth are points of their own, so the flanks, the crest and the root
  // come out as clean faces (sampled only evenly, they shade with speckles)
  const turns = new Set<number>()
  for (let i = 0; i < steps; i++) turns.add(i / steps)
  for (const u of [1 / 8, 7 / 16, 9 / 16, 7 / 8]) turns.add(1 - u)
  const fr = [...turns].sort((a, b) => a - b).filter((f, i, all) => i === 0 || f - all[i - 1] > 1e-4)
  return fr.map((f) => {
    const a = f * Math.PI * 2
    // right-hand thread: the crest climbs counter-clockwise
    const r = minor + h * tooth(-f)
    return [r * Math.cos(a), r * Math.sin(a)] as Vec2
  })
}

export class PartBuilder {
  constructor(
    private w: ManifoldToplevel,
    private font: Font | null
  ) {}

  build(type: PartType, v: PartValues): Manifold {
    switch (type) {
      case 'bolt':
        return this.bolt(v)
      case 'nut':
        return this.nut(v)
      case 'jar':
        return v.piece === 'lid' ? this.jarLid(v) : this.jarBody(v)
      case 'rack':
        return this.rack(v)
      case 'wheel':
        return this.wheel(v)
      case 'pulley':
        return this.pulley(v)
      case 'washer':
        return this.washer(v)
      case 'spring':
        return this.spring(v)
      case 'boxLid':
        return v.piece === 'lid' ? this.boxLid(v) : this.boxBody(v)
      case 'hinge':
        return this.hinge(v)
      case 'knob':
        return this.knob(v)
      case 'tag':
        return this.tag(v)
      default:
        return this.extra(type, v)
    }
  }

  /** Builders added in later stages. */
  protected extra(_type: PartType, _v: PartValues): Manifold {
    return this.w.Manifold.cube([1, 1, 1])
  }

  // ---------------------------------------------------------------- shared pieces

  /** A threaded rod from z = 0 to `length`, crests at radius `major`. */
  protected threadRod(b: Bin, major: number, pitch: number, length: number): Manifold {
    const { CrossSection } = this.w
    // finer for bigger threads: a small one needs fewer points for the same smoothness
    const steps = major < 7 ? 48 : 64
    const cs = b.k(new CrossSection([threadOutline(major, pitch, steps)], 'Positive'))
    const turns = length / pitch
    // slices as close as the outline's points: square little faces shade smoothly
    return b.k(cs.extrude(length, Math.max(2, Math.ceil(turns * steps)), 360 * turns))
  }

  /** A solid of revolution around Z from (radius, z) points. */
  protected revolve(b: Bin, pts: Vec2[], segments = 64): Manifold {
    const cs = b.k(new this.w.CrossSection([pts], 'Positive'))
    return b.k(cs.revolve(segments))
  }

  /** A hexagonal prism (`flats` across the flat sides), its edges bevelled at 30° like a real nut. */
  protected hexPrism(b: Bin, flats: number, height: number, bevelTop: boolean, bevelBottom: boolean): Manifold {
    const R = flats / Math.sqrt(3)
    const hex = b.k(this.w.Manifold.cylinder(height, R, R, 6).rotate([0, 0, 30]))
    const c = (R - flats / 2) * Math.tan(Math.PI / 6) * 1.6
    const r0 = flats / 2
    const r1 = R + 0.01
    const pts: Vec2[] = [
      [0, 0],
      [bevelBottom ? r0 : r1, 0],
      [r1, bevelBottom ? c * 1.2 : 0],
      [r1, bevelTop ? height - c * 1.2 : height],
      [bevelTop ? r0 : r1, height],
      [0, height]
    ]
    return b.k(hex.intersect(this.revolve(b, pts, 48)))
  }

  /** A cone that opens the start of a threaded hole (so the screw finds its way in). */
  protected entry(b: Bin, major: number, pitch: number, z: number, up: boolean): Manifold {
    const h = threadDepth(pitch)
    const r0 = major + 0.3
    const r1 = major - h - 0.2
    const d = r0 - r1
    const pts: Vec2[] = up
      ? [
          [0, z - 0.01],
          [r0, z - 0.01],
          [r1, z + d],
          [0, z + d]
        ]
      : [
          [0, z - d],
          [r1, z - d],
          [r0, z + 0.01],
          [0, z + 0.01]
        ]
    return this.revolve(b, pts, 48)
  }

  // ---------------------------------------------------------------- bolt and nut

  /** A bolt standing on its head (the way it prints best), the thread up. */
  private bolt(v: PartValues): Manifold {
    const b = new Bin()
    const { Manifold } = this.w
    const m = METRIC[v.size as string]
    const length = v.length as number
    const major = m.d / 2 - (v.clearance as number) / 2
    const h = threadDepth(m.pitch)
    let head: Manifold | null = null
    let hz = 0
    switch (v.head) {
      case 'hex':
        head = this.hexPrism(b, m.flats, m.head, true, false)
        hz = m.head
        break
      case 'round': {
        // a pan head with a rounded top edge (which lies on the bed: the edge faces up)
        const R = m.d * 0.9
        const k = m.head * 0.9
        head = this.revolve(b, [
          [0, 0],
          [R, 0],
          [R, k * 0.6],
          [R * 0.75, k],
          [0, k]
        ])
        hz = k
        break
      }
      case 'countersunk': {
        // 90°: flat top on the bed, the cone narrowing up to the shank
        const R = m.d
        hz = R - m.d / 2 + 0.6
        head = this.revolve(b, [
          [0, 0],
          [R, 0],
          [R, 0.6],
          [m.d / 2 - 0.05, hz],
          [0, hz]
        ])
        break
      }
    }
    // the rod starts a little inside the head, so the two are one solid
    const ov = head ? 0.3 : 0
    let rod = this.threadRod(b, major, m.pitch, length + ov)
    // a 45° chamfer at the tip
    const c = h + 0.4
    const top = length + ov
    const tip = this.revolve(b, [
      [0, 0],
      [major + 1, 0],
      [major + 1, top - c - 1],
      [major - c, top],
      [0, top]
    ])
    rod = b.k(rod.intersect(tip))
    let out = b.k(rod.translate([0, 0, hz - ov]))
    if (head) out = b.k(out.add(head))
    void Manifold
    return b.done(out)
  }

  private nut(v: PartValues): Manifold {
    const b = new Bin()
    const { Manifold, CrossSection } = this.w
    const m = METRIC[v.size as string]
    const major = m.d / 2 + (v.clearance as number) / 2
    const H = m.nut
    let body: Manifold
    switch (v.style) {
      case 'wing': {
        // a round boss with two wings to turn it by hand
        const boss = b.k(Manifold.cylinder(H, m.d * 0.95, m.d * 0.95, 48))
        const t = Math.max(1.6, m.d * 0.35) / 2
        const wingH = H * 1.9
        const x0 = m.d * 0.7
        const x1 = m.d * 2.1
        const wing = b.k(
          Manifold.hull([
            [x0, -t, 0],
            [x1, -t, 0],
            [x0, t, 0],
            [x1, t, 0],
            [x0, -t, wingH],
            [x0 + (x1 - x0) * 0.75, -t, wingH],
            [x0, t, wingH],
            [x0 + (x1 - x0) * 0.75, t, wingH]
          ])
        )
        const other = b.k(wing.rotate([0, 0, 180]))
        body = b.k(b.k(boss.add(wing)).add(other))
        break
      }
      case 'knurled': {
        // a round nut with ridges for the fingers
        const R = m.flats * 0.62
        const ridges = Math.max(12, Math.round(R * 2.2))
        const pts: Vec2[] = []
        const N = ridges * 8
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2
          const r = R - 0.5 * (1 - Math.cos(a * ridges)) * Math.min(1, R * 0.08)
          pts.push([r * Math.cos(a), r * Math.sin(a)])
        }
        const cs = b.k(new CrossSection([pts], 'Positive'))
        body = b.k(cs.extrude(H))
        break
      }
      default:
        body = this.hexPrism(b, m.flats, H, true, true)
    }
    const hole = b.k(this.threadRod(b, major, m.pitch, H + 2).translate([0, 0, -1]))
    let out = b.k(body.subtract(hole))
    out = b.k(out.subtract(this.entry(b, major, m.pitch, 0, true)))
    out = b.k(out.subtract(this.entry(b, major, m.pitch, H, false)))
    return b.done(out)
  }

  // ---------------------------------------------------------------- jar with a screw lid

  /** Sizes shared by the jar and its lid. */
  private jarSizes(v: PartValues) {
    const D = v.diameter as number
    const w = v.wall as number
    const R = D / 2
    const P = jarPitch(D)
    const h = threadDepth(P)
    const neck = jarNeck(D)
    const lidMajor = R - w // crests of the lid's inner thread
    const jarMajor = lidMajor - (v.clearance as number) // crests of the jar's outer thread
    const inner = Math.max(2, jarMajor - h - w) // the opening
    return { D, w, R, P, h, neck, lidMajor, jarMajor, inner }
  }

  private jarBody(v: PartValues): Manifold {
    const b = new Bin()
    const { R, w, P, neck, jarMajor, inner } = this.jarSizes(v)
    const H = v.height as number
    const bodyH = H - neck
    const body = b.k(this.w.Manifold.cylinder(bodyH, R, R, 96))
    // the thread starts a little inside the body, so the two are one solid
    const thread = this.threadRod(b, jarMajor, P, neck + 0.3)
    let out = b.k(body.add(b.k(thread.translate([0, 0, bodyH - 0.3]))))
    // inside: the wide cavity with a 45° shoulder up to the opening (prints without supports)
    const cav = R - w
    const shoulderTop = bodyH - w
    const shoulderLow = Math.max(w + 1, shoulderTop - (cav - inner))
    const hollow = this.revolve(
      b,
      [
        [0, w],
        [cav, w],
        [cav, shoulderLow],
        [inner, shoulderLow + (cav - inner)],
        [inner, H + 1],
        [0, H + 1]
      ],
      96
    )
    out = b.k(out.subtract(hollow))
    return b.done(out)
  }

  /** The lid prints upside down: its top on the bed, the threaded skirt up. */
  private jarLid(v: PartValues): Manifold {
    const b = new Bin()
    const { CrossSection } = this.w
    const { R, w, P, neck, lidMajor } = this.jarSizes(v)
    const H = w + neck + 0.6
    // ridges outside for a good grip
    const ridges = Math.round(R * 1.2)
    const N = ridges * 6
    const pts: Vec2[] = []
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2
      const r = R - 0.35 * (1 - Math.cos(a * ridges))
      pts.push([r * Math.cos(a), r * Math.sin(a)])
    }
    const outer = b.k(b.k(new CrossSection([pts], 'Positive')).extrude(H))
    const thread = b.k(this.threadRod(b, lidMajor, P, H - w + 1).translate([0, 0, w]))
    let out = b.k(outer.subtract(thread))
    out = b.k(out.subtract(this.entry(b, lidMajor, P, H, false)))
    return b.done(out)
  }

  // ---------------------------------------------------------------- rack, wheel, pulley, washer, spring

  /** A straight rack that meshes with a gear of the same module (20° teeth), lying flat. */
  private rack(v: PartValues): Manifold {
    const b = new Bin()
    const m = v.module as number
    const N = v.teeth as number
    const p = Math.PI * m
    const tan = Math.tan((20 * Math.PI) / 180)
    const top = p / 2 - 2 * m * tan // tooth width at the tip
    const bottom = p / 2 + 2 * 1.25 * m * tan // and at the root
    const root = -1.25 * m
    const yb = root - (v.base as number)
    const L = N * p
    const pts: Vec2[] = [
      [0, yb],
      [L, yb],
      [L, root]
    ]
    for (let i = N - 1; i >= 0; i--) {
      const xc = (i + 0.5) * p
      pts.push([xc + bottom / 2, root], [xc + top / 2, m], [xc - top / 2, m], [xc - bottom / 2, root])
    }
    pts.push([0, root])
    const cs = b.k(new this.w.CrossSection([pts], 'Positive'))
    return b.done(b.k(cs.extrude(v.thickness as number)))
  }

  /** A shaft hole: round, or with one flat side (the D-shaped shafts of small motors). */
  private bore(b: Bin, d: number, shape: PartValue, height: number): Manifold | null {
    if (d <= 0) return null
    const r = d / 2
    let cs = b.k(this.w.CrossSection.circle(r, 48))
    if (shape === 'd') cs = b.k(cs.intersect(b.k(this.w.CrossSection.square([d * 2, d * 2], true).translate([-d + r * 0.7, 0]))))
    return b.k(b.k(cs.extrude(height + 2)).translate([0, 0, -1]))
  }

  /** A wheel lying flat: rim with a groove for a rubber band, a thin disc, a hub with the shaft hole. */
  private wheel(v: PartValues): Manifold {
    const b = new Bin()
    const R = (v.diameter as number) / 2
    const W = v.width as number
    const boreD = v.bore as number
    const rh = Math.min(R * 0.45, Math.max(boreD / 2 + 3, R * 0.18)) // hub
    const rim = Math.max(2.5, R * 0.12) // rim ring thickness
    const rimIn = Math.max(rh + 1, R - rim)
    const web = Math.min(W, Math.max(2, W * 0.4)) // the disc, on the bed
    const pts: Vec2[] = [
      [0, 0],
      [R, 0]
    ]
    if (v.groove) {
      // a round channel in the middle of the rim for an o-ring or a rubber band
      const g = Math.min(rim * 0.6, W * 0.3, 2.5)
      pts.push([R, W / 2 - g])
      for (let i = 1; i < 12; i++) {
        const a = (i / 12) * Math.PI
        pts.push([R - g * Math.sin(a), W / 2 - g * Math.cos(a)])
      }
      pts.push([R, W / 2 + g])
    }
    pts.push([R, W], [rimIn, W], [rimIn, web], [rh, web], [rh, W], [0, W])
    let out = this.revolve(b, pts, 96)
    const holes = v.holes as number
    if (holes > 0 && rimIn - rh > 6) {
      // round windows in the disc: lighter and quicker to print
      const rc = (rimIn + rh) / 2
      const rr = Math.min(((rimIn - rh) / 2) * 0.7, rc * Math.sin(Math.PI / holes) * 0.75)
      if (rr > 1) {
        for (let i = 0; i < holes; i++) {
          const a = (i / holes) * Math.PI * 2
          const c = b.k(b.k(this.w.Manifold.cylinder(W + 2, rr, rr, 32)).translate([rc * Math.cos(a), rc * Math.sin(a), -1]))
          out = b.k(out.subtract(c))
        }
      }
    }
    const hole = this.bore(b, boreD, v.boreShape, W)
    if (hole) out = b.k(out.subtract(hole))
    return b.done(out)
  }

  /** A pulley lying flat: a groove for a round belt (an o-ring, a rubber band) or a V-belt between two flanges. */
  private pulley(v: PartValues): Manifold {
    const b = new Bin()
    const R0 = (v.diameter as number) / 2 // the bottom of the groove
    const s = v.beltSize as number
    const pts: Vec2[] = [[0, 0]]
    let W: number
    if (v.belt === 'v') {
      const depth = s
      const tw = s * 0.6 + 0.2
      const bw = Math.max(0.3, tw - depth * Math.tan((20 * Math.PI) / 180))
      const fl = Math.max(1.2, s * 0.35)
      const Rf = R0 + depth
      W = 2 * tw + 2 * fl
      pts.push([Rf, 0], [Rf, fl], [R0, fl + (tw - bw)], [R0, W - fl - (tw - bw)], [Rf, W - fl], [Rf, W])
    } else {
      const rb = s / 2 + 0.2
      const fl = Math.max(1.2, s * 0.35)
      const Rf = R0 + rb * 1.6
      W = 2 * rb + 2 * fl
      pts.push([Rf, 0], [Rf, fl])
      for (let i = 0; i <= 12; i++) {
        const a = (i / 12) * Math.PI
        pts.push([R0 + rb - rb * Math.sin(a), W / 2 - rb * Math.cos(a)])
      }
      pts.push([Rf, W - fl], [Rf, W])
    }
    pts.push([0, W])
    let out = this.revolve(b, pts, 96)
    const hole = this.bore(b, v.bore as number, v.boreShape, W)
    if (hole) out = b.k(out.subtract(hole))
    return b.done(out)
  }

  private washer(v: PartValues): Manifold {
    const b = new Bin()
    const ro = (v.outer as number) / 2
    const ri = (v.inner as number) / 2
    const h = v.height as number
    const pts: Vec2[] = ri > 0.05 ? [[ri, 0], [ro, 0], [ro, h], [ri, h]] : [[0, 0], [ro, 0], [ro, h], [0, h]]
    return b.done(this.revolve(b, pts, 96))
  }

  /**
   * A coil spring standing up. The slice of a round wire wound on a helix, cut flat, is a thin
   * curved lens; twisted one turn per pitch it becomes the coil. Closed ends: flat rings on top
   * and at the bottom so it stands and prints.
   */
  private spring(v: PartValues): Manifold {
    const b = new Bin()
    const d = v.wire as number
    const R = (v.diameter as number) / 2 - d / 2
    const p = v.pitch as number
    const turns = v.turns as number
    const H = turns * p
    const h = d * Math.sqrt(1 + (p / (2 * Math.PI * R)) ** 2) // the wire's height, cut upright
    const k = 16
    const upper: Vec2[] = []
    const lower: Vec2[] = []
    for (let i = 0; i <= k; i++) {
      const r = R - d / 2 + (d * i) / k
      const t = (r - R) / (d / 2)
      const half = ((2 * Math.PI) / p) * (h / 2) * Math.sqrt(Math.max(0, 1 - t * t))
      upper.push([r * Math.cos(half), r * Math.sin(half)])
      if (i > 0 && i < k) lower.push([r * Math.cos(-half), r * Math.sin(-half)])
    }
    const lens = b.k(new this.w.CrossSection([[...lower, ...upper.reverse()]], 'Positive'))
    let out = b.k(lens.extrude(H, Math.max(2, Math.ceil(turns * 32)), 360 * turns))
    if (v.ends) {
      const ring = (z: number) =>
        this.revolve(
          b,
          [
            [R - d / 2, z],
            [R + d / 2, z],
            [R + d / 2, z + d / 2],
            [R - d / 2, z + d / 2]
          ],
          64
        )
      out = b.k(b.k(out.add(ring(0))).add(ring(H - d / 2)))
    }
    return b.done(out)
  }

  // ---------------------------------------------------------------- box with a lid

  /** A rectangle with rounded corners, centred. */
  private rounded(b: Bin, w: number, d: number, r: number): CrossSection {
    const rr = Math.max(0, Math.min(r, w / 2 - 0.01, d / 2 - 0.01))
    const sq = b.k(this.w.CrossSection.square([w - 2 * rr, d - 2 * rr], true))
    return rr > 0 ? b.k(sq.offset(rr, 'Round', 2, 32)) : sq
  }

  private boxSizes(v: PartValues) {
    const W = v.width as number
    const D = v.depth as number
    const H = v.height as number
    const t = v.wall as number
    const c = v.clearance as number
    const r = Math.min(3, t * 1.5)
    // the sliding lid: as thick as the wall, in grooves half a wall deep, under a lip
    const L = Math.max(1.2, t)
    const lip = Math.max(0.8, t * 0.6)
    return { W, D, H, t, c, r, L, lip }
  }

  private boxBody(v: PartValues): Manifold {
    const b = new Bin()
    const { W, D, H, t, r, L, lip, c } = this.boxSizes(v)
    let out = b.k(this.rounded(b, W, D, r).extrude(H))
    const inside = b.k(b.k(this.rounded(b, W - 2 * t, D - 2 * t, Math.max(0, r - t)).extrude(H)).translate([0, 0, t]))
    out = b.k(out.subtract(inside))
    if (v.style === 'slide') {
      const { Manifold } = this.w
      const g1 = H - lip
      const g0 = g1 - L - c
      // grooves in the side walls and the back, open at the front
      const gw = W - t
      const gd = D - t / 2 + 1
      const groove = b.k(b.k(Manifold.cube([gw, gd, g1 - g0])).translate([-gw / 2, -D / 2 - 1, g0]))
      // and the front wall lowered to the groove, so the lid slides in
      const front = b.k(b.k(Manifold.cube([W - 2 * t, t + 2, H - g0 + 1])).translate([-(W - 2 * t) / 2, -D / 2 - 1, g0]))
      out = b.k(b.k(out.subtract(groove)).subtract(front))
    }
    return b.done(out)
  }

  /** The lid prints flat, its inside up. */
  private boxLid(v: PartValues): Manifold {
    const b = new Bin()
    const { W, D, H, t, c, r, L } = this.boxSizes(v)
    const { Manifold } = this.w
    if (v.style === 'slide') {
      const lw = W - t - 2 * c
      const ld = D - t / 2 - c
      let lid = b.k(b.k(Manifold.cube([lw, ld, L - c])).translate([-lw / 2, -D / 2, 0]))
      // a groove near the front edge to push it with a finger
      const nr = Math.min(4, ld * 0.08)
      const notch = b.k(b.k(b.k(Manifold.cylinder(lw * 0.5, nr, nr, 32, true)).rotate([0, 90, 0])).translate([0, -D / 2 + nr * 2.2, L - c + nr * 0.5]))
      lid = b.k(lid.subtract(notch))
      return b.done(lid)
    }
    // a cap: a plate and a rim that fits inside the box
    const plate = b.k(this.rounded(b, W, D, r).extrude(t))
    const rimH = Math.min(8, H * 0.3) + 0.2
    const ow = W - 2 * t - 2 * c
    const od = D - 2 * t - 2 * c
    const rim = b.k(
      b.k(this.rounded(b, ow, od, Math.max(0, r - t - c)).subtract(this.rounded(b, ow - 2 * t, od - 2 * t, Math.max(0, r - 2 * t - c)))).extrude(rimH)
    )
    return b.done(b.k(plate.add(b.k(rim.translate([0, 0, t - 0.2])))))
  }

  // ---------------------------------------------------------------- hinge, knob, tag

  /**
   * A hinge printed in one go, already assembled: two leaves lying flat, their knuckles taking
   * turns along a pin. The pin belongs to the leaf with the outer knuckles; the other leaf's
   * knuckles go round it with a gap, so it turns as soon as it comes off the printer.
   */
  private hinge(v: PartValues): Manifold {
    const b = new Bin()
    const { Manifold } = this.w
    const L = v.length as number
    const W = v.width as number
    const t = v.thickness as number
    const c = v.clearance as number
    const k = v.knuckles as number
    const Rk = Math.max(t, 2.4)
    const rp = Math.max(0.8, Rk * 0.5 - c / 2)
    const seg = (L - (k - 1) * c) / k
    const along = (r: number, x0: number, len: number) =>
      b.k(b.k(b.k(Manifold.cylinder(len, r, r, 40)).rotate([0, 90, 0])).translate([x0, 0, Rk]))
    const box = (x0: number, len: number, y0: number, y1: number) => b.k(b.k(Manifold.cube([len, y1 - y0, t])).translate([x0, y0, 0]))
    const reach = Rk + c
    let a = box(-L / 2, L, -Math.max(W, reach + 2), -reach)
    let bb = box(-L / 2, L, reach, Math.max(W, reach + 2))
    for (let i = 0; i < k; i++) {
      const x0 = -L / 2 + i * (seg + c)
      if (i % 2 === 0) {
        a = b.k(a.add(along(Rk, x0, seg)))
        a = b.k(a.add(box(x0, seg, -reach - 0.5, 0)))
      } else {
        const ring = b.k(along(Rk, x0, seg).subtract(along(rp + c, x0 - 1, seg + 2)))
        bb = b.k(bb.add(ring))
        bb = b.k(bb.add(b.k(box(x0, seg, 0, reach + 0.5).subtract(along(rp + c, x0 - 1, seg + 2)))))
      }
    }
    a = b.k(a.add(along(rp, -L / 2, L)))
    return b.done(b.k(a.add(bb)))
  }

  /** A knob to turn a bolt by hand: a nut pressed into a pocket underneath, the bolt through. */
  private knob(v: PartValues): Manifold {
    const b = new Bin()
    const { CrossSection, Manifold } = this.w
    const m = METRIC[v.size as string]
    const c = v.clearance as number
    const R = (v.diameter as number) / 2
    const H = v.height as number
    let cs: CrossSection
    if (v.grip === 'star') {
      const n = v.lobes as number
      const rl = Math.min(R * 0.32, R * Math.sin(Math.PI / n) * 0.9)
      cs = b.k(CrossSection.circle(R - rl * 0.9, 64))
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2
        cs = b.k(cs.add(b.k(b.k(CrossSection.circle(rl, 32)).translate([(R - rl) * Math.cos(a), (R - rl) * Math.sin(a)]))))
      }
    } else {
      const ridges = Math.max(12, Math.round(R * 1.4))
      const N = ridges * 6
      const pts: Vec2[] = []
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2
        const r = R - 0.5 * (1 - Math.cos(a * ridges))
        pts.push([r * Math.cos(a), r * Math.sin(a)])
      }
      cs = b.k(new CrossSection([pts], 'Positive'))
    }
    let out = b.k(cs.extrude(H))
    // the nut pocket from below (it opens on the bed), the bolt hole through
    const hexR = m.flats / Math.sqrt(3) + c
    const pocket = b.k(b.k(b.k(Manifold.cylinder(m.nut + 0.2, hexR, hexR, 6)).rotate([0, 0, 30])).translate([0, 0, -0.01]))
    const hole = b.k(b.k(Manifold.cylinder(H + 2, m.d / 2 + c, m.d / 2 + c, 48)).translate([0, 0, -1]))
    out = b.k(b.k(out.subtract(pocket)).subtract(hole))
    return b.done(out)
  }

  /** A flat tag with raised letters and a hole for a key ring. */
  private tag(v: PartValues): Manifold {
    const b = new Bin()
    const size = v.letter as number
    const T = v.thickness as number
    const text = this.textShape(b, String(v.text), size)
    const pad = size * 0.5
    const holeR = v.hole ? Math.max(1.5, size * 0.28) : 0
    let tw = size * 2
    let tx = 0
    let ty = 0
    if (text) {
      const bb = text.bounds()
      tw = bb.max[0] - bb.min[0]
      tx = -bb.min[0]
      ty = -(bb.min[1] + bb.max[1]) / 2
    }
    const hw = v.hole ? holeR * 2 + pad : 0
    const W = tw + 2 * pad + hw
    const Hh = size * 1.7
    let plate = b.k(b.k(this.rounded(b, W, Hh, Math.min(Hh / 2, size * 0.6)).extrude(T)).translate([0, 0, 0]))
    const x0 = -W / 2 + hw + pad
    if (v.hole) {
      const hc = -W / 2 + pad * 0.6 + holeR
      const hole = b.k(b.k(this.w.Manifold.cylinder(T + 2, holeR, holeR, 32)).translate([hc, 0, -1]))
      plate = b.k(plate.subtract(hole))
    }
    if (text) {
      // the letters start a little inside the plate, so all is one solid
      const letters = b.k(b.k(text.translate([x0 + tx, ty])).extrude((v.raise as number) + 0.2))
      plate = b.k(plate.add(b.k(letters.translate([0, 0, T - 0.2]))))
    }
    return b.done(plate)
  }

  // ---------------------------------------------------------------- helpers for later stages

  protected textShape(b: Bin, text: string, size: number): CrossSection | null {
    if (!this.font || !text.trim()) return null
    const contours = textContours(this.font, text, size)
    if (!contours.length) return null
    return b.k(new this.w.CrossSection(contours, 'NonZero'))
  }
}

export { Bin }
