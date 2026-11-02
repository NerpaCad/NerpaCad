/**
 * Recent projects: a saved project goes into the list with a picture; next time the app opens on
 * the start screen with it, one click opens it; a project whose file is gone is greyed out and can
 * be taken off the list; the "…" menu shows the screen again.
 */
import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes } from './app'

test('recent projects: saved → on the start screen next time with a picture → opened with a click', async () => {
  test.setTimeout(90000)
  const dir = mkdtempSync(join(tmpdir(), 'nerpa-recent-test-'))
  const list = join(dir, 'recent.json')
  const file = join(dir, 'Мой робот.nerpa')
  const env = { CAD_RECENT_FILE: list }
  let { app, win } = await launch(env)
  // a new user: no list, no start screen
  await win.waitForTimeout(800)
  await expect(win.getByTestId('start-screen')).toHaveCount(0)
  await win.click('[data-testid=shape-box]')
  await idle(win)
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as any
  }, file)
  await win.keyboard.press('Control+S')
  await expect.poll(() => existsSync(list)).toBe(true)
  const saved = JSON.parse(readFileSync(list, 'utf8'))
  expect(saved[0]).toMatchObject({ path: file, name: 'Мой робот.nerpa' })
  expect(saved[0].thumb).toMatch(/^data:image\/jpeg;base64,/)
  await app.close()

  // next start: the start screen with the project, its picture; a click opens it
  ;({ app, win } = await launch(env))
  await expect(win.getByTestId('start-screen')).toBeVisible({ timeout: 10000 })
  const card = win.getByTestId('recent-card')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('Мой робот')
  await expect(card.locator('img')).toBeVisible()
  await win.getByTestId('start-screen').screenshot({ path: 'test-results/start-screen.png' })
  await card.locator('.recent-open').click()
  await expect(win.getByTestId('start-screen')).toHaveCount(0)
  await expect.poll(async () => (await nodes(win)).length).toBe(1)
  expect(await win.title()).toContain('Мой робот')

  // the file is gone: greyed out, taken off the list on request; the "…" menu shows the screen
  rmSync(file)
  await win.click('[data-testid=tb-more]')
  await win.click('[data-testid=menu-recent]')
  await expect(win.getByTestId('start-screen')).toBeVisible()
  await expect(win.getByTestId('recent-card')).toHaveClass(/missing/)
  await win.getByTestId('recent-card').hover()
  await win.getByTestId('recent-forget').click()
  await expect(win.getByTestId('recent-card')).toHaveCount(0)
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('start-screen')).toHaveCount(0)
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})
