/**
 * Stage 8 review, in the real app: a crashed page keeps its autosaved work and offers it back;
 * the restore question blocks the keyboard; a tile copied in place replaces the one there; Space
 * on a focused panel button does not start a run; the beautiful view frees its GPU memory and
 * its sun covers a field painted later; a picture during a video keeps the view cube out; a brush
 * stroke is taken back when a run starts.
 */
import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes, project } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)

test('a crashed page: its work is kept, the page comes back and offers it; closing meanwhile keeps the copy', async () => {
  test.setTimeout(120000)
  const dir = mkdtempSync(join(tmpdir(), 'nerpa-crash-'))
  const file = join(dir, 'autosave.nerpa')
  const env = { CAD_AUTOSAVE_DIR: dir, CAD_AUTOSAVE_MS: '500' }
  let { app, win } = await launch(env)
  await win.getByTestId('mode-robotics').click()
  await cad(win, () => (window as any).__cad.actions.addRobot([450, 450]))
  await expect.poll(() => existsSync(file), { timeout: 10000 }).toBe(true)

  // the page crashes (the app itself stays): it is loaded again and offers the work back. The
  // test's handle on the old page is gone, so the new page is looked at from the main process
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer())
  const page = (js: string) =>
    app.evaluate(
      ({ BrowserWindow }, code) =>
        // a page still crashed or loading never answers: give up after a while
        Promise.race([BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code).catch(() => null), new Promise((r) => setTimeout(() => r(null), 1000))]),
      js
    )
  await expect.poll(() => page("!!document.querySelector('[data-testid=recover]')"), { timeout: 20000 }).toBe(true)
  expect(existsSync(file)).toBe(true)

  // while it asks, keys do nothing (F1 does not open the help, Space does not start a run)
  const press = (keyCode: string) =>
    app.evaluate(({ BrowserWindow }, k) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents
      wc.sendInputEvent({ type: 'keyDown', keyCode: k })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k })
    }, keyCode)
  await press('F1')
  await press('Space')
  await new Promise((r) => setTimeout(r, 400))
  expect(await page("!!document.querySelector('[data-testid=help-field]')")).toBe(false)
  expect(await page('window.__cad.simState.value')).toBe('idle')

  // closed without answering: the copy stays and is offered on the next start
  await app.close()
  expect(existsSync(file)).toBe(true)
  ;({ app, win } = await launch(env))
  await expect(win.getByTestId('recover')).toBeVisible({ timeout: 10000 })
  await win.getByTestId('recover-yes').click()
  await win.getByTestId('mode-robotics').click()
  expect((await nodes(win)).filter((n: any) => n.prim === 'robot').length).toBe(1)
  await app.close()
  rmSync(dir, { recursive: true, force: true })
})

test('landscape: Ctrl+D on a tile keeps one tile on the cell; the Inspector changes the selected tile; Space on a panel button adds, not runs', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await cad(win, () => (window as any).__cad.actions.addLand('grass', [150, 150]))
  await idle(win)
  const land = async () => (await nodes(win)).filter((n: any) => n.prim === 'terrain')
  expect((await land()).length).toBe(1)
  await win.locator('[data-testid=viewport] canvas').click({ position: { x: 5, y: 5 } }).catch(() => undefined)
  await cad(win, () => {
    const c = (window as any).__cad
    c.selection.value = [c.doc.value.nodes.find((n: any) => n.prim === 'terrain').id]
  })
  await win.keyboard.press('Control+D')
  await idle(win)
  const after = await land()
  expect(after.length).toBe(1)
  const sel = await cad(win, () => (window as any).__cad.selection.value)
  expect(sel).toEqual([after[0].id])
  await win.getByTestId('land-surface-sand').click()
  expect((await land())[0].params.terrain.surface).toBe('sand')

  // a lamp tile focused with the keyboard: Space adds a lamp and does not start the run
  const lamps = async () => (await nodes(win)).filter((n: any) => n.prim === 'light').length
  const btn = win.getByTestId('add-light')
  await btn.scrollIntoViewIfNeeded()
  await btn.focus()
  await win.keyboard.press(' ')
  await win.waitForTimeout(300)
  expect(await lamps()).toBe(1)
  expect(await cad(win, () => (window as any).__cad.simState.value)).toBe('idle')
  await app.close()
})

