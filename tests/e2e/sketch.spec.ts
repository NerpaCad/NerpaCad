import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

test('sketch solver loads in the app and solves a rectangle', async () => {
  const { app, win } = await launch()
  const res = await win.evaluate(async () => {
    const pts = [
      { id: 'p1', x: 1, y: 1 },
      { id: 'p2', x: 31, y: 2 },
      { id: 'p3', x: 30, y: 21 },
      { id: 'p4', x: 0, y: 20 }
    ]
    const curves = [0, 1, 2, 3].map((i) => ({ id: `l${i}`, kind: 'line', p1: pts[i].id, p2: pts[(i + 1) % 4].id }))
    const constraints = [
      { id: 'k1', type: 'horizontal', refs: ['l0'] },
      { id: 'k2', type: 'vertical', refs: ['l1'] },
      { id: 'k3', type: 'horizontal', refs: ['l2'] },
      { id: 'k4', type: 'vertical', refs: ['l3'] },
      { id: 'k5', type: 'coincident', refs: ['p1', 'O'] },
      { id: 'k6', type: 'distance', refs: ['l0'], value: 40 },
      { id: 'k7', type: 'distance', refs: ['l1'], value: 25 }
    ]
    const r = await (window as any).__cad.solveSketch({ points: pts, curves, constraints, next: 10 })
    return { state: r.state, dof: r.dof, p3: r.sketch.points[2] }
  })
  expect(res.state).toBe('ok')
  expect(res.dof).toBe(0)
  expect(res.p3.x).toBeCloseTo(40, 4)
  expect(res.p3.y).toBeCloseTo(25, 4)
  await app.close()
})

const sk = (win: any) => win.evaluate(() => (window as any).__cad.sketch.value)
const settle = (win: any) => win.evaluate(() => (window as any).__cad.sketchSettled())

async function clickAt(win: any, x: number, y: number) {
  const p = await project(win, x, y, 0)
  await win.mouse.move(p.x + 3, p.y + 3)
  await win.mouse.move(p.x, p.y)
  await win.mouse.click(p.x, p.y)
}

