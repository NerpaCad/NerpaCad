import { expect, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes, project } from './app'

const setField = async (win: any, id: string, v: number | string) => {
  await win.fill(`[data-testid=${id}]`, String(v))
  await win.press(`[data-testid=${id}]`, 'Enter')
}

test('ruler: place it, read and type distances, switch to center, remove', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))

  await win.click('[data-testid=shape-box]')
  await idle(win)
  await setField(win, 'pos-0', 30)
  await setField(win, 'pos-1', 20)
  await idle(win)

  // R, then click on the ground at (-40, -30)
  await win.keyboard.press('r')
  await expect(win.locator('.mode-hint')).toBeVisible()
  const p = await project(win, -40, -30, 0)
  await win.mouse.move(p.x + 5, p.y + 5)
  await win.mouse.move(p.x, p.y)
  await win.mouse.click(p.x, p.y)
  const r = await win.evaluate(() => (window as any).__cad.ruler.value)
  expect(r.position[0]).toBeCloseTo(-40, 0)
  expect(r.position[1]).toBeCloseTo(-30, 0)
  const rx = r.position[0]
  const ry = r.position[1]

  // the box (20 mm, center 30/20) is measured to its near edges
  await expect(win.locator('[data-testid=dim-rulerX]')).toHaveText(String(20 - rx))
  await expect(win.locator('[data-testid=dim-rulerY]')).toHaveText(String(10 - ry))
  await win.screenshot({ path: join(tmpdir(), 'cad-e2e-ruler.png') })

  // type a distance: the box moves along the ruler's X leg
  await win.click('[data-testid=dim-rulerX]')
  await win.fill('[data-testid=dim-input-rulerX]', '50')
  await win.press('[data-testid=dim-input-rulerX]', 'Enter')
  const box = (await nodes(win))[0]
  expect(box.transform.position[0]).toBeCloseTo(rx + 50 + 10, 4)
  expect(box.transform.position[1]).toBeCloseTo(20, 4)

  // measure to the center instead
  await win.click('[data-testid=ruler-mode]')
  await expect(win.locator('[data-testid=dim-rulerX]')).toHaveText('60')

  // remove the ruler
  await win.click('[data-testid=ruler-remove]')
  expect(await win.evaluate(() => (window as any).__cad.ruler.value)).toBeNull()
  await expect(win.locator('[data-testid=dim-rulerX]')).toHaveCount(0)

  expect(errors).toEqual([])
  await app.close()
})
