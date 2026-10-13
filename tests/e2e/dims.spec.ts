import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes, project } from './app'

const setField = async (win: any, id: string, v: number | string) => {
  await win.fill(`[data-testid=${id}]`, String(v))
  await win.press(`[data-testid=${id}]`, 'Enter')
}

const worldBox = (win: any, id: string) =>
  win.evaluate((i: string) => (window as any).__cad.viewport.sync.worldBox(i), id)

test('dimension labels, elevation, shadow and smart guides', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))

  await win.click('[data-testid=shape-box]')
  await idle(win)
  const a = (await nodes(win))[0]

  // size labels appear next to the selected shape; typing a number resizes it
  await expect(win.locator('[data-testid=dim-size0]')).toBeVisible()
  await expect(win.locator('[data-testid=dim-size0]')).toHaveText('20')
  await win.click('[data-testid=dim-size0]')
  await win.fill('[data-testid=dim-input-size0]', '30')
  await win.press('[data-testid=dim-input-size0]', 'Enter')
  await idle(win)
  let b = await worldBox(win, a.id)
  expect(b.max[0] - b.min[0]).toBeCloseTo(30, 4)
  await expect(win.locator('[data-testid=dim-size0]')).toHaveText('30')

  // lift it: elevation label and a shadow on the workplane
  for (let i = 0; i < 5; i++) await win.keyboard.press('Control+ArrowUp')
  await expect(win.locator('[data-testid=dim-elev]')).toHaveText('↑ 5')
  expect(await win.evaluate(() => (window as any).__cad.viewport.shadows.children.length)).toBeGreaterThan(1)
  await win.screenshot({ path: join(tmpdir(), 'cad-e2e-dims.png') })
  // type an exact elevation
  await win.click('[data-testid=dim-elev]')
  await win.fill('[data-testid=dim-input-elev]', '12')
  await win.press('[data-testid=dim-input-elev]', 'Enter')
  b = await worldBox(win, a.id)
  expect(b.min[2]).toBeCloseTo(12, 4)
  await win.click('[data-testid=dim-elev]')
  await win.fill('[data-testid=dim-input-elev]', '0')
  await win.press('[data-testid=dim-input-elev]', 'Enter')
  await expect(win.locator('[data-testid=dim-elev]')).toHaveCount(0)
  expect(await win.evaluate(() => (window as any).__cad.viewport.shadows.children.length)).toBe(0)

  // smart guides: with the grid off, a second box snaps into line with the first
  await win.selectOption('[data-testid=grid-step]', '0')
  await win.click('[data-testid=shape-box]')
  await idle(win)
  const bId = (await nodes(win))[1].id
  await setField(win, 'pos-0', 50)
  await setField(win, 'pos-1', 3.3)
  await idle(win)
  // grab the top face off-center (the center has the height handle)
  const from = await project(win, 55, 8.3, 20)
  const to = await project(win, 50, 6.5, 20)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 })
  await win.mouse.move(to.x, to.y, { steps: 4 })
  expect(
    await win.evaluate(() => (window as any).__cad.viewport.guides.geometry.getAttribute('position').count)
  ).toBeGreaterThan(0)
  await win.screenshot({ path: join(tmpdir(), 'cad-e2e-guides.png') })
  await win.mouse.up()
  const moved = (await nodes(win)).find((n: any) => n.id === bId)
  expect(Math.abs(moved.transform.position[1])).toBeLessThan(1e-6) // lined up with box A (y = 0)
  expect(moved.transform.position[0]).toBeLessThan(49)

  expect(errors).toEqual([])
  await app.close()
})
