import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

test('materials: glowing and glass are chosen in the inspector and saved', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=shape-box]')
  await idle(win)
  await expect(win.locator('[data-testid=mat-normal]')).toHaveClass(/on/)
  await win.click('[data-testid=mat-glow]')
  expect((await nodes(win))[0].material).toBe('glow')
  const look = () =>
    win.evaluate(() => {
      const cad = (window as any).__cad
      const o = cad.viewport.sync.objects.get(cad.doc.value.nodes[0].id)
      const m = o.mesh.material
      return { transparent: m.transparent, opacity: m.opacity, emissive: m.emissiveIntensity }
    })
  expect((await look()).emissive).toBeGreaterThan(0.5)
  await win.click('[data-testid=mat-glass]')
  expect((await nodes(win))[0].material).toBe('glass')
  expect(await look()).toMatchObject({ transparent: true })
  expect((await look()).opacity).toBeLessThan(0.5)
  await win.click('[data-testid=mat-normal]')
  expect((await nodes(win))[0].material).toBeUndefined()
  await app.close()
})

test('a gear from the Parametric tab: teeth and module change its size', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=shapes-tab-param]')
  await win.click('[data-testid=shape-gear]')
  await idle(win)
  const g = (await nodes(win))[0]
  expect(g.prim).toBe('gear')
  await expect(win.locator('[data-testid=gear-info]')).toContainText('32')
  const width = async () => {
    await idle(win)
    await win.waitForTimeout(200)
    return win.evaluate((id: string) => {
      const b = (window as any).__cad.viewport.worldBoxes([id])[id]
      return b.max[0] - b.min[0]
    }, g.id)
  }
  expect(await width()).toBeCloseTo(36, 0) // m 2 × (16 + 2)
  await win.fill('[data-testid=gear-teeth]', '24')
  await win.locator('[data-testid=gear-teeth]').press('Enter')
  expect(await width()).toBeCloseTo(52, 0)
  await win.fill('[data-testid=gear-module]', '1')
  await win.locator('[data-testid=gear-module]').press('Enter')
  expect(await width()).toBeCloseTo(26, 0)
  await expect(win.locator('[data-testid=gear-info]')).toContainText('24')
  await app.close()
})

test('a sketch on the ZX plane stands upright', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=plane-zx]')
  await win.click('[data-testid=tb-sketch]')
  // a point of the ZX plane (y = 0), up in the air above the ground
  const p = await project(win, 30, 0, 60)
  await win.mouse.click(p.x, p.y)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  const frame = await win.evaluate(() => (window as any).__cad.sessionFrame())
  expect(frame.position).toEqual([0, 0, 0])
  // the sketch normal is ±Y: the plane is vertical
  const n = await win.evaluate((f: any) => {
    const r = f.rotation.map((d: number) => (d * Math.PI) / 180)
    // rotate (0,0,1) by the XYZ Euler angles
    const [a, b] = r
    return [Math.sin(b), -Math.sin(a) * Math.cos(b), Math.cos(a) * Math.cos(b)]
  }, frame)
  expect(Math.abs(n[1])).toBeCloseTo(1, 3)
  await win.click('[data-testid=sk-cancel]')
  await app.close()
})

test('symmetry across ZY: the twin follows the shape and the shape follows the twin', async () => {
  const { app, win } = await launch()
  await win.evaluate(() => {
    const cad = (window as any).__cad
    cad.actions.addShape('box', { position: [30, 10, 0], rotation: [0, 0, 0] })
  })
  await idle(win)
  await win.click('[data-testid=sym-zy]')
  await expect(win.locator('[data-testid=sym-zy]')).toHaveClass(/on/)
  // the plane is shown with it
  await expect(win.locator('[data-testid=plane-zy]')).toHaveClass(/on/)
  await idle(win)
  let ns = await nodes(win)
  expect(ns).toHaveLength(2)
  const [a, tw] = ns
  expect(tw.transform.position).toEqual([-30, 10, 0])

  // move the shape with the inspector: the twin mirrors it
  await win.evaluate((id: string) => ((window as any).__cad.selection.value = [id]), a.id)
  await win.fill('[data-testid=pos-1]', '25')
  await win.locator('[data-testid=pos-1]').press('Enter')
  ns = await nodes(win)
  expect(ns.find((n: any) => n.id === tw.id).transform.position).toEqual([-30, 25, 0])

  // drag the twin with the mouse: the shape moves too
  await win.evaluate(() => ((window as any).__cad.selection.value = []))
  await idle(win)
  const from = await project(win, -30, 25, 10)
  const to = await project(win, -50, 25, 10)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 8 })
  await win.mouse.up()
  await idle(win)
  ns = await nodes(win)
  const na = ns.find((n: any) => n.id === a.id)
  const nt = ns.find((n: any) => n.id === tw.id)
  expect(na.transform.position[0]).toBeCloseTo(-nt.transform.position[0], 6)
  expect(na.transform.position[0]).toBeGreaterThan(40)

  // off: the twin stays as a normal shape
  await win.click('[data-testid=sym-zy]')
  ns = await nodes(win)
  expect(ns).toHaveLength(2)
  expect(ns.every((n: any) => !n.mirrorOf)).toBe(true)
  await app.close()
})
