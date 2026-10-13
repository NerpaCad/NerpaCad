import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const zOf = async (win: any, id: string) => (await nodes(win)).find((n: any) => n.id === id).transform.position[2]

test('tiers: platforms on grass and on platforms, a ramp on a platform, dragging onto a stack, the robot climbs to the top', async () => {
  test.setTimeout(150000)
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)

  // grass under the whole build; along +Y: a ramp, a platform row, a ramp on it, a platform on top
  const ids = await cad(win, () => {
    const A = (window as any).__cad.actions
    for (let i = 0; i < 3; i++) for (let j = 0; j < 8; j++) A.addLand('grass', [150 + i * 300, 150 + j * 300])
    const ramp1 = A.addTerrain('ramp', [450, 600])
    const row = [3, 4, 5, 6].map((j) => A.addTerrain('platform', [450, 150 + j * 300]))
    const ramp2 = A.addTerrain('ramp', [450, 1500])
    const top = A.addTerrain('platform', [450, 1950])
    const loose = A.addTerrain('platform', [150, 2250])
    return { ramp1, row, ramp2, top, loose }
  })
  await idle(win)
  expect(await zOf(win, ids.ramp1)).toBe(10)
  expect(await zOf(win, ids.row[0])).toBe(10)
  expect(await zOf(win, ids.ramp2)).toBe(130)
  expect(await zOf(win, ids.top)).toBe(130)
  expect(await zOf(win, ids.loose)).toBe(10)

  // drag the loose platform onto the top one with the mouse: it is built on it
  await cad(win, () => {
    const c = (window as any).__cad
    c.selection.value = []
    c.viewport.fitView()
  })
  await win.waitForTimeout(800)
  const from = await project(win, 150, 2250, 130)
  // the drag moves in the plane of the grabbed point
  const to = await project(win, 450, 1950, 130)
  await win.mouse.click(from.x, from.y)
  await win.waitForTimeout(300)
  expect(await cad(win, () => (window as any).__cad.selection.value)).toEqual([ids.loose])
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  await win.mouse.move(to.x, to.y, { steps: 6 })
  await win.mouse.up()
  await idle(win)
  const moved = (await nodes(win)).find((n: any) => n.id === ids.loose)
  expect(moved.transform.position.slice(0, 2)).toEqual([450, 1950])
  expect(moved.transform.position[2]).toBe(250)

  // made the bottom row taller: everything built on it goes up
  await cad(win, (a: any) => {
    const A = (window as any).__cad.actions
    for (const id of a.row) A.setTerrain(id, { height: 150 })
  }, ids)
  await idle(win)
  expect(await zOf(win, ids.ramp2)).toBe(160)
  expect(await zOf(win, ids.top)).toBe(160)
  expect(await zOf(win, ids.loose)).toBe(280)
  // back to 12 cm and the stacked platform taken off again
  await cad(win, (a: any) => {
    const c = (window as any).__cad
    for (const id of a.row) c.actions.setTerrain(id, { height: 120 })
    c.selection.value = [a.loose]
    c.actions.deleteSelected()
  }, ids)
  await idle(win)

  // a robot at the foot of the first ramp drives up to the top tier
  const robot = await cad(win, () => {
    const c = (window as any).__cad
    const id = c.actions.addRobot([450, 90], 90)
    c.actions.setProgram(id, {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'robo_start',
            x: 20,
            y: 20,
            next: { block: { type: 'robo_motors', inputs: { LEFT: { shadow: { type: 'robo_number', fields: { NUM: 80 } } }, RIGHT: { shadow: { type: 'robo_number', fields: { NUM: 80 } } } } } }
          }
        ]
      }
    })
    c.selection.value = []
    return id
  })
  await idle(win)
  await win.waitForTimeout(1000)
  await win.screenshot({ path: 'test-results/tiers-idle.png' })
  await win.getByTestId('speed-4').click()
  await win.getByTestId('sim-start').click()
  await win.waitForFunction((id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.z > 240, robot, { timeout: 60000 })
  await win.getByTestId('sim-pause').click()
  await win.screenshot({ path: 'test-results/tiers-top.png' })
  await win.getByTestId('sim-stop').click()
  // Читик has "crawl"; the seal does not
  for (const [species, has] of [
    ['cheetah', 1],
    ['seal', 0]
  ] as [string, number][]) {
    await cad(win, (sp: string) => {
      const c = (window as any).__cad
      c.selection.value = [c.actions.addNerpa([1050, 150 + (sp === 'seal' ? 300 : 0)], sp)]
    }, species)
    await win.waitForTimeout(500)
    await win.locator('.blocklyToolboxCategory', { hasText: 'Движение' }).click()
    await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'ползти' })).toHaveCount(has)
    await win.keyboard.press('Escape')
  }
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
