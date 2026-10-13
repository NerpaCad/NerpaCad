import { expect, test } from '@playwright/test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes } from './app'

test('the language menu switches to Simplified Chinese and back', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=tb-lang]')
  await expect(win.locator('[data-testid=lang-zh]')).toHaveText(/简体中文/)
  await win.click('[data-testid=lang-zh]')
  await expect(win.locator('[data-testid=shapes-tab-basic]')).toHaveText('基本')
  await expect(win.locator('[data-testid=tb-lang]')).toContainText('中文')
  expect(await win.evaluate(() => document.documentElement.lang)).toBe('zh-Hans')
  await win.click('[data-testid=tb-lang]')
  await win.click('[data-testid=lang-ru]')
  await expect(win.locator('[data-testid=shapes-tab-basic]')).toHaveText('Основные')
  await app.close()
})

test('the logo opens About with the version and the licence', async () => {
  const { app, win } = await launch()
  expect(await win.title()).toContain('NerpaCad')
  const logo = win.locator('[data-testid=brand] img')
  await expect(logo).toBeVisible()
  expect(await logo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await win.click('[data-testid=brand]')
  await expect(win.locator('[data-testid=about]')).toBeVisible()
  await expect(win.locator('[data-testid=about-version]')).toContainText('0.2.0')
  await expect(win.locator('[data-testid=about]')).toContainText('GPL')
  await win.keyboard.press('Escape')
  await expect(win.locator('[data-testid=about]')).toHaveCount(0)
  await app.close()
})

test('an old Cad System .tcad file opens and is saved as a new .nerpa', async () => {
  const { app, win } = await launch()
  const stamp = Date.now()
  const old = join(tmpdir(), `legacy-${stamp}.tcad`)
  const box = {
    id: 'b1', kind: 'prim', prim: 'box', name: 'Box', color: '#ff0000', isHole: false,
    transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] }, params: {}
  }
  writeFileSync(old, JSON.stringify({ format: 'cad-system-project', version: 1, app: 'Cad System', doc: { version: 1, nodes: [box], meshes: {} } }))
  const saved = join(tmpdir(), `legacy-${stamp}.nerpa`)
  await app.evaluate(({ dialog }, [o, s]) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [o] })) as any
    dialog.showSaveDialog = (async (_w: unknown, opts: { defaultPath: string }) => {
      ;(globalThis as any).__askedName = opts.defaultPath
      return { canceled: false, filePath: s }
    }) as any
  }, [old, saved])
  await win.click('[data-testid=tb-open]')
  await expect.poll(async () => (await nodes(win)).length).toBe(1)
  await idle(win)
  expect(await win.title()).toContain('.tcad')
  await win.keyboard.press('Control+S')
  await expect.poll(() => existsSync(saved)).toBe(true)
  const asked = await app.evaluate(() => (globalThis as any).__askedName)
  expect(asked).toBe(`legacy-${stamp}.nerpa`)
  expect(await win.title()).toContain('.nerpa')
  rmSync(old)
  rmSync(saved)
  await app.close()
})
