import { expect, test } from '@playwright/test'
import { launch } from './app'

test('the toolbar fits common screen sizes in every tab and language', async () => {
  test.setTimeout(360_000)
  const { app, win } = await launch()
  await win.evaluate(() => (window as any).__cad.actions.addShape('box'))
  const problems: string[] = []
  for (const lang of ['ru', 'en', 'zh']) {
    await win.getByTestId('tb-lang').click()
    await win.getByTestId(`lang-${lang}`).click()
    for (const mode of ['mode-3d', 'tb-sketch', 'mode-robotics', 'mode-circuits']) {
      await win.getByTestId(mode).click()
      for (const [w, h] of [[1920, 1080], [1536, 864], [1366, 768], [1280, 720], [1024, 700]]) {
        await win.setViewportSize({ width: w, height: h })
        // the toolbar re-fits after the window settles (slow under software rendering): give it time
        let over = 0
        for (let i = 0; i < 12; i++) {
          await win.waitForTimeout(250)
          over = await win.evaluate(() => {
            const tb = document.querySelector('.toolbar') as HTMLElement
            return tb.scrollWidth - tb.clientWidth
          })
          if (over <= 1) break
        }
        if (over > 1) problems.push(`${lang} ${mode} ${w}: ${over}px`)
      }
      if (mode === 'tb-sketch') await win.keyboard.press('Escape')
    }
    await win.getByTestId('mode-3d').click()
  }
  // the language is remembered between launches: leave Russian for the next tests
  await win.getByTestId('tb-lang').click()
  await win.getByTestId('lang-ru').click()
  expect(problems).toEqual([])
  await app.close()
})

test('tools that do not fit are in «More» and still work', async () => {
  const { app, win } = await launch()
  await win.evaluate(() => ((window as any).__cad.lang.value = 'ru'))
  await win.setViewportSize({ width: 1280, height: 720 })
  await win.evaluate(() => (window as any).__cad.actions.addShape('cone'))
  await win.waitForTimeout(400)
  await expect(win.getByTestId('tb-mirror')).toBeHidden()
  await win.getByTestId('tb-more').click()
  await win.locator('.more-menu .menu-item', { hasText: /Z/ }).first().click()
  const rot = await win.evaluate(() => (window as any).__cad.doc.value.nodes[0].transform)
  // mirrored along Z: the scale's Z turned negative
  expect(rot.scale[2]).toBeLessThan(0)
  await win.setViewportSize({ width: 1920, height: 1080 })
  await win.waitForTimeout(400)
  await expect(win.getByTestId('tb-mirror')).toBeVisible()
  await expect(win.getByTestId('tb-more')).toBeHidden()
  await app.close()
})
