import { describe, expect, it } from 'vitest'
import { emptyDoc, sceneNodes, transformMatrix } from '@/core/doc/model'
import { Vector3 } from 'three'
import { parseDoc, serializeDoc, FileFormatError } from '@/core/io/formats'
import { cellCenter, demoDoc, lineFollowerProgram, loopTrack, motors, robotNode, start, tileNode, workspaceJson } from '@/core/robotics/demo'
import { Program, type BlockJson } from '@/core/robotics/interpreter'
import { drive } from '@/core/robotics/kinematics'
import { NERPABOT } from '@/core/robotics/robot'
import { blackAt, lineSensor, type PlacedTile } from '@/core/robotics/sensors'
import { onLine } from '@/core/robotics/tiles'
import { RoboWorld, tilesOf } from '@/core/robotics/world'
import { getEngine } from './helpers'
import { Physics, initPhysics, type ShapeBody } from '@/core/robotics/physics'

const straight: PlacedTile = { kind: 'straight', x: 150, y: 150, angle: 0 }

describe('tiles and the line sensor', () => {
  it('knows where the line is', () => {
    expect(onLine('straight', 0, 100)).toBe(true)
    expect(onLine('straight', 11, 0)).toBe(false)
    expect(onLine('cross', 100, 5)).toBe(true)
    // the turn runs from the bottom edge middle to the right edge middle
    expect(onLine('turn', 0, -149)).toBe(true)
    expect(onLine('turn', 149, 0)).toBe(true)
    expect(onLine('turn', 150 - 150 * Math.SQRT1_2, -150 + 150 * Math.SQRT1_2)).toBe(true)
    expect(onLine('turn', 0, 0)).toBe(false)
  })

  it('reads 0 on the line, about 50 on its edge and 100 on white', () => {
    const t = [straight]
    expect(lineSensor(t, 150, 150, 4)).toBe(0)
    const edge = lineSensor(t, 160, 150, 4)
    expect(edge).toBeGreaterThan(30)
    expect(edge).toBeLessThan(70)
    expect(lineSensor(t, 170, 150, 4)).toBe(100)
    // off the tiles the floor is white
    expect(lineSensor(t, 1000, 1000, 4)).toBe(100)
  })

  it('turns the picture with the tile', () => {
    const rotated: PlacedTile = { ...straight, angle: Math.PI / 2 }
    expect(blackAt([rotated], 50, 150)).toBe(true)
    expect(blackAt([rotated], 150, 50)).toBe(false)
  })

  it('uses the tile on top where tiles overlap', () => {
    const a: PlacedTile = { kind: 'straight', x: 150, y: 150, angle: 0 }
    const b: PlacedTile = { kind: 'straight', x: 150, y: 150, angle: Math.PI / 2 }
    expect(blackAt([a, b], 150, 250)).toBe(false)
    expect(blackAt([b, a], 150, 250)).toBe(true)
  })

  it('builds a closed loop whose lines meet at the tile edges', () => {
    const track = loopTrack(4, 3)
    expect(track).toHaveLength(10)
    const tiles = track.map((t) => ({ kind: t.kind, x: t.x, y: t.y, angle: (t.angle * Math.PI) / 180 }))
    // walking along the loop's centre line stays on black everywhere
    const inner = { x0: 300, x1: 900, y0: 300, y1: 600 }
    let misses = 0
    for (let i = 0; i < 2000; i++) {
      const p = roundedRectPoint(inner, 150, i / 2000)
      if (!blackAt(tiles, p[0], p[1])) misses++
    }
    expect(misses).toBe(0)
  })
})

describe('differential drive', () => {
  it('drives straight, spins in place and follows an exact arc', () => {
    const s = drive({ x: 0, y: 0, theta: 0 }, 100, 100, 120, 2)
    expect(s.x).toBeCloseTo(200)
    expect(s.y).toBeCloseTo(0)
    const spin = drive({ x: 5, y: 5, theta: 0 }, -60, 60, 120, Math.PI / 2)
    expect(spin.x).toBeCloseTo(5)
    expect(spin.theta).toBeCloseTo(Math.PI / 2)
    // left wheel at 0, right at v: a circle of radius track/2 around the left wheel
    let p = { x: 0, y: 0, theta: 0 }
    for (let i = 0; i < 100; i++) p = drive(p, 0, 100, 120, (Math.PI * 1.2) / 100)
    expect(p.theta).toBeCloseTo(Math.PI)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(120)
  })
})

