import { expect, test, type Page } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

const opacityOf = (win: Page, id: string) =>
  win.evaluate((x) => {
    const o = (window as any).__cad.viewport.sync.objects.get(x)
    return o.mesh.material.opacity as number
  }, id)

test('a shape in front of the sketch plane turns see-through while the sketch is open', async () => {
  const { app, win } = await launch()
  // a box, a second one floating above it (in front of its top face), a third one beside it
  for (let i = 0; i < 3; i++) await win.click('[data-testid=shape-box]')
  await idle(win)
  let ns = await nodes(win)
  await win.evaluate((ids) => {
    const c = (window as any).__cad
    const move = (id: string, p: number[]) =>
      (c.doc.value = { ...c.doc.value, nodes: c.doc.value.nodes.map((n: any) => (n.id === id ? { ...n, transform: { ...n.transform, position: p } } : n)) })
    move(ids[0], [0, 0, 0])
    move(ids[1], [0, 0, 45])
    move(ids[2], [60, 0, 0])
    c.selection.value = []
  }, ns.map((n: any) => n.id))
  await idle(win)
  ns = await nodes(win)
  await win.keyboard.press('f')
  await win.waitForTimeout(500)
  const top = await project(win, 5, 5, 20)
  await win.click('[data-testid=tb-sketch]')
  await win.mouse.click(top.x, top.y)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  await win.waitForTimeout(800)
  expect(await opacityOf(win, ns[1].id)).toBeLessThan(0.5)
  // the box being drawn on and the one beside it stay as they are
  expect(await opacityOf(win, ns[0].id)).toBe(1)
  expect(await opacityOf(win, ns[2].id)).toBe(1)
  await win.screenshot({ path: 'test-results/sketch-ghost.png' })
  await win.click('[data-testid=sk-cancel]')
  await win.waitForTimeout(300)
  expect(await opacityOf(win, ns[1].id)).toBe(1)
  await app.close()
})

test('a circle with a diameter: the dimension sits outside, the centre point can be dragged', async () => {
  const { app, win } = await launch()
  await win.evaluate(() => ((window as any).__cad.gridStep.value = 0))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  let last = ''
  let still = 0
  for (let i = 0; i < 60 && still < 8; i++) {
    await win.waitForTimeout(100)
    const now = JSON.stringify(await project(win, 50, 50, 0))
    still = now === last ? still + 1 : 0
    last = now
  }
  await win.keyboard.press('o')
  const a = await project(win, 30, 20, 0)
  const b = await project(win, 40, 20, 0)
  await win.mouse.click(a.x, a.y)
  await win.mouse.move(b.x, b.y)
  await win.mouse.click(b.x, b.y)
  await win.evaluate(() => (window as any).__cad.sketchSettled())
  await win.keyboard.press('q')
  let s = await win.evaluate(() => (window as any).__cad.sketch.value)
  const circle = s.curves.find((k: any) => k.kind === 'circle')
  await win.evaluate((id) => ((window as any).__cad.skSelection.value = [id]), circle.id)
  await win.keyboard.press('d')
  await win.evaluate(() => (window as any).__cad.sketchSettled())
  const input = win.locator('[data-testid^=skdim-input-]')
  await input.fill('20')
  await input.press('Enter')
  await win.evaluate(() => (window as any).__cad.sketchSettled())
  s = await win.evaluate(() => (window as any).__cad.sketch.value)
  const dim = s.constraints.find((k: any) => k.type === 'diameter' || k.type === 'radius')
  // the number is above the circle, not on it
  const label = (await win.getByTestId(`skdim-${dim.id}`).boundingBox())!
  const topOfCircle = await project(win, 30, 30, 0)
  expect(label.y + label.height).toBeLessThan(topOfCircle.y)
  await win.screenshot({ path: 'test-results/sketch-diameter.png' })
  // drag the centre: the circle moves, the dimension is not picked
  const ctr = await project(win, 30, 20, 0)
  const to = await project(win, 10, 0, 0)
  await win.mouse.move(ctr.x, ctr.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 8 })
  await win.mouse.up()
  await win.evaluate(() => (window as any).__cad.sketchSettled())
  s = await win.evaluate(() => (window as any).__cad.sketch.value)
  const p = s.points.find((q: any) => q.id === circle.c)
  expect(p.x).toBeLessThan(20)
  expect(await win.evaluate(() => (window as any).__cad.skSelection.value)).not.toContain(dim.id)
  await app.close()
})
