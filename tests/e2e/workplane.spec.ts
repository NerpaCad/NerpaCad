import { expect, test } from '@playwright/test'
import { Euler, Quaternion, Vector3 } from 'three'
import { idle, launch, nodes, project } from './app'

const axisZ = (rot: number[]) =>
  new Vector3(0, 0, 1).applyQuaternion(
    new Quaternion().setFromEuler(new Euler(...(rot.map((d) => (d * Math.PI) / 180) as [number, number, number]), 'XYZ'))
  )

test('workplane on a side face: new shapes stand on it and move in it', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))

  // a 20 mm box at the origin, turned 45° around Z
  await win.click('[data-testid=shape-box]')
  await idle(win)
  await win.fill('[data-testid=rot-2]', '45')
  await win.press('[data-testid=rot-2]', 'Enter')
  await idle(win)
  await win.keyboard.press('Escape')

  // the side face whose normal points to (0.707, -0.707, 0), facing the default camera
  const n = new Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0)
  const faceCenter = n.clone().multiplyScalar(10).add(new Vector3(0, 0, 10))
  const fc = await project(win, faceCenter.x, faceCenter.y, faceCenter.z)

  await win.keyboard.press('w')
  await expect(win.locator('.mode-hint')).toBeVisible()
  await win.mouse.move(fc.x, fc.y)
  await win.mouse.click(fc.x, fc.y)
  const wp = await win.evaluate(() => (window as any).__cad.workplane.value)
  expect(wp).not.toBeNull()
  expect(axisZ(wp.rotation).distanceTo(n)).toBeLessThan(1e-3)
  await expect(win.locator('[data-testid=wp-reset]')).toBeVisible()

  // drag a cylinder from the panel onto the middle of that face
  const tile = await win.locator('[data-testid=shape-cylinder]').boundingBox()
  await win.mouse.move(tile!.x + tile!.width / 2, tile!.y + tile!.height / 2)
  await win.mouse.down()
  await win.mouse.move(fc.x + 30, fc.y, { steps: 5 })
  await win.mouse.move(fc.x, fc.y, { steps: 5 })
  await win.mouse.up()
  await idle(win)
  let ns = await nodes(win)
  expect(ns).toHaveLength(2)
  const cyl = ns[1]
  // cylinder axis = face normal, its base sits on the face plane
  expect(axisZ(cyl.transform.rotation).distanceTo(n)).toBeLessThan(1e-3)
  const base = new Vector3(...cyl.transform.position)
  expect(base.dot(n)).toBeCloseTo(10, 3)
  await win.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'cad-e2e-workplane.png') })

  // dragging the cylinder keeps it on the face plane (moves within the workplane)
  const from = await project(win, base.x + n.x * 10, base.y + n.y * 10, base.z + n.z * 10)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(from.x + 20, from.y - 30, { steps: 8 })
  await win.mouse.up()
  ns = await nodes(win)
  const moved = new Vector3(...ns[1].transform.position)
  expect(moved.distanceTo(base)).toBeGreaterThan(2)
  expect(moved.dot(n)).toBeCloseTo(10, 3)

  // lifting with Ctrl+Up moves it along the face normal
  await win.keyboard.press('Control+ArrowUp')
  ns = await nodes(win)
  expect(new Vector3(...ns[1].transform.position).dot(n)).toBeCloseTo(11, 3)

  // reset puts the workplane back on the ground
  await win.click('[data-testid=wp-reset]')
  expect(await win.evaluate(() => (window as any).__cad.workplane.value)).toBeNull()

  expect(errors).toEqual([])
  await app.close()
})