test('sketch mode: draw on the workplane, auto constraints, drag, undo', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.evaluate(() => ((window as any).__cad.gridStep.value = 1))

  // Sketch button, then click on empty ground: a sketch on the workplane opens
  await win.click('[data-testid=tb-sketch]')
  await expect(win.locator('.mode-hint')).toBeVisible()
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  await win.waitForTimeout(600) // camera turns to the plane

  // rectangle: two corners → 4 lines, 4 H/V constraints, 4 DOF
  await win.click('[data-testid=sk-tool-rect]')
  await clickAt(win, -30, -20)
  await clickAt(win, 10, 5)
  await settle(win)
  let s = await sk(win)
  expect(s.curves).toHaveLength(4)
  expect(s.constraints.filter((k: any) => k.type === 'horizontal' || k.type === 'vertical')).toHaveLength(4)
  await expect(win.locator('[data-testid=sk-status]')).toHaveAttribute('data-dof', '4')

  // polyline triangle starting on the rectangle's corner, nearly-horizontal edge becomes horizontal
  await win.click('[data-testid=sk-tool-line]')
  await clickAt(win, 10, 5) // snaps onto the corner
  await clickAt(win, 40, 5.3)
  await clickAt(win, 25, 30)
  await clickAt(win, 10, 5) // back to the first point closes the outline
  await settle(win)
  s = await sk(win)
  expect(s.curves).toHaveLength(7)
  expect(s.points).toHaveLength(6) // the triangle shares the rectangle's corner
  const lastLines = s.curves.slice(4)
  const horiz = s.constraints.filter((k: any) => k.type === 'horizontal' && k.refs[0] === lastLines[0].id)
  expect(horiz).toHaveLength(1)
  await win.screenshot({ path: '/tmp/cad-e2e-sketch-draw.png' })

  // circle, then drag its rim: radius follows
  await win.click('[data-testid=sk-tool-circle]')
  await clickAt(win, -50, 30)
  await clickAt(win, -40, 30)
  await settle(win)
  s = await sk(win)
  const circle = s.curves.find((k: any) => k.kind === 'circle')
  expect(circle.r).toBeCloseTo(10, 3)

  await win.keyboard.press('Escape') // back to select
  await expect(win.locator('[data-testid=sk-tool-select]')).toHaveClass(/on/)
  const a = await project(win, -40, 30, 0)
  const b = await project(win, -35, 30, 0)
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move((a.x + b.x) / 2, a.y, { steps: 3 })
  await win.mouse.move(b.x, b.y, { steps: 3 })
  await win.mouse.up()
  await settle(win)
  s = await sk(win)
  expect(s.curves.find((k: any) => k.id === circle.id).r).toBeCloseTo(15, 0)

  // undo brings the radius back, redo applies it again
  await win.keyboard.press('Control+z')
  await settle(win)
  s = await sk(win)
  expect(s.curves.find((k: any) => k.id === circle.id).r).toBeCloseTo(10, 3)
  await win.keyboard.press('Control+y')
  await settle(win)

  // select the circle and delete it
  await win.mouse.click(b.x, b.y)
  expect(await win.evaluate(() => (window as any).__cad.skSelection.value)).toEqual([circle.id])
  await win.keyboard.press('Delete')
  await settle(win)
  s = await sk(win)
  expect(s.curves.some((k: any) => k.kind === 'circle')).toBe(false)

  // "Done" asks how to extrude; the rectangle and the triangle become one shape
  await win.click('[data-testid=sk-done]')
  await expect(win.locator('[data-testid=extrude-dialog]')).toContainText('2')
  await win.click('[data-testid=extrude-ok]')
  await expect(win.locator('[data-testid=sketch-panel]')).toHaveCount(0)
  expect(await nodes(win)).toHaveLength(1)
  await expect(win.locator('[data-testid=shape-box]')).toBeVisible()
  expect(errors).toEqual([])
  await app.close()
})

test('sketch on a face of a box: plane follows the face', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=shape-box]')
  await win.waitForFunction(() => (window as any).__cad.geomBusy() === 0)
  await win.waitForTimeout(200)
  const top = await project(win, 0, 0, 20)
  await win.click('[data-testid=tb-sketch]')
  await win.mouse.click(top.x, top.y)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  const frame = await win.evaluate(() => (window as any).__cad.viewport.sketchEditor && (window as any).__cad.sessionFrame())
  expect(frame.position[2]).toBeCloseTo(20, 3)
  expect(frame.position[0]).toBeCloseTo(0, 3)
  await win.waitForTimeout(600)

  // a circle on the top face, extruded 5 mm: a peg standing on the box
  await win.keyboard.press('o')
  const a = await project(win, 0, 0, 20)
  const b = await project(win, 4, 0, 20)
  await win.mouse.click(a.x, a.y)
  await win.mouse.move(b.x, b.y)
  await win.mouse.click(b.x, b.y)
  await win.evaluate(() => (window as any).__cad.sketchSettled())
  await win.click('[data-testid=sk-done]')
  await win.fill('[data-testid=extrude-depth]', '5')
  await win.click('[data-testid=extrude-ok]')
  await idle(win)
  const list = await nodes(win)
  expect(list).toHaveLength(2)
  const peg = list[1].id
  const box = await win.evaluate((i) => (window as any).__cad.viewport.worldBoxes([i])[i], peg)
  expect(box.min[2]).toBeCloseTo(20, 3)
  expect(box.max[2]).toBeCloseTo(25, 3)
  expect(box.max[0] - box.min[0]).toBeCloseTo(8, 1)
  await app.close()
})

