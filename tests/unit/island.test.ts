import { describe, expect, it } from 'vitest'
import { ISLAND, cellCenter, islandDoc } from '@/core/robotics/demo'
import { RoboWorld } from '@/core/robotics/world'
import { parseDoc, serializeDoc } from '@/core/io/formats'
import { cellAt } from '@/core/robotics/land'
import ru from '@/i18n/ru.json'

const tr = (k: string) => (ru as Record<string, string>)[k] ?? k

describe('the demo «Остров»', () => {
  const doc = islandDoc(tr)

  it('is a 9 × 7 island: sea round it, a beach, a road loop with a line, a hill and a lighthouse', () => {
    const land = doc.nodes.filter((n) => n.kind === 'prim' && n.params.terrain && ['ground', 'water'].includes(n.params.terrain.kind))
    expect(land.length).toBe(9 * 7 - 2)
    expect(land.filter((n) => n.kind === 'prim' && n.params.terrain!.kind === 'water').length).toBe(2 * 9 + 2 * 5)
    const roads = land.filter((n) => n.kind === 'prim' && n.params.terrain!.surface === 'road')
    expect(roads.length).toBe(12)
    expect(roads.every((n) => n.kind === 'prim' && n.params.terrain!.line && n.params.terrain!.line !== 'none')).toBe(true)
    expect(doc.nodes.filter((n) => n.kind === 'prim' && n.prim === 'nerpa').map((n) => n.kind === 'prim' && n.params.nerpa!.species)).toEqual(['seal', 'cheetah', 'pigeon'])
    expect(doc.nodes.some((n) => n.name === 'Маяк')).toBe(true)
    // names in the user's language
    expect(doc.nodes.some((n) => n.name === 'Читик')).toBe(true)
    expect(doc.nodes.some((n) => /^Вода \d+$/.test(n.name))).toBe(true)
  })

  it('opens from a file as it was saved', () => {
    const back = parseDoc(serializeDoc(doc))
    expect(back.nodes.length + back.parked.length).toBe(doc.nodes.length)
  })

  it('plays: the robot keeps to the road, the seal swims round, Читик jumps on the hill, Геннадий flies across, the lighthouse blinks', () => {
    const w = RoboWorld.fromDoc(doc)
    for (const p of w.programs()) expect([...p.program.unknown]).toEqual([])
    const played: string[] = []
    w.sounds = { play: (id) => played.push(id), note: () => {}, stop: () => {} }
    const robot = w.robots[0]
    const [seal, cheetah, pigeon] = w.seals.map((s) => s.seal)
    const lamp = w.lights[0]
    const roadCells = new Set<string>()
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) if (i === 0 || j === 0 || i === 4 || j === 2) roadCells.add(`${ISLAND.road[0] + i},${ISLAND.road[1] + j}`)
    const corners = new Set<string>()
    let hill = false
    let cheetahTurned = false
    let pigeonThere = false
    let pigeonBack = false
    let maxAlt = 0
    let lampOn = 0
    let lampOff = 0
    let robotCells = new Set<string>()
    const x0 = robot.pose.x
    for (let k = 0; k < 120 * 60; k++) {
      w.step()
      if (k % 12) continue
      const rc = cellAt(robot.pose.x, robot.pose.y).join(',')
      robotCells.add(rc)
      expect(roadCells.has(rc)).toBe(true)
      expect(seal.wet).toBe(true)
      corners.add(cellAt(seal.x, seal.y).join(','))
      expect(cheetah.wet).toBe(false)
      if (cheetah.z > 100 && !cheetah.leaping) hill = true
      if (Math.cos(cheetah.theta) < -0.9) cheetahTurned = true
      maxAlt = Math.max(maxAlt, pigeon.z)
      if (!pigeon.flying && Math.hypot(pigeon.x - cellCenter(ISLAND.pigeonTo[0]), pigeon.y - cellCenter(ISLAND.pigeonTo[1])) < 30) pigeonThere = true
      if (pigeonThere && !pigeon.flying && Math.hypot(pigeon.x - cellCenter(ISLAND.pigeon[0]), pigeon.y - cellCenter(ISLAND.pigeon[1])) < 30) pigeonBack = true
      if (lamp.on) lampOn++
      else lampOff++
    }
    // the robot has gone round the whole loop
    expect(robotCells.size).toBe(roadCells.size)
    expect(robot.pose.x).not.toBe(x0)
    // the seal has been in all four corners of the sea
    for (const c of ['0,0', '8,0', '8,6', '0,6']) expect(corners.has(c)).toBe(true)
    expect(hill).toBe(true)
    expect(cheetahTurned).toBe(true)
    expect(maxAlt).toBeGreaterThan(350)
    expect(pigeonThere).toBe(true)
    expect(pigeonBack).toBe(true)
    expect(lampOn).toBeGreaterThan(50)
    expect(lampOff).toBeGreaterThan(50)
    for (const s of ['seal_voice', 'seal_bark', 'seal_splash', 'cheetah_meow', 'cheetah_chirp', 'cheetah_purr', 'pigeon_coo', 'pigeon_wings', 'pigeon_gugu']) expect(played).toContain(s)
  })
})
