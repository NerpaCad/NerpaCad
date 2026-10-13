import { expect, test } from '@playwright/test'
import { launch, project } from './app'

const sk = (win: any) => win.evaluate(() => (window as any).__cad.sketch.value)
const settle = (win: any) => win.evaluate(() => (window as any).__cad.sketchSettled())

async function clickAt(win: any, x: number, y: number) {
  const p = await project(win, x, y, 0)
  await win.mouse.move(p.x + 3, p.y + 3)
  await win.mouse.move(p.x, p.y)
  await win.mouse.click(p.x, p.y)
}

async function dragFromTo(win: any, a: [number, number], b: [number, number]) {
  const p = await project(win, a[0], a[1], 0)
  const q = await project(win, b[0], b[1], 0)
  await win.mouse.move(p.x, p.y)
  await win.mouse.down()
  await win.mouse.move(q.x, q.y, { steps: 8 })
  await win.mouse.up()
}

test('a fillet can be resized by dragging its centre or its end; the radius dimension follows; Ctrl+Z undoes', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.evaluate(() => ((window as any).__cad.gridStep.value = 0))
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
  await win.click('[data-testid=sk-tool-fillet]')
  await win.fill('[data-testid=sk-fillet-r]', '6')
  await win.locator('[data-testid=sk-fillet-r]').press('Enter')
  await clickAt(win, 40, 30)
  await settle(win)
  await win.keyboard.press('q')
  let s = await sk(win)
  const arc = s.curves.find((k: any) => k.kind === 'arc')
  const ctr = s.points.find((p: any) => p.id === arc.c)
  const radius = () => s.constraints.find((k: any) => k.type === 'radius').value
  expect(radius()).toBeCloseTo(6, 3)

  // pull the centre in toward the inside of the corner: the fillet grows
  await dragFromTo(win, [ctr.x, ctr.y], [ctr.x - 6, ctr.y - 6])
  await settle(win)
  s = await sk(win)
  const grown = radius()
  expect(grown).toBeGreaterThan(9)
  const a2 = s.curves.find((k: any) => k.kind === 'arc')
  expect(a2.r).toBeCloseTo(grown, 2)

  // pull one end back toward the corner: it shrinks
  const end = s.points.find((p: any) => p.id === a2.start)
  const corner: [number, number] = [40, 30]
  const toward: [number, number] = [end.x + (corner[0] - end.x) * 0.6, end.y + (corner[1] - end.y) * 0.6]
  await dragFromTo(win, [end.x, end.y], toward)
  await settle(win)
  s = await sk(win)
  expect(radius()).toBeLessThan(grown - 2)

  // one Ctrl+Z per drag
  await win.keyboard.press('Control+z')
  await settle(win)
  s = await sk(win)
  expect(radius()).toBeCloseTo(grown, 2)
  expect(errors).toEqual([])
  await app.close()
})
