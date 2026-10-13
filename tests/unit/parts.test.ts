import { beforeAll, describe, expect, it } from 'vitest'
import Module, { type ManifoldToplevel } from 'manifold-3d'
import { METRIC, PARTS, PART_TYPES, clampPart, jarNeck, jarPitch, partDefaults } from '@/core/doc/parts'
import { PartBuilder, threadOutline } from '@/core/geom/parts'
import { getEngine, prim } from './helpers'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import { emptyDoc } from '@/core/doc/model'
import { createShape } from '@/core/doc/shapes'

let w: ManifoldToplevel
let parts: PartBuilder
beforeAll(async () => {
  w = await Module()
  w.setup()
  parts = new PartBuilder(w, null)
})

const vol = (m: { volume(): number }) => m.volume()

describe('part values', () => {
  it('defaults fill every field; nonsense is clamped or replaced', () => {
    for (const t of PART_TYPES) {
      const v = partDefaults(t)
      expect(Object.keys(v).sort()).toEqual(Object.keys(PARTS[t].fields).sort())
    }
    const v = clampPart('bolt', { size: 'M99', length: -5, head: 'star', clearance: 'x', extra: 1 })
    expect(v).toEqual({ size: 'M8', length: 4, head: 'hex', clearance: 0.2 })
    expect(clampPart('jar', { diameter: 60, height: 10 }).height).toBeGreaterThan(jarNeck(60))
  })

  it('parts are saved and loaded with their values', () => {
    const b = createShape('bolt', 'B', [0, 0, 0])
    b.params = { part: { ...b.params.part!, size: 'M12', length: 40 } }
    const d = { ...emptyDoc(), nodes: [b] }
    const back = parseDoc(serializeDoc(d)).nodes[0] as typeof b
    expect(back.params.part).toEqual(clampPart('bolt', { size: 'M12', length: 40 }))
  })
})

describe('threads', () => {
  it('the thread slice goes from the root to the crest once per turn', () => {
    const pts = threadOutline(4, 1.25)
    const r = pts.map(([x, y]) => Math.hypot(x, y))
    expect(Math.max(...r)).toBeCloseTo(4, 2)
    expect(Math.min(...r)).toBeCloseTo(4 - 0.6134 * 1.25, 2)
  })

  it('an M8 bolt and nut: closed solids that screw together, and only when the thread lines up', () => {
    const m = METRIC.M8
    const bolt = parts.build('bolt', clampPart('bolt', { size: 'M8', length: 20, head: 'none', clearance: 0.2 }))
    const nut = parts.build('nut', clampPart('nut', { size: 'M8', clearance: 0.2 }))
    expect(bolt.status()).toBe('NoError')
    expect(nut.status()).toBe('NoError')
    expect(bolt.genus()).toBe(0)
    expect(nut.genus()).toBe(1) // a ring
    // the nut's thread starts 1 mm below its base: on the bolt (thread from z = 0) it lines up at 1 + k·pitch
    const meet = (z: number) => {
      const placed = nut.translate([0, 0, z])
      const both = bolt.intersect(placed)
      const v = vol(both)
      placed.delete()
      both.delete()
      return v
    }
    const fit = meet(1 + 4 * m.pitch)
    const clash = meet(1 + 4 * m.pitch + m.pitch / 2)
    expect(fit).toBeLessThan(0.5)
    expect(clash).toBeGreaterThan(10)
    bolt.delete()
    nut.delete()
  })

  it('a right-hand thread: going up, the crest turns counter-clockwise', () => {
    const rod = parts.build('bolt', clampPart('bolt', { size: 'M20', length: 30, head: 'none', clearance: 0 }))
    const m = METRIC.M20
    const mesh = rod.getMesh()
    // angle of the crest at two heights a quarter pitch apart
    const crestAngle = (z: number) => {
      let best = -1
      let ang = 0
      for (let i = 0; i < mesh.vertProperties.length; i += mesh.numProp) {
        const [x, y, vz] = [mesh.vertProperties[i], mesh.vertProperties[i + 1], mesh.vertProperties[i + 2]]
        if (Math.abs(vz - z) > 0.05) continue
        const r = Math.hypot(x, y)
        if (r > best) {
          best = r
          ang = Math.atan2(y, x)
        }
      }
      return ang
    }
    let d = crestAngle(10 + m.pitch / 4) - crestAngle(10)
    d = Math.atan2(Math.sin(d), Math.cos(d))
    expect(d).toBeGreaterThan(Math.PI / 4)
    expect(d).toBeLessThan((3 * Math.PI) / 4)
    rod.delete()
  })

  it('a jar and its lid screw together', () => {
    const v = clampPart('jar', { diameter: 60, height: 50, wall: 2, clearance: 0.4 })
    const body = parts.build('jar', { ...v, piece: 'body' })
    const lid = parts.build('jar', { ...v, piece: 'lid' })
    expect(body.status()).toBe('NoError')
    expect(lid.status()).toBe('NoError')
    expect(body.boundingBox().max[2]).toBeCloseTo(50, 3)
    expect(body.boundingBox().max[0]).toBeCloseTo(30, 1)
    expect(lid.boundingBox().max[0]).toBeCloseTo(30, 1)
    // a hollow jar holds something
    expect(vol(body)).toBeLessThan(Math.PI * 30 * 30 * 50 * 0.5)
    // the lid turned over and put on the neck: its thread (from z = wall, upside down) lines up
    // with the jar's (from z = height − neck) for some turn of the lid, and then they do not clash
    const P = jarPitch(60)
    const neck = jarNeck(60)
    const H = 2 + neck + 0.6
    let best = Infinity
    let worst = 0
    for (let k = 0; k < 12; k++) {
      // flip the lid (top up), set it on the jar so its top is just above the neck, turn it
      const flipped = lid.rotate([180, 0, 0])
      const turned = flipped.rotate([0, 0, (k * 360) / 12])
      const placed = turned.translate([0, 0, 50 - neck + H + 0.1])
      const both = body.intersect(placed)
      best = Math.min(best, vol(both))
      worst = Math.max(worst, vol(both))
      ;[flipped, turned, placed, both].forEach((x) => x.delete())
    }
    void P
    expect(best).toBeLessThan(2)
    // turned wrong, they do clash: the threads really hold each other
    expect(worst).toBeGreaterThan(20)

    body.delete()
    lid.delete()
  })
})

