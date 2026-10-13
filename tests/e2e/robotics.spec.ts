import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

test('robotics: demo track, run the line follower, stop restores', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await expect(win.getByTestId('robo-panel')).toBeVisible()
  await expect(win.getByTestId('blockly-panel')).toBeVisible()
  await win.getByTestId('load-demo').click()
  await idle(win)
  await win.waitForTimeout(1500)
  const before = JSON.stringify(await nodes(win))
  await win.screenshot({ path: 'test-results/robo-demo.png' })
  // the robot's program is in the block editor
  await expect(win.locator('.blocklyBlockCanvas .blocklyPath').first()).toBeVisible()
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.simState.value === 'running')
  await win.waitForTimeout(4000)
  await win.screenshot({ path: 'test-results/robo-running.png' })
  const pose = await win.evaluate(() => {
    const c = (window as any).__cad
    const robot = c.doc.value.nodes.find((n: any) => n.prim === 'robot')
    const o = c.viewport.sync.objects.get(robot.id)
    return { x: o.position.x, y: o.position.y, docX: robot.transform.position[0] }
  })
  expect(Math.hypot(pose.x - pose.docX, pose.y - 150)).toBeGreaterThan(100)
  // readings are live
  await expect(win.getByTestId('reading-1')).toBeVisible()
  // editing is locked while running
  await win.keyboard.press('Delete')
  expect(JSON.stringify(await nodes(win))).toBe(before)
  await win.getByTestId('sim-stop').click()
  await win.waitForTimeout(200)
  const back = await win.evaluate(() => {
    const c = (window as any).__cad
    const robot = c.doc.value.nodes.find((n: any) => n.prim === 'robot')
    const o = c.viewport.sync.objects.get(robot.id)
    return [o.position.x, o.position.y, robot.transform.position[0], robot.transform.position[1]]
  })
  expect(back[0]).toBeCloseTo(back[2])
  expect(back[1]).toBeCloseTo(back[3])
  expect(JSON.stringify(await nodes(win))).toBe(before)
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})

test('robotics: tiles snap to the grid, R turns them, sensors snap onto pads', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)
  // drag a straight tile onto the field
  const tile = await win.getByTestId('tile-straight').boundingBox()
  const target = await project(win, 170, 120, 0)
  await win.mouse.move(tile!.x + 20, tile!.y + 20)
  await win.mouse.down()
  await win.mouse.move(target.x - 40, target.y, { steps: 5 })
  await win.mouse.move(target.x, target.y, { steps: 5 })
  await win.mouse.up()
  await idle(win)
  let ns = await nodes(win)
  expect(ns).toHaveLength(1)
  expect(ns[0].transform.position.slice(0, 2)).toEqual([150, 150])
  await win.keyboard.press('r')
  ns = await nodes(win)
  expect(ns[0].transform.rotation[2]).toBeCloseTo(90)
  // a robot, then a sensor dragged onto its front pad
  await win.getByTestId('add-robot').click()
  await idle(win)
  await win.waitForTimeout(800)
  ns = await nodes(win)
  const robot = ns.find((n: any) => n.prim === 'robot')
  const [rx, ry] = robot.transform.position
  const pad = await project(win, rx + 59.7, ry, 16.5)
  const sb = await win.getByTestId('add-sensor').boundingBox()
  await win.mouse.move(sb!.x + 20, sb!.y + 20)
  await win.mouse.down()
  await win.mouse.move(pad.x + 60, pad.y, { steps: 5 })
  await win.mouse.move(pad.x + 8, pad.y + 5, { steps: 5 })
  await win.screenshot({ path: 'test-results/robo-magnet.png' })
  await win.mouse.up()
  ns = await nodes(win)
  expect(ns.find((n: any) => n.prim === 'robot').params.robot.sensors).toEqual([{ port: 2, type: 'line' }])
  // pad map toggles port 4
  await win.getByTestId('pad-4').click()
  ns = await nodes(win)
  expect(ns.find((n: any) => n.prim === 'robot').params.robot.sensors.map((s: any) => s.port)).toEqual([2, 4])
  await win.screenshot({ path: 'test-results/robo-sensors.png' })
  await app.close()
})

test('robotics: keys typed in the block editor do not touch the shapes', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await win.getByTestId('add-robot').click()
  await idle(win)
  await win.waitForTimeout(500)
  // select the robot, then work in the block editor
  const before = (await nodes(win)).length
  await win.evaluate(() => {
    const c = (window as any).__cad
    c.selection.value = [c.doc.value.nodes[0].id]
  })
  const start = win.locator('.blocklyDraggable').first()
  await start.click()
  await win.keyboard.press('Delete')
  await win.keyboard.press('Control+z')
  await win.waitForTimeout(400)
  expect((await nodes(win)).length).toBe(before)
  await app.close()
})
