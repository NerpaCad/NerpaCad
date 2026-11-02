/**
 * A model from the 3D tab made static on the robotics field: the inspector's «Static» box (the
 * weight goes away), undo; in a run the robot drives onto it and over it, and it does not move.
 */
import { expect, test } from '@playwright/test'
import { idle, launch, nodes, selection } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)

test('static: the inspector marks a sent model; a robot drives over it and it stays put', async () => {
  test.setTimeout(90000)
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  // a low wide plate: 30 × 30 cm, 8 mm high (a robot drives onto it)
  await win.click('[data-testid=shape-box]')
  await idle(win)
  for (const [k, v] of Object.entries({ 0: '300', 1: '300', 2: '8' })) {
    await win.fill(`[data-testid=size-${k}]`, v)
    await win.locator(`[data-testid=size-${k}]`).press('Enter')
  }
  await idle(win)
  await win.click('[data-testid=tb-to-sim]')
  await expect.poll(() => cad(win, () => (window as any).__cad.doc.value.scene)).toBe('robo')
  await idle(win)
  const [plate] = await nodes(win)
  expect(plate.prim).toBe('mesh')
  expect(await selection(win)).toEqual([plate.id])

  const box = win.getByTestId('shape-static')
  await expect(box).toBeVisible()
  await expect(box).not.toBeChecked()
  await expect(win.getByTestId('mass-auto')).toBeVisible()
  await box.check()
  expect((await nodes(win))[0].fixed).toBe(true)
  // a static thing has no weight to set
  await expect(win.getByTestId('mass-auto')).toHaveCount(0)
  // undo with the box still focused
  await win.keyboard.press('Control+Z')
  expect((await nodes(win))[0].fixed).toBeUndefined()
  await win.keyboard.press('Control+Y')
  expect((await nodes(win))[0].fixed).toBe(true)
  // an anchor over it shows it does not move
  await expect(win.getByTestId(`dim-pin-${plate.id}`)).toBeVisible()

  // a robot west of it drives east, over it
  const [px, py] = plate.transform.position
  const robot = await cad(
    win,
    (a: any) => {
      const A = (window as any).__cad.actions
      const id = A.addRobot([a.x, a.y])
      const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
      A.setProgram(id, {
        blocks: {
          languageVersion: 0,
          blocks: [{ type: 'robo_start', id: 'st', x: 20, y: 20, next: { block: { type: 'robo_motors', id: 'm', inputs: { LEFT: n(70), RIGHT: n(70) } } } }]
        }
      })
      return id
    },
    { x: px - 400, y: py }
  )
  await idle(win)
  const at = (id: string) => cad(win, (i: string) => ({ ...(window as any).__cad.viewport.sync.objects.get(i).position }), id)
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.simState.value === 'running')
  await win.waitForFunction((a: any) => (window as any).__cad.viewport.sync.objects.get(a.id).position.x > a.x, { id: robot, x: px }, { timeout: 30000 })
  // no pin during the run
  await expect(win.getByTestId(`dim-pin-${plate.id}`)).toHaveCount(0)
  // on top of it, and it has not been pushed
  expect((await at(robot)).z).toBeCloseTo(8, 0)
  await win.screenshot({ path: 'test-results/static-over.png' })
  const p = await at(plate.id)
  expect(p.x).toBeCloseTo(px, 3)
  expect(p.y).toBeCloseTo(py, 3)
  await win.getByTestId('sim-stop').click()
  expect(errors).toEqual([])
  await app.close()
})