test('sketch tools: arcs, polygon, centered rectangle, point on a line, drag-to-draw', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await win.waitForTimeout(600)

  // arc around (0,0) from (20,0) counter-clockwise to (0,20): move the mouse through the sweep
  await win.click('[data-testid=sk-tool-arc]')
  await clickAt(win, 0, 0)
  await clickAt(win, 20, 0)
  for (const [x, y] of [[19, 6], [14, 14], [6, 19]]) {
    const p = await project(win, x, y, 0)
    await win.mouse.move(p.x, p.y)
  }
  await clickAt(win, 0, 20)
  await settle(win)
  let s = await sk(win)
  const arc = s.curves.find((k: any) => k.kind === 'arc')
  expect(arc.r).toBeCloseTo(20, 3)
  const start = s.points.find((p: any) => p.id === arc.start)
  const end = s.points.find((p: any) => p.id === arc.end)
  expect([start.x, start.y]).toEqual([20, 0])
  expect(end.x).toBeCloseTo(0, 3)
  expect(end.y).toBeCloseTo(20, 3)
  expect(arc.c).toBe('O') // the center snapped onto the sketch origin

  // 3-point arc: starts on the first arc's end, bulges up
  await win.click('[data-testid=sk-more-arc]')
  await win.click('[data-testid=sk-variant-arc3]')
  await clickAt(win, 0, 20)
  await clickAt(win, -20, 20)
  await clickAt(win, -10, 28)
  await settle(win)
  s = await sk(win)
  expect(s.curves.filter((k: any) => k.kind === 'arc')).toHaveLength(2)

  // hexagon
  await win.click('[data-testid=sk-tool-polygon]')
  await clickAt(win, 50, 40)
  await clickAt(win, 60, 40)
  await settle(win)
  s = await sk(win)
  expect(s.curves.filter((k: any) => k.kind === 'line' && !k.construction)).toHaveLength(6)
  expect(s.curves.filter((k: any) => k.kind === 'circle' && k.construction)).toHaveLength(1)

  // centered rectangle drawn by press-drag-release
  await win.click('[data-testid=sk-more-rect]')
  await win.click('[data-testid=sk-variant-rectCenter]')
  const a = await project(win, -50, -40, 0)
  const b = await project(win, -40, -35, 0)
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move(b.x, b.y, { steps: 5 })
  await win.mouse.up()
  await settle(win)
  s = await sk(win)
  const rectPts = s.points.filter((p: any) => Math.abs(Math.abs(p.x + 50) - 10) < 1e-6 && Math.abs(Math.abs(p.y + 40) - 5) < 1e-6)
  expect(rectPts).toHaveLength(4)
  expect(s.constraints.some((k: any) => k.type === 'midpoint')).toBe(true)

  // a point dropped on the rectangle's top edge stays on it
  await win.click('[data-testid=sk-tool-point]')
  await clickAt(win, -52, -35.2)
  await settle(win)
  s = await sk(win)
  expect(s.constraints.some((k: any) => k.type === 'pointOn')).toBe(true)

  // construction mode: new lines are helpers
  await win.keyboard.press('g')
  await win.keyboard.press('l')
  await clickAt(win, 30, -30)
  await clickAt(win, 45, -45)
  await win.keyboard.press('Enter')
  await settle(win)
  s = await sk(win)
  const last = s.curves[s.curves.length - 1]
  expect(last.kind).toBe('line')
  expect(last.construction).toBe(true)
  await win.screenshot({ path: '/tmp/cad-e2e-sketch-tools.png' })

  // cancel asks first when something was drawn
  win.once('dialog', (d) => d.accept())
  await win.click('[data-testid=sk-cancel]')
  await expect(win.locator('[data-testid=sketch-panel]')).toHaveCount(0)
  expect(errors).toEqual([])
  await app.close()
})

