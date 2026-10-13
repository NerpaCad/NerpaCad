import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)

test('autosave: unsaved changes are written every so often; after a crash the project is offered back; saving or a normal close removes the copy', async () => {
  test.setTimeout(150000)
  const dir = mkdtempSync(join(tmpdir(), 'nerpa-as-test-'))
  const file = join(dir, 'autosave.nerpa')
  const env = { CAD_AUTOSAVE_DIR: dir, CAD_AUTOSAVE_MS: '600' }

  // 1. changes, the copy appears; then the app "crashes" (killed)
  let { app, win } = await launch(env)
  await cad(win, () => (window as any).__cad.actions.addShape?.('box'))
  await win.getByTestId('mode-robotics').click()
  await cad(win, () => {
    const A = (window as any).__cad.actions
    A.addRobot([450, 450])
    A.addNerpa([1050, 450], 'cheetah')
  })
  await idle(win)
  await expect.poll(() => existsSync(file), { timeout: 10000 }).toBe(true)
  await expect.poll(() => JSON.parse(readFileSync(file, 'utf8')).doc.robo?.length ?? 0, { timeout: 10000 }).toBeGreaterThanOrEqual(2)
  app.process().kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 500))
  expect(existsSync(file)).toBe(true)

  // 2. next start: the project is offered; brought back, it is unsaved
  ;({ app, win } = await launch(env))
  await expect(win.getByTestId('recover')).toBeVisible({ timeout: 10000 })
  await win.screenshot({ path: 'test-results/recover.png' })
  await win.getByTestId('recover-yes').click()
  await win.getByTestId('mode-robotics').click()
  await idle(win)
  const ns = await nodes(win)
  expect(ns.filter((n: any) => n.prim === 'robot').length).toBe(1)
  expect(ns.filter((n: any) => n.prim === 'nerpa').length).toBe(1)
  await expect.poll(() => win.title()).toContain('•')

  // 3. saved: the copy is gone
  const saved = join(dir, 'saved.nerpa')
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as any
  }, saved)
  await win.keyboard.press('Control+S')
  await expect.poll(() => existsSync(saved)).toBe(true)
  await expect.poll(() => existsSync(file), { timeout: 5000 }).toBe(false)

  // 4. changed again (a copy), then closed the normal way: no copy left, nothing offered next time
  await cad(win, () => (window as any).__cad.actions.addRobot([750, 750]))
  await expect.poll(() => existsSync(file), { timeout: 10000 }).toBe(true)
  await app.close()
  expect(existsSync(file)).toBe(false)
  ;({ app, win } = await launch(env))
  await win.waitForTimeout(1500)
  await expect(win.getByTestId('recover')).toHaveCount(0)

  // 5. a copy given up ("No, thanks") is removed
  await win.getByTestId('mode-robotics').click()
  await cad(win, () => (window as any).__cad.actions.addRobot([750, 750]))
  await expect.poll(() => existsSync(file), { timeout: 10000 }).toBe(true)
  app.process().kill('SIGKILL')
  await new Promise((r) => setTimeout(r, 500))
  ;({ app, win } = await launch(env))
  await expect(win.getByTestId('recover')).toBeVisible({ timeout: 10000 })
  await win.getByTestId('recover-no').click()
  await expect.poll(() => existsSync(file)).toBe(false)
  await win.getByTestId('mode-robotics').click()
  expect((await nodes(win)).length).toBe(0)
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})
