import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

const sk = (win: any) => win.evaluate(() => (window as any).__cad.sketch.value)
const settle = (win: any) => win.evaluate(() => (window as any).__cad.sketchSettled())

async function clickAt(win: any, x: number, y: number) {
  const p = await project(win, x, y, 0)
  await win.mouse.move(p.x + 3, p.y + 3)
  await win.mouse.move(p.x, p.y)
  await win.mouse.click(p.x, p.y)
}

async function startSketch(win: any) {
  await win.evaluate(() => ((window as any).__cad.gridStep.value = 1))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await win.waitForTimeout(600)
}

test('draw a closed curve with the Curve tool and extrude it', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await startSketch(win)
  await win.keyboard.press('s')
  await expect(win.locator('[data-testid=sk-tool-spline]')).toHaveClass(/on|active/)
  for (const [x, y] of [[0, 0], [30, -5], [35, 20], [5, 25]]) await clickAt(win, x, y)
  // a click on the first point closes the curve
  await clickAt(win, 0, 0)
  await settle(win)
  let s = await sk(win)
  expect(s.curves).toHaveLength(1)
  expect(s.curves[0].kind).toBe('spline')
  expect(s.curves[0].closed).toBe(true)
  expect(s.curves[0].pts).toHaveLength(4)

  // points of the curve can be dragged
  await win.keyboard.press('q')
  const from = await project(win, 35, 20, 0)
  const to = await project(win, 45, 30, 0)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 6 })
  await win.mouse.up()
  await settle(win)
  s = await sk(win)
  const moved = s.points.find((p: any) => p.id === s.curves[0].pts[2])
  expect(moved.x).toBeCloseTo(45, 0)
  expect(moved.y).toBeCloseTo(30, 0)

  await win.click('[data-testid=sk-done]')
  await win.click('[data-testid=extrude-ok]')
  await idle(win)
  const ns = await nodes(win)
  expect(ns).toHaveLength(1)
  expect(ns[0].prim).toBe('sketch')
  await win.waitForTimeout(300)
  const b = await win.evaluate((id: string) => (window as any).__cad.viewport.worldBoxes([id])[id], ns[0].id)
  expect(b.max[0] - b.min[0]).toBeGreaterThan(40)
  expect(errors).toEqual([])
  await app.close()
})

test('an open curve joined to a line makes a region; Enter finishes the curve', async () => {
  const { app, win } = await launch()
  await startSketch(win)
  await win.click('[data-testid=sk-tool-spline]')
  for (const [x, y] of [[-20, 0], [-10, 12], [10, 12], [20, 0]]) await clickAt(win, x, y)
  await win.keyboard.press('Enter')
  await settle(win)
  let s = await sk(win)
  expect(s.curves[0].kind).toBe('spline')
  expect(s.curves[0].closed).toBeUndefined()
  // a straight line between the two ends: they are picked up as shared points
  await win.keyboard.press('l')
  await clickAt(win, 20, 0)
  await clickAt(win, -20, 0)
  await win.keyboard.press('Enter')
  await settle(win)
  s = await sk(win)
  const line = s.curves.find((c: any) => c.kind === 'line')
  const sp = s.curves.find((c: any) => c.kind === 'spline')
  expect([line.p1, line.p2].sort()).toEqual([sp.pts[0], sp.pts[3]].sort())
  // dragging the curve itself moves its points (the ends stay: they were snapped onto the X axis)
  await win.keyboard.press('q')
  const top = await win.evaluate(() => {
    const s = (window as any).__cad.sketch.value
    const ys = s.points.map((p: any) => p.y)
    return Math.max(...ys)
  })
  // off the Y axis, which would be picked first
  const a = await project(win, 5, top + 0.6, 0)
  const b = await project(win, 5, top + 10.6, 0)
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move(b.x, b.y, { steps: 6 })
  await win.mouse.up()
  await settle(win)
  s = await sk(win)
  const mid = s.points.find((p: any) => p.id === sp.pts[1])
  expect(mid.y).toBeCloseTo(22, 0)
  expect(s.points.find((p: any) => p.id === sp.pts[0]).y).toBeCloseTo(0, 3)
  await win.click('[data-testid=sk-done]')
  await expect(win.locator('[data-testid=extrude-none]')).toHaveCount(0)
  await win.click('[data-testid=extrude-ok]')
  await idle(win)
  expect(await nodes(win)).toHaveLength(1)
  await app.close()
})