test('constraints and dimensions: fully constrained rectangle, conflicts are refused', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await win.waitForTimeout(600)
  await win.click('[data-testid=sk-tool-rect]')
  await clickAt(win, -30, -20)
  await clickAt(win, 10, 5)
  await settle(win)
  await win.keyboard.press('Escape') // select tool
  let s = await sk(win)
  const [bottom, right, top] = s.curves.map((k: any) => k.id)

  // bottom edge + D: a dimension appears with the current length and opens for typing
  await clickAt(win, -10, -20)
  expect(await win.evaluate(() => (window as any).__cad.skSelection.value)).toEqual([bottom])
  await win.keyboard.press('d')
  await settle(win)
  s = await sk(win)
  const dim = s.constraints.find((k: any) => k.type === 'distance')
  expect(dim.value).toBe(40)
  const input = win.locator(`[data-testid=skdim-input-${dim.id}]`)
  await expect(input).toBeVisible()
  await input.fill('50')
  await input.press('Enter')
  await settle(win)
  s = await sk(win)
  const xs = s.points.map((p: any) => p.x)
  expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 4)

  // right edge via the panel button, then type 30 into its label
  await win.waitForTimeout(100)
  const rp = s.points.find((p: any) => p.x === Math.max(...xs))
  await clickAt(win, rp.x, -5)
  expect(await win.evaluate(() => (window as any).__cad.skSelection.value)).toEqual([right])
  await win.click('[data-testid=sk-c-dimension]')
  await settle(win)
  s = await sk(win)
  const dim2 = s.constraints.filter((k: any) => k.type === 'distance')[1]
  await win.locator(`[data-testid=skdim-input-${dim2.id}]`).fill('30')
  await win.locator(`[data-testid=skdim-input-${dim2.id}]`).press('Enter')
  await settle(win)

  // bottom-left corner onto the origin: nothing is free any more
  s = await sk(win)
  const bl = s.points.reduce((a: any, b: any) => (a.x + a.y <= b.x + b.y ? a : b))
  await clickAt(win, bl.x, bl.y)
  const o = await project(win, 0, 0, 0)
  await win.keyboard.down('Shift')
  await win.mouse.click(o.x, o.y)
  await win.keyboard.up('Shift')
  await win.keyboard.press('c')
  await settle(win)
  await expect(win.locator('[data-testid=sk-status]')).toHaveAttribute('data-dof', '0')
  await expect(win.locator('[data-testid=sk-status]')).toHaveClass(/full/)
  s = await sk(win)
  const tr = s.points.reduce((a: any, b: any) => (a.x + a.y >= b.x + b.y ? a : b))
  expect(tr.x).toBeCloseTo(50, 4)
  expect(tr.y).toBeCloseTo(30, 4)

  // badges for the H/V constraints are shown
  expect(await win.locator('.sk-badge[data-type=horizontal]').count()).toBe(2)

  // a dimension on the top edge would contradict the others: refused with a message
  const n = s.constraints.length
  await clickAt(win, 25, 30)
  expect(await win.evaluate(() => (window as any).__cad.skSelection.value)).toEqual([top])
  await win.keyboard.press('d')
  await settle(win)
  await expect(win.locator('.toast.error')).toBeVisible()
  expect((await sk(win)).constraints.length).toBe(n)
  await win.screenshot({ path: '/tmp/cad-e2e-sketch-constraints.png' })

  // perpendicular without a fitting selection shows what to select
  await win.keyboard.press('Escape')
  await win.click('[data-testid=sk-c-perpendicular]')
  await expect(win.locator('.toast.error').last()).toContainText('две линии')

  // select a dimension label and delete it: one degree of freedom comes back
  await win.locator(`[data-testid=skdim-${dim2.id}]`).click({ modifiers: ['Shift'] })
  await win.keyboard.press('Delete')
  await settle(win)
  await expect(win.locator('[data-testid=sk-status]')).toHaveAttribute('data-dof', '1')
  expect(errors).toEqual([])
  await app.close()
})