describe('block interpreter', () => {
  const io = () => {
    const log: [number, number][] = []
    const sensors = new Map<number, number>([[1, 20]])
    return { log, sensors, io: { setMotors: (l: number, r: number) => log.push([l, r]), sensor: (p: number) => sensors.get(p) ?? NaN } }
  }
  const wait = (s: number): BlockJson => ({ type: 'robo_wait', inputs: { SECONDS: { shadow: { type: 'robo_number', fields: { NUM: s } } } } })

  it('runs every start block as its own thread and honours waits', () => {
    const t = io()
    const p = new Program(workspaceJson([start([motors(10, 10), wait(1), motors(20, 20)]), start([motors(5, 5)])]), t.io)
    expect(p.threadCount).toBe(2)
    p.tick(1 / 60)
    expect(t.log).toEqual([
      [10, 10],
      [5, 5]
    ])
    for (let i = 0; i < 59; i++) p.tick(1 / 60)
    expect(t.log).toHaveLength(2)
    p.tick(1 / 60)
    expect(t.log[2]).toEqual([20, 20])
    expect(p.finished).toBe(true)
  })

  it('gives way in a loop without a wait', () => {
    const t = io()
    const loop: BlockJson = { type: 'robo_forever', inputs: { DO: { block: motors(1, 1) } } }
    const p = new Program(workspaceJson([start([loop])]), t.io)
    p.tick(1 / 60)
    p.tick(1 / 60)
    expect(t.log.length).toBe(2)
  })

  it('evaluates conditions, arithmetic and sensors', () => {
    const t = io()
    const cond: BlockJson = {
      type: 'robo_logic',
      fields: { OP: 'AND' },
      inputs: {
        A: {
          block: {
            type: 'robo_compare',
            fields: { OP: 'LT' },
            inputs: {
              A: { block: { type: 'robo_line_sensor', fields: { PORT: '1' } } },
              B: { shadow: { type: 'robo_number', fields: { NUM: 50 } } }
            }
          }
        },
        B: { block: { type: 'robo_not', inputs: { A: { block: { type: 'robo_line_black', fields: { PORT: '2' } } } } } }
      }
    }
    const power: BlockJson = {
      type: 'robo_arith',
      fields: { OP: 'DIV' },
      inputs: { A: { shadow: { type: 'robo_number', fields: { NUM: 90 } } }, B: { shadow: { type: 'robo_number', fields: { NUM: 3 } } } }
    }
    const branch: BlockJson = {
      type: 'robo_if_else',
      inputs: { COND: { block: cond }, DO: { block: { type: 'robo_forward', inputs: { POWER: { block: power } } } }, ELSE: { block: motors(0, 0) } }
    }
    const p = new Program(workspaceJson([start([branch])]), t.io)
    p.tick(1 / 60)
    expect(t.log).toEqual([[30, 30]])
  })

  it('skips blocks it does not know and ignores loose blocks', () => {
    const t = io()
    const p = new Program(workspaceJson([start([{ type: 'mystery' }, motors(7, 7)]), motors(9, 9)]), t.io)
    p.tick(1 / 60)
    expect(t.log).toEqual([[7, 7]])
    expect([...p.unknown]).toEqual(['mystery'])
    expect(new Program(null, t.io).threadCount).toBe(0)
    expect(new Program({ blocks: 'x' }, t.io).threadCount).toBe(0)
  })
})

/** A point on a rounded rectangle: `inner` grown by r, parameter u in 0…1 along it. */
function roundedRectPoint(inner: { x0: number; x1: number; y0: number; y1: number }, r: number, u: number): [number, number] {
  const w = inner.x1 - inner.x0
  const h = inner.y1 - inner.y0
  const arc = (Math.PI / 2) * r
  const segs: [number, (t: number) => [number, number]][] = [
    [w, (t) => [inner.x0 + t * w, inner.y0 - r]],
    [arc, (t) => [inner.x1 + r * Math.sin(t * Math.PI / 2), inner.y0 - r * Math.cos(t * Math.PI / 2)]],
    [h, (t) => [inner.x1 + r, inner.y0 + t * h]],
    [arc, (t) => [inner.x1 + r * Math.cos(t * Math.PI / 2), inner.y1 + r * Math.sin(t * Math.PI / 2)]],
    [w, (t) => [inner.x1 - t * w, inner.y1 + r]],
    [arc, (t) => [inner.x0 - r * Math.sin(t * Math.PI / 2), inner.y1 + r * Math.cos(t * Math.PI / 2)]],
    [h, (t) => [inner.x0 - r, inner.y1 - t * h]],
    [arc, (t) => [inner.x0 - r * Math.cos(t * Math.PI / 2), inner.y0 - r * Math.sin(t * Math.PI / 2)]]
  ]
  const total = segs.reduce((a, s) => a + s[0], 0)
  let d = u * total
  for (const [len, f] of segs) {
    if (d <= len) return f(d / len)
    d -= len
  }
  return segs[0][1](0)
}

