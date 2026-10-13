import { expect, test } from '@playwright/test'
import { idle, launch, project } from './app'

/** Type like a person: one key at a time with pauses, so the app re-renders between keys. */
const typeSlowly = async (win: import('@playwright/test').Page, text: string) => {
  for (const ch of text) {
    await win.keyboard.type(ch)
    await win.waitForTimeout(250)
  }
}

test('multi-digit numbers can be typed in the extrude and revolve dialog', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=tb-sketch]')
  const c = await project(win, 0, 0, 0)
  await win.mouse.click(c.x + 300, c.y - 200)
  await expect(win.locator('[data-testid=sketch-panel]')).toBeVisible()
  await win.waitForTimeout(600)
  await win.keyboard.press('o')
  const a = await project(win, 0, 0, 0)
  const b = await project(win, 6, 0, 0)
  await win.mouse.click(a.x, a.y)
  await win.mouse.move(b.x, b.y)
  await win.mouse.click(b.x, b.y)
  await win.evaluate(() => (window as any).__cad.sketchSettled())
  await win.click('[data-testid=sk-done]')
  // the depth field is focused with its text selected: typing replaces it, then keeps adding
  await expect(win.getByTestId('extrude-depth')).toBeFocused()
  await typeSlowly(win, '125')
  await expect(win.getByTestId('extrude-depth')).toHaveValue('125')
  await win.click('[data-testid=op-revolve]')
  await expect(win.getByTestId('revolve-angle')).toBeFocused()
  await typeSlowly(win, '270')
  await expect(win.getByTestId('revolve-angle')).toHaveValue('270')
  await app.close()
})

test('multi-digit numbers can be typed in dimension labels and the inspector', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=shape-box]')
  await idle(win)
  await win.click('[data-testid=dim-size0]')
  await expect(win.getByTestId('dim-input-size0')).toBeFocused()
  await typeSlowly(win, '345')
  await expect(win.getByTestId('dim-input-size0')).toHaveValue('345')
  await win.keyboard.press('Escape')
  await win.getByTestId('pos-0').click()
  await typeSlowly(win, '678')
  await expect(win.getByTestId('pos-0')).toHaveValue('678')
  await app.close()
})

test('multi-digit numbers can be typed in the robot blocks', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await win.getByTestId('load-demo').click()
  await win.waitForTimeout(1500)
  await win.locator('.blocklyBlockCanvas .blocklyEditableField').nth(2).click()
  await win.waitForTimeout(300)
  await typeSlowly(win, '789')
  await expect(win.locator('.blocklyHtmlInput')).toHaveValue('789')
  await app.close()
})