test('extrude a sketch into a shape, re-edit it, undo', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await win.waitForTimeout(600)

  // an open polyline first: the dialog says there is nothing to extrude
  await clickAt(win, -40, 30)
  await clickAt(win, -20, 30)
  await win.keyboard.press('Enter')
  await settle(win)
  await win.click('[data-testid=sk-done]')
  await expect(win.locator('[data-testid=extrude-none]')).toBeVisible()
  await win.click('[data-testid=extrude-back]')
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
  await win.evaluate(() => {
    const cad = (window as any).__cad
    cad.skSelection.value = cad.sketch.value.curves.map((k: any) => k.id)
  })
  await win.keyboard.press('Delete')
  await settle(win)

  // rectangle from the origin, 40 × 20
  await win.keyboard.press('r')
  await clickAt(win, 0, 0)
  await clickAt(win, 40, 20)
  await settle(win)
  await win.click('[data-testid=sk-done]')
  await expect(win.locator('[data-testid=extrude-dialog]')).toBeVisible()
  await win.fill('[data-testid=extrude-depth]', '10')
  await win.click('[data-testid=extrude-ok]')
  await expect(win.locator('[data-testid=sketch-panel]')).toHaveCount(0)
  await idle(win)
  await win.waitForTimeout(800) // the camera turns back to the 3/4 view

  const list = await nodes(win)
  expect(list).toHaveLength(1)
  expect(list[0].prim).toBe('sketch')
  const id = list[0].id
  const box = async () => win.evaluate((i) => (window as any).__cad.viewport.worldBoxes([i])[i], id)
  let b = await box()
  expect(b.min.map((v: number) => Math.round(v * 1000) / 1000)).toEqual([0, 0, 0])
  expect(b.max.map((v: number) => Math.round(v * 1000) / 1000)).toEqual([40, 20, 10])
  await win.screenshot({ path: '/tmp/cad-e2e-extruded.png' })

  // double-click the shape: its sketch opens again; make it 60 wide with a dimension
  const top = await project(win, 20, 10, 10)
  await win.mouse.dblclick(top.x, top.y)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  await win.waitForTimeout(600)
  await clickAt(win, 20, 0) // bottom edge (select tool is active when re-editing)
  await win.keyboard.press('d')
  await settle(win)
  const dim = (await sk(win)).constraints.find((k: any) => k.type === 'distance')
  await win.locator(`[data-testid=skdim-input-${dim.id}]`).fill('60')
  await win.locator(`[data-testid=skdim-input-${dim.id}]`).press('Enter')
  await settle(win)
  await win.click('[data-testid=sk-done]')
  await expect(win.locator('[data-testid=extrude-depth]')).toHaveValue('10')
  await win.click('[data-testid=extrude-both]')
  await win.click('[data-testid=extrude-ok]')
  await idle(win)
  expect(await nodes(win)).toHaveLength(1)
  b = await box()
  expect(b.max[0] - b.min[0]).toBeCloseTo(60, 3)
  expect(b.min[2]).toBeCloseTo(-5, 3)

  // one undo step brings the old shape back
  await win.keyboard.press('Control+z')
  await idle(win)
  b = await box()
  expect(b.max[0] - b.min[0]).toBeCloseTo(40, 3)
  expect(b.min[2]).toBeCloseTo(0, 3)
  expect(errors).toEqual([])
  await app.close()
})