/** Distance from a point to the loop's centre line (a rounded rectangle). */
function distToLoop(x: number, y: number, inner: { x0: number; x1: number; y0: number; y1: number }, r: number) {
  const dx = Math.max(inner.x0 - x, 0, x - inner.x1)
  const dy = Math.max(inner.y0 - y, 0, y - inner.y1)
  const outside = Math.hypot(dx, dy)
  const inside = outside > 0 ? 0 : Math.min(x - inner.x0, inner.x1 - x, y - inner.y0, inner.y1 - y)
  return outside > 0 ? Math.abs(outside - r) : inside + r
}

describe('a whole run, headless', () => {
  it('a robot with two line sensors follows the loop', () => {
    const doc = emptyDoc()
    doc.nodes = [
      ...loopTrack(4, 3).map((t, i) => tileNode(t, `t${i}`)),
      robotNode(cellCenter(1), cellCenter(0), 0, 'robot', lineFollowerProgram())
    ]
    const w = RoboWorld.fromDoc(doc)
    expect(w.tiles).toHaveLength(10)
    const r = w.robots[0]
    const inner = { x0: 300, x1: 900, y0: 300, y1: 600 }
    let worst = 0
    let turned = 0
    let last = r.pose.theta
    w.run(60, () => {
      // the point between the two sensors is what stays on the line
      const c = Math.cos(r.pose.theta)
      const s = Math.sin(r.pose.theta)
      const ax = r.pose.x + c * 87.7
      const ay = r.pose.y + s * 87.7
      if (w.time > 3) worst = Math.max(worst, distToLoop(ax, ay, inner, 150))
      let d = r.pose.theta - last
      d = Math.atan2(Math.sin(d), Math.cos(d))
      turned += d
      last = r.pose.theta
    })
    // more than two laps counter-clockwise, never far from the line
    expect(turned).toBeGreaterThan(4 * Math.PI)
    expect(worst).toBeLessThan(35)
  })

  it('reads sensors where the modules look at the floor', () => {
    const doc = emptyDoc()
    doc.nodes = [tileNode({ kind: 'straight', x: 150, y: 150, angle: 90 }, 't'), robotNode(0, 150 - 35, 0, 'r')]
    const w = RoboWorld.fromDoc(doc)
    const r = w.robots[0]
    // the left sensor (port 1) is 35 mm left of the centre line: right on the line
    expect(r.readings.get(1)).toBe(0)
    expect(r.readings.get(3)).toBe(100)
    expect(w.sensorSpot(r, 2)![0]).toBeCloseTo(NERPABOT.pads[1].x + NERPABOT.sensorReach)
  })

  it('takes tiles from the document in drawing order', () => {
    const doc = demoDoc({ tile: 't', robot: 'r', box: 'b', cylinder: 'c' })
    expect(tilesOf(doc)).toHaveLength(10)
    expect(RoboWorld.fromDoc(doc).robots[0].program?.threadCount).toBe(1)
  })
})

describe('.tcad version 3', () => {
  it('round-trips tiles, robots with programs and weights', () => {
    const doc = demoDoc({ tile: 't', robot: 'r', box: 'b', cylinder: 'c' })
    ;(doc.nodes[doc.nodes.length - 1] as { mass?: number }).mass = 55
    const back = parseDoc(serializeDoc(doc))
    expect(back.version).toBe(5)
    // the field comes back as the robotics scene; the 3D scene is empty
    expect(sceneNodes(back, 'robo')).toEqual(JSON.parse(JSON.stringify(doc.nodes)))
    expect(sceneNodes(back, 'model')).toEqual([])
  })

  it('rejects bad tiles, sensors, weights and programs', () => {
    const bad = (mut: (d: ReturnType<typeof demoDoc>) => void) => {
      const d = demoDoc({ tile: 't', robot: 'r', box: 'b', cylinder: 'c' })
      mut(d)
      return () => parseDoc(serializeDoc(d))
    }
    const robot = (d: ReturnType<typeof demoDoc>) => d.nodes.find((n) => n.kind === 'prim' && n.prim === 'robot')!
    expect(bad((d) => ((d.nodes[0] as { params: { tile: string } }).params.tile = 'loop'))).toThrow(FileFormatError)
    expect(bad((d) => (robot(d) as { params: { robot: { sensors: unknown[] } } }).params.robot.sensors.push({ port: 9, type: 'line' }))).toThrow(FileFormatError)
    expect(bad((d) => (robot(d) as { params: { robot: { sensors: unknown[] } } }).params.robot.sensors.push({ port: 1, type: 'line' }))).toThrow(FileFormatError)
    expect(bad((d) => ((d.nodes[12] as { mass?: number }).mass = -1))).toThrow(FileFormatError)
    const deep: Record<string, unknown> = {}
    let cur = deep
    for (let i = 0; i < 1000; i++) cur = (cur.a = {}) as Record<string, unknown>
    expect(bad((d) => ((robot(d) as { params: { robot: { program: unknown } } }).params.robot.program = deep))).toThrow(FileFormatError)
  })
})

