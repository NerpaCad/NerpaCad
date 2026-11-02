import { expect, test } from '@playwright/test'
import { idle, launch } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)

test('beautiful view: switch it on under Start, day / evening / night, quality, during a run; kept in the project, not undone', async () => {
  test.setTimeout(150000)
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)
  // an island with heroes, scenery, a glass and a glowing shape, a lamp
  await cad(win, () => {
    const c = (window as any).__cad
    const A = c.actions
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) A.addLand(j >= 2 && i >= 2 && i <= 4 ? 'water' : j === 0 ? 'road' : 'grass', [150 + i * 300, 150 + j * 300])
    A.addTerrain('platform', [1650, 450])
    A.addDecor('tree', [250, 950])
    A.addDecor('pine', [1650, 1050])
    A.addDecor('bush', [600, 450])
    A.addDecor('rock', [1250, 450])
    A.addNerpa([900, 450], 'cheetah')
    A.addNerpa([300, 450], 'pigeon')
    A.addNerpa([1100, 900], 'seal')
    A.addObstacle('sphere', [450, 150])
    A.setSelectedMaterial('glass')
    A.addObstacle('box', [1050, 150])
    A.setSelectedMaterial('glow')
    A.addLight('point', [750, 700])
    c.selection.value = []
  })
  await idle(win)
  await win.waitForTimeout(1500)
  await cad(win, () => (window as any).__cad.viewport.fitView())
  await win.waitForTimeout(700)

  await win.getByTestId('pretty-on').scrollIntoViewIfNeeded()
  await win.getByTestId('pretty-on').check()
  await win.waitForTimeout(600)
  let view = await cad(win, () => (window as any).__cad.doc.value.view)
  expect(view).toMatchObject({ on: true, time: 'day', shadows: true, quality: 'mid' })
  expect(await cad(win, () => (window as any).__cad.viewport.renderer.shadowMap.enabled)).toBe(true)
  await win.screenshot({ path: 'test-results/pretty-day.png' })
  await win.getByTestId('pretty-time-evening').click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: 'test-results/pretty-evening.png' })
  await win.getByTestId('pretty-time-night').click()
  await win.waitForTimeout(500)
  await win.screenshot({ path: 'test-results/pretty-night.png' })
  await win.getByTestId('pretty-time-day').click()
  await win.getByTestId('pretty-q-high').click()
  await win.waitForTimeout(800)
  await win.screenshot({ path: 'test-results/pretty-high.png' })
  view = await cad(win, () => (window as any).__cad.doc.value.view)
  expect(view.quality).toBe('high')

  // undo does not switch it off; a project file keeps it
  await cad(win, () => (window as any).__cad.actions.undo())
  expect((await cad(win, () => (window as any).__cad.doc.value.view)).on).toBe(true)

  // during a run it stays on and can be changed
  await win.getByTestId('pretty-q-low').click()
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.simState.value === 'running')
  await win.waitForTimeout(1200)
  await win.getByTestId('pretty-time-evening').click()
  await win.waitForTimeout(400)
  expect((await cad(win, () => (window as any).__cad.doc.value.view)).time).toBe('evening')
  await win.screenshot({ path: 'test-results/pretty-run.png' })
  await win.getByTestId('sim-stop').click()

  // off: the editor looks as before
  await win.getByTestId('pretty-on').uncheck()
  await win.waitForTimeout(400)
  expect(await cad(win, () => (window as any).__cad.viewport.renderer.shadowMap.enabled)).toBe(false)
  // the 3D tab never shows it
  await win.getByTestId('pretty-on').check()
  await win.getByTestId('mode-3d').click()
  await win.waitForTimeout(500)
  expect(await cad(win, () => (window as any).__cad.viewport.renderer.toneMapping)).toBe(0)
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
