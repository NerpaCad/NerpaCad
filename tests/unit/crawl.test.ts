import { describe, expect, it } from 'vitest'
import { emptyDoc, type DocNode, type Species } from '@/core/doc/model'
import { nerpaNode, start, terrainNode, workspaceJson } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { PROFILES } from '@/core/robotics/creatures'
import type { BlockJson } from '@/core/robotics/interpreter'

let bid = 0
const blk = (type: string, inputs: Record<string, unknown> = {}, fields: Record<string, unknown> = {}): BlockJson =>
  ({ type, id: `c${++bid}`, inputs, fields }) as BlockJson
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const c = (i: number) => 150 + 300 * i
const crawl = (cm: number) => blk('cheetah_crawl', { CM: n(cm) })
const walk = (cm: number) => blk('nerpa_walk', { CM: n(cm) })
const hero = (species: Species, body: BlockJson[]) => nerpaNode(c(0), c(0), 0, species, workspaceJson([start(body)]), species)
/** a bridge over the cheetah's way, `height` cm to the top of its deck */
const bridge = (height: number) => terrainNode('bridge', c(2), c(0), 0, 'b', { height: height * 10 })
function run(nodes: DocNode[], seconds: number) {
  const w = RoboWorld.fromDoc({ ...emptyDoc(), scene: 'robo', nodes })
  const s = w.seals[0].seal
  let crouchedUnder = false
  for (let k = 0; k < seconds * 120; k++) {
    w.step()
    if (Math.abs(s.x - c(2)) < 100 && s.crouched) crouchedUnder = true
  }
  return { w, s, crouchedUnder }
}

describe('Читик crawls', () => {
  const H = PROFILES.cheetah.height
  it('crouched it is 2/3 of its height and slower than walking', () => {
    expect(PROFILES.cheetah.crouch! * H).toBeCloseTo(113, 0)
    expect(PROFILES.cheetah.crawl!).toBeLessThan(PROFILES.cheetah.walk)
  })

  it('walking or running it bumps into a low bridge; crawling it gets under and stands up beyond', () => {
    // a 15 cm bridge: 13.5 cm under the deck — more than 2/3 of its height, less than all of it
    expect(run([bridge(15), hero('cheetah', [walk(120)])], 8).s.x).toBeLessThan(c(2) - 150)
    expect(run([bridge(15), hero('cheetah', [blk('cheetah_run', { CM: n(120) })])], 8).s.x).toBeLessThan(c(2) - 150)
    const { s, crouchedUnder } = run([bridge(15), hero('cheetah', [crawl(120)])], 14)
    expect(s.x).toBeGreaterThan(c(2) + 150)
    expect(crouchedUnder).toBe(true)
    expect(s.crouched).toBe(false)
  })

  it('a gap lower than 2/3 of its height stops it even crawling', () => {
    // the default 12 cm bridge: 10.5 cm under the deck
    expect(run([bridge(12), hero('cheetah', [crawl(120)])], 14).s.x).toBeLessThan(c(2) - 150)
  })

  it('stopped under the bridge it stays crouched; told to walk on it crawls out and then stands', () => {
    const r = run([bridge(15), hero('cheetah', [crawl(60), blk('robo_wait', { SECONDS: n(1) })])], 8)
    expect(Math.abs(r.s.x - c(2))).toBeLessThan(150)
    expect(r.s.crouched).toBe(true)
    expect(r.s.anim).toBe('crouch')
    const on = run([bridge(15), hero('cheetah', [crawl(60), walk(80)])], 14)
    expect(on.s.x).toBeGreaterThan(c(2) + 150)
    expect(on.s.crouched).toBe(false)
  })

  it('no jumping while crouched under the bridge', () => {
    const r = run([bridge(15), hero('cheetah', [crawl(60), blk('cheetah_leap')])], 8)
    expect(Math.abs(r.s.x - c(2))).toBeLessThan(150)
    expect(r.s.z).toBe(0)
  })

  it('the seal and the pigeon have no crawl (in a program it is a walk); the block is known', () => {
    const r = run([hero('seal', [crawl(10)])], 2)
    expect(r.s.crouched).toBe(false)
    expect(r.s.x).toBeGreaterThan(c(0) + 90)
    expect([...r.w.seals[0].program!.unknown]).toEqual([])
  })
})
