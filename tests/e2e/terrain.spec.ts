import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

const terrain = (ns: any[]) => ns.filter((n) => n.prim === 'terrain')

test('terrain: drag a ramp in, set its height and length, lay track on it, drive up onto a platform', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)
  await win.getByTestId('field-tab-relief').click()
  await expect(win.getByTestId('terrain-platform')).toBeVisible()
  await expect(win.getByTestId('terrain-bridge')).toBeVisible()

  // drag a ramp from the panel onto the field: a two-tile ramp centres on a cell edge
  const b = await win.getByTestId('terrain-ramp').boundingBox()
  const target = await project(win, 170, 320, 0)
  await win.mouse.move(b!.x + 20, b!.y + 20)
  await win.mouse.down()
  await win.mouse.move(target.x - 40, target.y, { steps: 5 })
  await win.mouse.move(target.x, target.y, { steps: 5 })
  await win.mouse.up()
  await idle(win)
  let ns = await nodes(win)
  expect(terrain(ns)).toHaveLength(1)
  const ramp = terrain(ns)[0]
  expect(ramp.params.terrain).toMatchObject({ kind: 'ramp', height: 120, length: 2 })
  expect(ramp.transform.position).toEqual([150, 300, 0])

  // the inspector: one tile long, then back to two; height
  await win.evaluate((id) => ((window as any).__cad.selection.value = [id]), ramp.id)
  await win.getByTestId('ramp-length-1').click()
  ns = await nodes(win)
  expect(terrain(ns)[0].params.terrain.length).toBe(1)
  expect(terrain(ns)[0].transform.position).toEqual([150, 450, 0])
  await win.getByTestId('ramp-length-2').click()
  ns = await nodes(win)
  expect(terrain(ns)[0].transform.position).toEqual([150, 300, 0])
  const h = win.getByTestId('terrain-height')
  const shown = Number((await h.inputValue()).replace(',', '.'))
  const scale = 120 / shown
  await h.fill(String(150 / scale))
  await win.keyboard.press('Enter')
  ns = await nodes(win)
  expect(terrain(ns)[0].params.terrain.height).toBeCloseTo(150)
  await h.fill(String(120 / scale))
  await win.keyboard.press('Enter')
  await win.screenshot({ path: 'test-results/terrain-inspector.png' })

  // a platform at the top of the ramp, track tiles on the ramp and on the platform, a robot below
  const ids = await win.evaluate(() => {
    const A = (window as any).__cad.actions
    const platform = A.addTerrain('platform', [150, 750])
    const t1 = A.addTile('straight', [150, 150], 0)
    const t2 = A.addTile('straight', [150, 450], 0)
    const t3 = A.addTile('straight', [150, 750], 0)
    const robot = A.addRobot([150, -150], 90)
    return { platform, t1, t2, t3, robot }
  })
  await idle(win)
  await win.waitForTimeout(600)
  ns = await nodes(win)
  const z = (id: string) => ns.find((n: any) => n.id === id).transform.position[2]
  expect(z(ids.t3)).toBe(120)
  expect(z(ids.robot)).toBe(0)
  // the tile on the ramp lies along its slope
  const slope = await win.evaluate((id) => {
    const o = (window as any).__cad.viewport.sync.objects.get(id)
    o.updateMatrixWorld(true)
    const e = o.matrixWorld.elements
    return { z: o.position.z, shear: Math.max(Math.abs(e[2]), Math.abs(e[6])) }
  }, ids.t1)
  expect(slope.z).toBeGreaterThan(20)
  expect(slope.z).toBeLessThan(40)
  expect(Math.abs(slope.shear)).toBeCloseTo(0.2, 2)
  await win.evaluate(() => ((window as any).__cad.selection.value = []))
  await win.screenshot({ path: 'test-results/terrain-editor.png' })

  // the robot drives straight ahead: up the ramp and onto the platform
  await win.evaluate((id) => {
    const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
    const program = {
      blocks: {
        languageVersion: 0,
        blocks: [{ type: 'robo_start', id: 'st', x: 20, y: 20, next: { block: { type: 'robo_motors', id: 'm', inputs: { LEFT: n(60), RIGHT: n(60) } } } }]
      }
    }
    ;(window as any).__cad.actions.setProgram(id, program)
  }, ids.robot)
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.simState.value === 'running')
  const pose = (id: string) =>
    win.evaluate((rid) => {
      const o = (window as any).__cad.viewport.sync.objects.get(rid)
      return { y: o.position.y, z: o.position.z }
    }, id)
  // on the slope it has climbed part way
  await win.waitForFunction((rid) => (window as any).__cad.viewport.sync.objects.get(rid).position.y > 250, ids.robot, { timeout: 20000 })
  const mid = await pose(ids.robot)
  expect(mid.z).toBeGreaterThan(20)
  expect(mid.z).toBeLessThan(110)
  await win.screenshot({ path: 'test-results/terrain-climbing.png' })
  await win.waitForFunction((rid) => (window as any).__cad.viewport.sync.objects.get(rid).position.y > 700, ids.robot, { timeout: 20000 })
  expect((await pose(ids.robot)).z).toBeCloseTo(120, 0)
  await win.screenshot({ path: 'test-results/terrain-on-top.png' })
  await win.getByTestId('sim-stop').click()
  await win.waitForTimeout(200)
  expect((await pose(ids.robot)).z).toBeCloseTo(0)

  // make the platform taller: the tile and robot standing on it follow
  await win.evaluate((id) => (window as any).__cad.actions.setTerrain(id, { height: 200 }), ids.platform)
  ns = await nodes(win)
  expect(z(ids.t3)).toBe(200)
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('terrain: a bridge between two platforms, R turns a ramp, track under the bridge', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)
  const ids = await win.evaluate(() => {
    const A = (window as any).__cad.actions
    const r1 = A.addTerrain('ramp', [150, 300])
    A.addTerrain('platform', [150, 750])
    const bridge = A.addTerrain('bridge', [150, 1050])
    A.addTerrain('platform', [150, 1350])
    const under = A.addTile('straight', [150, 1050], 0)
    return { r1, bridge, under }
  })
  await idle(win)
  await win.waitForTimeout(600)
  let ns = await nodes(win)
  // a tile put on a bridge's cell lies on its deck; the inspector moves it to the floor below
  expect(ns.find((n: any) => n.id === ids.under).transform.position[2]).toBe(120)
  await win.evaluate((id) => ((window as any).__cad.selection.value = [id]), ids.under)
  await win.getByTestId('tile-level-low').click()
  ns = await nodes(win)
  expect(ns.find((n: any) => n.id === ids.under).transform.position[2]).toBe(0)
  await win.getByTestId('tile-level-high').click()
  ns = await nodes(win)
  expect(ns.find((n: any) => n.id === ids.under).transform.position[2]).toBe(120)
  await win.getByTestId('tile-level-low').click()
  // R turns the ramp by 90° and keeps it on the grid
  await win.evaluate((id) => ((window as any).__cad.selection.value = [id]), ids.r1)
  await win.keyboard.press('r')
  ns = await nodes(win)
  const r = ns.find((n: any) => n.id === ids.r1)
  expect(r.transform.rotation[2]).toBeCloseTo(90)
  // now lying along X: its centre on a cell edge across, a cell centre along Y
  expect(r.transform.position).toEqual([300, 450, 0])
  // it swings around its high cell: four turns bring it back
  for (let i = 0; i < 3; i++) await win.keyboard.press('r')
  ns = await nodes(win)
  expect(ns.find((n: any) => n.id === ids.r1).transform.position).toEqual([150, 300, 0])
  for (let i = 0; i < 3; i++) await win.keyboard.press('Control+z')
  await win.keyboard.press('Control+z')
  await win.evaluate(() => ((window as any).__cad.selection.value = []))
  await win.waitForTimeout(300)
  await win.screenshot({ path: 'test-results/terrain-bridge.png' })
  await app.close()
})