describe('geometry of robotics objects', () => {
  it('tiles are thin 300 mm slabs and robots have a body-sized stand-in', async () => {
    const e = await getEngine()
    const t = e.evaluate(tileNode({ kind: 'cross', x: 0, y: 0, angle: 0 }, 't'))
    expect(t.box!.max[0] - t.box!.min[0]).toBeCloseTo(300)
    expect(t.box!.max[2]).toBeLessThan(1)
    const r = e.evaluate(robotNode(0, 0, 0, 'r'))
    expect(r.box!.max[2]).toBeCloseTo(NERPABOT.height)
    expect(r.box!.min[2]).toBeCloseTo(0)
  })
})

describe('physics (Rapier)', () => {
  const cube = (id: string, cx: number, cy: number, cz: number, s = 20): ShapeBody => {
    const pts: number[] = []
    for (let i = 0; i < 8; i++) pts.push(cx + (i & 1 ? s / 2 : -s / 2), cy + (i & 2 ? s / 2 : -s / 2), cz + (i & 4 ? s / 2 : -s / 2))
    return { id, points: new Float32Array(pts), mass: 10 }
  }

  it('a cube in the air falls and comes to rest on the floor', async () => {
    await initPhysics()
    const ph = new Physics([cube('c', 0, 0, 100)], [])
    for (let i = 0; i < 240; i++) ph.step(1 / 120, [])
    const p = ph.position('c')!
    expect(p.z).toBeGreaterThan(9)
    expect(p.z).toBeLessThan(11)
    ph.dispose()
  })

  it('a driving robot pushes a cube out of its way', async () => {
    await initPhysics()
    const doc = emptyDoc()
    doc.nodes = [robotNode(0, 0, 0, 'r', workspaceJson([start([motors(60, 60)])]))]
    const w = RoboWorld.fromDoc(doc)
    const ph = new Physics([cube('c', 200, 0, 10)], w.robots)
    for (let i = 0; i < 600; i++) {
      w.step()
      ph.step(1 / 120, w.robots)
    }
    // the robot drove ~600 mm; the cube went ahead of it
    expect(w.robots[0].pose.x).toBeGreaterThan(500)
    expect(ph.position('c')!.x).toBeGreaterThan(w.robots[0].pose.x + 60)
    ph.dispose()
  })
})

describe('the demo, headless with physics', () => {
  it('the robot follows the loop and shoves the cube lying on the line', async () => {
    await initPhysics()
    const e = await getEngine()
    const doc = demoDoc({ tile: 't', robot: 'r', box: 'b', cylinder: 'c' })
    const shapes = doc.nodes.filter((n) => n.kind === 'prim' && (n.prim === 'box' || n.prim === 'cylinder'))
    const bodies: ShapeBody[] = shapes.map((n) => {
      const r = e.evaluate(n)
      const m = transformMatrix(n.transform)
      const pts = new Float32Array(r.positions.length)
      const v = new Vector3()
      for (let i = 0; i < pts.length; i += 3) {
        v.set(r.positions[i], r.positions[i + 1], r.positions[i + 2]).applyMatrix4(m)
        pts[i] = v.x
        pts[i + 1] = v.y
        pts[i + 2] = v.z
      }
      return { id: n.id, points: pts, mass: 20 }
    })
    const w = RoboWorld.fromDoc(doc)
    const ph = new Physics(bodies, w.robots)
    const cube = shapes[0]
    const start = ph.position(cube.id)!
    for (let i = 0; i < 120 * 8; i++) {
      w.step()
      ph.step(1 / 120, w.robots)
    }
    const end = ph.position(cube.id)!
    expect(end.distanceTo(start)).toBeGreaterThan(30)
    // the big box inside the loop was never touched
    const still = ph.position(shapes[2].id)!
    expect(still.x).toBeCloseTo(cellCenter(1) + 60, 0)
    ph.dispose()
  })
})