describe('parts in the engine', () => {
  it.each(['bolt', 'nut', 'jar'] as const)('%s builds through the document', async (t) => {
    const e = await getEngine()
    const r = e.evaluate(prim(t, { params: { part: partDefaults(t) } }))
    expect(r.volume).toBeGreaterThan(10)
    expect(r.box.min[2]).toBeCloseTo(0, 6)
  })

  it('every head and nut style builds', async () => {
    for (const head of ['hex', 'round', 'countersunk', 'none']) {
      const m = parts.build('bolt', clampPart('bolt', { head, size: 'M10' }))
      expect(m.status(), head).toBe('NoError')
      expect(vol(m)).toBeGreaterThan(100)
      m.delete()
    }
    for (const style of ['hex', 'wing', 'knurled']) {
      const m = parts.build('nut', clampPart('nut', { style, size: 'M6' }))
      expect(m.status(), style).toBe('NoError')
      expect(m.genus(), style).toBe(1)
      m.delete()
    }
  })
})

describe('stage 2: rack, wheel, pulley, washer, spring', () => {
  it('a rack meshes with a gear of the same module', async () => {
    const { gearOutline, clampGear } = await import('@/core/doc/gear')
    const rack = parts.build('rack', clampPart('rack', { module: 2, teeth: 12, thickness: 6, base: 4 }))
    expect(rack.status()).toBe('NoError')
    const L = 12 * Math.PI * 2
    expect(rack.boundingBox().max[0]).toBeCloseTo(L, 3)
    expect(rack.boundingBox().max[1]).toBeCloseTo(2, 3) // the tips: one module above the pitch line
    const g = clampGear({ teeth: 16, module: 2, thickness: 6, bore: 0 })
    const cs = new w.CrossSection([gearOutline(g)], 'Positive')
    const gear = cs.extrude(6)
    const rp = 16
    let best = Infinity
    let worst = 0
    for (let k = 0; k < 24; k++) {
      const placed = gear.rotate([0, 0, (k * 360) / 16 / 24]).translate([L / 2, rp, 0])
      const both = rack.intersect(placed)
      best = Math.min(best, both.volume())
      worst = Math.max(worst, both.volume())
      placed.delete()
      both.delete()
    }
    expect(best).toBeLessThan(1)
    expect(worst).toBeGreaterThan(5)
    ;[rack, cs, gear].forEach((x) => x.delete())
  })

  it('wheels and pulleys: sizes, shaft holes, windows', () => {
    const wheel = parts.build('wheel', clampPart('wheel', { diameter: 60, width: 10, bore: 5, holes: 5, groove: true }))
    expect(wheel.status()).toBe('NoError')
    const bb = wheel.boundingBox()
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(60, 0)
    expect(bb.max[2]).toBeCloseTo(10, 3)
    // the hole and five windows: genus 6
    expect(wheel.genus()).toBe(6)
    const solid = parts.build('wheel', clampPart('wheel', { diameter: 60, width: 10, bore: 0, holes: 0, groove: false }))
    expect(solid.genus()).toBe(0)
    expect(solid.volume()).toBeGreaterThan(wheel.volume())
    const dShaft = parts.build('wheel', clampPart('wheel', { bore: 5, boreShape: 'd', holes: 0 }))
    const round = parts.build('wheel', clampPart('wheel', { bore: 5, boreShape: 'round', holes: 0 }))
    expect(dShaft.volume()).toBeGreaterThan(round.volume())
    for (const belt of ['round', 'v']) {
      const p = parts.build('pulley', clampPart('pulley', { diameter: 30, belt, beltSize: 4, bore: 5 }))
      expect(p.status(), belt).toBe('NoError')
      expect(p.genus(), belt).toBe(1)
      p.delete()
    }
    ;[wheel, solid, dShaft, round].forEach((x) => x.delete())
  })

  it('washers and spacers', () => {
    const wsh = parts.build('washer', clampPart('washer', { outer: 16, inner: 8.4, height: 2 }))
    expect(wsh.volume()).toBeCloseTo(Math.PI * (64 - 4.2 * 4.2) * 2, -1)
    expect(wsh.genus()).toBe(1)
    // the hole can never eat the whole washer
    const v = clampPart('washer', { outer: 10, inner: 50 })
    expect(v.inner).toBeLessThan(10)
    wsh.delete()
  })

  it('a spring: a coil of the right height, its turns apart, standing on closed ends', () => {
    const v = clampPart('spring', { diameter: 20, wire: 2, turns: 6, pitch: 6, ends: true })
    const s = parts.build('spring', v)
    expect(s.status()).toBe('NoError')
    const bb = s.boundingBox()
    expect(bb.max[2]).toBeCloseTo(36, 3)
    expect(bb.max[0] - bb.min[0]).toBeCloseTo(20, 0)
    // the wire's volume: length of the helix × its section (roughly)
    const R = 9
    const len = 6 * Math.hypot(2 * Math.PI * R, 6)
    const coil = parts.build('spring', { ...v, ends: false })
    expect(coil.volume() / (len * Math.PI)).toBeCloseTo(1, 1)
    // one piece, and turns do not touch: a vertical line through the wire crosses it once per turn
    // (plus once more: at its start angle the wire is cut in half at the bottom and at the top)
    expect(s.genus()).toBeGreaterThanOrEqual(0)
    const probe = w.Manifold.cylinder(40, 0.3, 0.3, 8).translate([R, 0, -2])
    const hits = coil.intersect(probe)
    const parts2 = hits.decompose()
    expect(parts2.length).toBe(7)
    ;[s, coil, probe, hits, ...parts2].forEach((x) => x.delete())
    // the pitch is kept larger than the wire
    expect(clampPart('spring', { wire: 3, pitch: 1 }).pitch).toBeGreaterThan(3)
  })
})