test('fillet a corner and trim a line, then look at the help legend', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await win.waitForTimeout(600)
  await win.keyboard.press('r')
  await clickAt(win, 0, 0)
  await clickAt(win, 40, 30)
  await settle(win)

  // round the top-right corner with R 8
  await win.click('[data-testid=sk-tool-fillet]')
  await win.fill('[data-testid=sk-fillet-r]', '8')
  await win.locator('[data-testid=sk-fillet-r]').press('Enter')
  await clickAt(win, 40, 30)
  await settle(win)
  let s = await sk(win)
  const arc = s.curves.find((k: any) => k.kind === 'arc')
  expect(arc.r).toBeCloseTo(8, 4)
  expect(s.constraints.filter((k: any) => k.type === 'tangent')).toHaveLength(2)

  // a line across the rectangle: trim away the part sticking out on the left
  await win.keyboard.press('l')
  await clickAt(win, -10, 15)
  await clickAt(win, 20, 15)
  await win.keyboard.press('Enter')
  await settle(win)
  s = await sk(win)
  const cross = s.curves[s.curves.length - 1]
  await win.click('[data-testid=sk-tool-trim]')
  await clickAt(win, -5, 15)
  await settle(win)
  s = await sk(win)
  const trimmed = s.curves.find((k: any) => k.id === cross.id)
  const p1 = s.points.find((p: any) => p.id === trimmed.p1)
  expect(p1.x).toBeCloseTo(0, 4)
  await win.screenshot({ path: '/tmp/cad-e2e-sketch-fillet.png' })

  // the help dialog lists the constraint badges
  await win.keyboard.press('F1')
  await expect(win.locator('.help-legend-item')).toHaveCount(11)
  await win.keyboard.press('Escape')
  expect(errors).toEqual([])
  await app.close()
})

test('revolve a sketch: around the Y axis and around a helper line', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=tb-sketch]')
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await win.waitForTimeout(600)

  // a 10 × 20 rectangle standing on the Y axis → a cylinder of radius 10
  await win.keyboard.press('r')
  await clickAt(win, 0, 0)
  await clickAt(win, 10, 20)
  await settle(win)
  await win.click('[data-testid=sk-done]')
  await win.click('[data-testid=op-revolve]')
  await expect(win.locator('[data-testid=revolve-axis]')).toHaveValue('AY')
  await expect(win.locator('[data-testid=revolve-crosses]')).toHaveCount(0)
  await win.click('[data-testid=extrude-ok]')
  await idle(win)
  await win.waitForTimeout(800)
  let list = await nodes(win)
  expect(list[0].params.op).toBe('revolve')
  const box = (i: string) => win.evaluate((id) => (window as any).__cad.viewport.worldBoxes([id])[id], i)
  let b = await box(list[0].id)
  expect(b.min[0]).toBeCloseTo(-10, 2)
  expect(b.max[0]).toBeCloseTo(10, 2)
  expect(b.max[1]).toBeCloseTo(20, 2)
  expect(b.max[2]).toBeCloseTo(10, 2)
  expect(b.min[2]).toBeCloseTo(-10, 2)
  await win.screenshot({ path: '/tmp/cad-e2e-revolve.png' })

  // re-editing keeps "revolve"; half a turn around a helper line instead
  await win.evaluate((id) => (window as any).__cad.actions.editSketch(id), list[0].id)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  await win.waitForTimeout(600)
  await win.keyboard.press('g') // construction mode for new lines
  await win.keyboard.press('l')
  await clickAt(win, 30, 0)
  await clickAt(win, 30, 20)
  await win.keyboard.press('Enter')
  await settle(win)
  await win.click('[data-testid=sk-done]')
  await expect(win.locator('[data-testid=op-revolve]')).toHaveClass(/on/)
  const helper = (await sk(win)).curves.find((k: any) => k.construction).id
  await win.selectOption('[data-testid=revolve-axis]', helper)
  // the chosen axis is highlighted in the drawing
  await expect.poll(() => win.evaluate(() => (window as any).__cad.skSelection.value)).toEqual([helper])
  await win.fill('[data-testid=revolve-angle]', '180')
  await win.click('[data-testid=extrude-ok]')
  await idle(win)
  list = await nodes(win)
  expect(list).toHaveLength(1)
  expect(list[0].params.angle).toBe(180)
  b = await box(list[0].id)
  // the rectangle (x 0…10) turned half-way round the line x = 30: from x = 0 to x = 60, out of the plane
  expect(b.min[0]).toBeCloseTo(0, 2)
  expect(b.max[0]).toBeCloseTo(60, 2)
  expect(b.min[2]).toBeCloseTo(0, 2)
  expect(b.max[2]).toBeCloseTo(30, 1)
  expect(errors).toEqual([])
  await app.close()
})