test('beautiful view: switching it off and on leaks no GPU memory; its sun covers a field painted later', async () => {
  test.setTimeout(120000)
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await cad(win, () => {
    const A = (window as any).__cad.actions
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A.addLand('grass', [150 + i * 300, 150 + j * 300])
    A.addLight('point', [450, 450])
  })
  await idle(win)
  const on = win.getByTestId('pretty-on')
  await on.scrollIntoViewIfNeeded()
  const mem = () => cad(win, () => ({ ...(window as any).__cad.viewport.renderer.info.memory }))
  await on.check()
  await win.waitForTimeout(500)
  await on.uncheck()
  await win.waitForTimeout(300)
  const first = await mem()
  for (let k = 0; k < 4; k++) {
    await on.check()
    await win.waitForTimeout(400)
    await win.getByTestId(k % 2 ? 'pretty-q-low' : 'pretty-q-high').click()
    await win.waitForTimeout(400)
    await on.uncheck()
    await win.waitForTimeout(300)
  }
  const last = await mem()
  expect(last.textures).toBeLessThanOrEqual(first.textures + 2)

  // the sun's shadow box grows with the field
  await win.getByTestId('pretty-q-low').click().catch(() => undefined)
  await on.check()
  await win.waitForTimeout(500)
  const box = () => cad(win, () => (window as any).__cad.viewport.pretty.sun.shadow.camera.right)
  const small = await box()
  await cad(win, () => {
    const A = (window as any).__cad.actions
    for (let i = 0; i < 4; i++) A.addLand('sand', [4050 + i * 300, 4050])
  })
  await idle(win)
  await win.waitForTimeout(1200)
  expect(await box()).toBeGreaterThan(small + 1000)
  await app.close()
})

test('a picture taken while a video records keeps the view cube out of the video; a brush stroke is taken back when a run starts', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await cad(win, () => (window as any).__cad.actions.addRobot([450, 450]))
  await idle(win)
  const bare = () => cad(win, () => (window as any).__cad.viewport.bare)
  await cad(win, () => void (window as any).__cad.viewport.record(10))
  await expect.poll(bare).toBe(true)
  await cad(win, () => (window as any).__cad.viewport.picture())
  expect(await bare()).toBe(true)
  await cad(win, () => (window as any).__cad.viewport.stopRecording())
  await expect.poll(bare).toBe(false)

  // painting grass, Space starts the run mid-stroke: the stroke is taken back
  await win.getByTestId('land-brush').scrollIntoViewIfNeeded()
  await win.getByTestId('land-brush').click()
  const a = await project(win, 1050, 1050, 0)
  const before = (await nodes(win)).length
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move(a.x + 40, a.y + 5, { steps: 4 })
  expect((await nodes(win)).length).toBeGreaterThan(before)
  await cad(win, () => (window as any).__cad.sim.start())
  await win.waitForTimeout(300)
  await win.mouse.up()
  expect((await nodes(win)).length).toBe(before)
  await cad(win, () => (window as any).__cad.sim.stop())
  await app.close()
})

test('switching to circuits with a robot selected on the field: no broken handle geometry', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  await win.getByTestId('mode-robotics').click()
  await win.getByTestId('add-robot').click()
  await idle(win)
  await win.getByTestId('mode-circuits').click()
  await win.waitForTimeout(800)
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(500)
  expect(errors.filter((e) => /NaN/.test(e))).toEqual([])
  // the view is drawn again when it is back
  expect(await cad(win, () => (window as any).__cad.selection.value.length)).toBe(1)
  await app.close()
})