describe('stage 3: box with a lid, hinge, knob, tag', () => {
  it('a box and its cap lid fit; a sliding lid fits its grooves', () => {
    for (const style of ['cap', 'slide']) {
      const v = clampPart('boxLid', { style, width: 60, depth: 40, height: 30, wall: 2, clearance: 0.3 })
      const box = parts.build('boxLid', { ...v, piece: 'box' })
      const lid = parts.build('boxLid', { ...v, piece: 'lid' })
      expect(box.status(), style).toBe('NoError')
      expect(lid.status(), style).toBe('NoError')
      const bb = box.boundingBox()
      expect(bb.max[0] - bb.min[0]).toBeCloseTo(60, 3)
      expect(bb.max[2]).toBeCloseTo(30, 3)
      // put the lid in place: no clash
      let placed: typeof lid
      if (style === 'cap') {
        const flipped = lid.rotate([180, 0, 0])
        placed = flipped.translate([0, 0, 30 + 2])
        flipped.delete()
      } else {
        const g1 = 30 - Math.max(0.8, 2 * 0.6)
        const g0 = g1 - 2 - 0.3
        placed = lid.translate([0, 0, g0 + 0.15])
      }
      const both = box.intersect(placed)
      expect(both.volume(), style).toBeLessThan(0.5)
      // and the lid really sits there: moved a little it bumps into the walls
      const shifted = placed.translate([style === 'cap' ? 2 : 0, 0, style === 'cap' ? 0 : 1])
      const clash = box.intersect(shifted)
      expect(clash.volume(), style).toBeGreaterThan(1)
      ;[box, lid, placed, both, shifted, clash].forEach((x) => x.delete())
    }
  })

  it('a hinge comes off the printer in two pieces that do not touch', () => {
    const v = clampPart('hinge', { length: 40, width: 15, thickness: 3, knuckles: 5, clearance: 0.4 })
    const h = parts.build('hinge', v)
    expect(h.status()).toBe('NoError')
    const pieces = h.decompose()
    expect(pieces.length).toBe(2)
    // they keep at least the clearance between them: grown by a bit less, they still do not meet
    const [a, b] = pieces
    const near = a.minGap(b, 1)
    expect(near).toBeGreaterThan(0.3)
    // flat on the bed
    expect(h.boundingBox().min[2]).toBeCloseTo(0, 6)
    ;[h, ...pieces].forEach((x) => x.delete())
    // an even number of knuckles becomes odd; too many for the length are cut down
    expect(clampPart('hinge', { knuckles: 4 }).knuckles).toBe(5)
    expect(clampPart('hinge', { length: 20, thickness: 4, knuckles: 9 }).knuckles).toBeLessThan(9)
  })

  it('a knob takes the nut of its size', () => {
    for (const grip of ['star', 'round']) {
      const k = parts.build('knob', clampPart('knob', { size: 'M8', grip }))
      expect(k.status(), grip).toBe('NoError')
      expect(k.genus(), grip).toBe(1)
      // the M8 nut (with no clearance) slides into the pocket
      const nut = parts.build('nut', clampPart('nut', { size: 'M8', clearance: 0 }))
      const both = k.intersect(nut)
      expect(both.volume(), grip).toBeLessThan(0.5)
      ;[k, nut, both].forEach((x) => x.delete())
    }
  })

  it('a tag with raised letters and a hole', async () => {
    const e = await getEngine()
    const r = e.evaluate(prim('tag', { params: { part: clampPart('tag', { text: 'Нерпа', letter: 8, thickness: 2, raise: 1 }) } }))
    expect(r.volume).toBeGreaterThan(100)
    expect(r.box.max[2]).toBeCloseTo(3, 3)
    const plain = e.evaluate(prim('tag', { params: { part: clampPart('tag', { text: '', hole: false }) } }))
    expect(plain.box.max[2]).toBeCloseTo(2, 3)
    const long = e.evaluate(prim('tag', { params: { part: clampPart('tag', { text: 'Нерпа Нерпа' }) } }))
    expect(long.box.max[0] - long.box.min[0]).toBeGreaterThan(r.box.max[0] - r.box.min[0])
  })
})

