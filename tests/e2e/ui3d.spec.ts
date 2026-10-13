import { expect, test } from '@playwright/test'
import { launch } from './app'

test('three tabs; the sketch starts from one button in the 3D tab', async () => {
  const { app, win } = await launch()
  await expect(win.locator('.mode-switch button')).toHaveCount(3)
  await expect(win.locator('[data-testid=mode-3d]')).toHaveClass(/on/)
  await expect(win.locator('[data-testid=tb-sketch]')).toContainText('Эскиз')
  // the sketch belongs to 3D: the tab stays on while picking a plane and while drawing
  await win.click('[data-testid=tb-sketch]')
  await expect(win.locator('[data-testid=tb-sketch]')).toHaveClass(/active|on/)
  await expect(win.locator('[data-testid=mode-3d]')).toHaveClass(/on/)
  const c = await win.evaluate(() => {
    const r = document.querySelector('[data-testid=viewport] canvas')!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await win.mouse.click(c.x, c.y)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  await expect(win.locator('[data-testid=tb-sketch]')).toContainText('Готово')
  await win.click('[data-testid=sk-cancel]')
  await expect(win.locator('[data-testid=sketch-panel]')).toHaveCount(0)
  // no sketch button on the robotics field or in circuits
  await win.click('[data-testid=mode-robotics]')
  await expect(win.locator('[data-testid=tb-sketch]')).toHaveCount(0)
  await win.click('[data-testid=mode-circuits]')
  await expect(win.locator('[data-testid=tb-sketch]')).toHaveCount(0)
  await app.close()
})

test('shapes panel tabs and the ZY / ZX plane switches instead of the home view', async () => {
  const { app, win } = await launch()
  await expect(win.locator('[data-testid=view-home]')).toHaveCount(0)
  await expect(win.locator('[data-testid=shapes-tab-basic]')).toHaveClass(/on/)
  await win.click('[data-testid=shapes-tab-param]')
  await expect(win.locator('[data-testid=shape-gear]')).toBeVisible()
  await expect(win.locator('[data-testid=shape-box]')).toHaveCount(0)
  await win.click('[data-testid=shapes-tab-basic]')
  await expect(win.locator('[data-testid=shape-box]')).toBeVisible()

  const visible = () => win.evaluate(() => {
    const p = (window as any).__cad.viewport.refPlanes
    return [p.isVisible('zy'), p.isVisible('zx')]
  })
  expect(await visible()).toEqual([false, false])
  await win.click('[data-testid=plane-zy]')
  expect(await visible()).toEqual([true, false])
  await expect(win.locator('[data-testid=plane-zy]')).toHaveClass(/on/)
  await win.click('[data-testid=plane-zx]')
  expect(await visible()).toEqual([true, true])
  // the planes belong to the 3D scene: hidden on the robotics field, back in 3D
  await win.click('[data-testid=mode-robotics]')
  expect(await visible()).toEqual([false, false])
  await expect(win.locator('[data-testid=plane-zy]')).toHaveCount(0)
  await win.click('[data-testid=mode-3d]')
  expect(await visible()).toEqual([true, true])
  await win.click('[data-testid=plane-zy]')
  await win.click('[data-testid=plane-zx]')
  expect(await visible()).toEqual([false, false])
  await app.close()
})