describe('every part', () => {
  it('is one solid (two for the hinge), whatever its style', async () => {
    const e = await getEngine()
    const cases: [string, Record<string, unknown>][] = [
      ['bolt', {}], ['bolt', { head: 'round' }], ['bolt', { head: 'countersunk' }], ['bolt', { head: 'none' }],
      ['nut', {}], ['nut', { style: 'wing' }], ['nut', { style: 'knurled' }],
      ['jar', {}], ['jar', { piece: 'lid' }], ['rack', {}], ['wheel', {}], ['pulley', {}], ['pulley', { belt: 'v' }],
      ['washer', {}], ['spring', {}], ['spring', { ends: false }],
      ['boxLid', {}], ['boxLid', { piece: 'lid' }], ['boxLid', { style: 'slide' }], ['boxLid', { style: 'slide', piece: 'lid' }],
      ['knob', {}], ['knob', { grip: 'round' }], ['tag', { text: 'Нерпа 2026' }]
    ]
    // with the real font, through the engine's builder
    const builder = new PartBuilder(w, (e as any).font)
    for (const [t, o] of cases) {
      const m = builder.build(t as any, clampPart(t as any, o))
      const pieces = m.decompose()
      expect(pieces.length, `${t} ${JSON.stringify(o)}`).toBe(1)
      ;[m, ...pieces].forEach((x) => x.delete())
    }
  })
})
