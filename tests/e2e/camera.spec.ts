import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, project } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })

test('camera: follows the robot during a run, double-click follows a hero; a PNG picture and a WebM video are saved', async () => {
  test.setTimeout(150000)
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1000)
  const ids = await cad(win, (p: any) => {
    const A = (window as any).__cad.actions
    const robot = A.addRobot([150, 150], 0)
    A.setProgram(robot, { blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', x: 20, y: 20, next: { block: { type: 'robo_motors', inputs: { LEFT: p, RIGHT: p } } } }] } })
    const seal = A.addNerpa([450, 1350], 'seal')
    return { robot, seal }
  }, n(70))
  await idle(win)
  const camera = () =>
    cad(win, () => {
      const v = (window as any).__cad.viewport
      return { tx: v.controls.target.x, ty: v.controls.target.y, cx: v.camera.position.x, cy: v.camera.position.y }
    })

  // nothing selected that moves: "follow" is off; the robot selected: on
  await cad(win, () => ((window as any).__cad.selection.value = []))
  await cad(win, (id: string) => ((window as any).__cad.selection.value = [id]), ids.robot)
  await win.getByTestId('camera-follow').click()
  await expect(win.getByTestId('camera-follow')).toHaveClass(/on/)
  await expect(win.getByTestId('camera-follow')).toContainText('Робот')
  await win.getByTestId('camera-follow').scrollIntoViewIfNeeded()
  await win.screenshot({ path: 'test-results/camera-panel.png' })
  const before = await camera()
  await win.getByTestId('speed-2').click()
  await win.getByTestId('sim-start').click()
  await win.waitForFunction((id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.x > 900, ids.robot, { timeout: 30000 })
  await win.waitForTimeout(1500)
  const after = await camera()
  const rx = await cad(win, (id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.x, ids.robot)
  // the point looked at keeps up with the robot; the camera moved with it (same offset)
  expect(Math.abs(after.tx - rx)).toBeLessThan(250)
  expect(after.cx - before.cx).toBeCloseTo(after.tx - before.tx, -1)

  // following off (the camera stays); double-click on the seal during the run: it follows the seal
  await win.getByTestId('camera-follow').click()
  await expect(win.getByTestId('camera-follow')).not.toHaveClass(/on/)
  await cad(win, () => {
    const v = (window as any).__cad.viewport
    v.controls.target.set(450, 1350, 0)
    v.camera.position.set(450, 500, 900)
    v.controls.update()
    v.invalidate()
  })
  await win.waitForTimeout(800)
  const at = await project(win, 450, 1350, 60)
  await win.mouse.dblclick(at.x, at.y)
  await expect.poll(() => cad(win, () => (window as any).__cad.followId?.value ?? null)).toBe(ids.seal)

  // a picture of the view
  const png = join(tmpdir(), `shot-${Date.now()}.png`)
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as any
  }, png)
  await win.getByTestId('camera-shot').click()
  await expect.poll(() => existsSync(png)).toBe(true)
  const head = readFileSync(png)
  expect(head.subarray(1, 4).toString()).toBe('PNG')
  expect(head.readUInt32BE(16)).toBeGreaterThan(400)
  rmSync(png)

  // a short video
  const webm = join(tmpdir(), `video-${Date.now()}.webm`)
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as any
  }, webm)
  await win.getByTestId('camera-video').click()
  await expect(win.getByTestId('camera-video')).toHaveClass(/rec/)
  await win.waitForTimeout(2000)
  await win.getByTestId('camera-video').click()
  await expect.poll(() => existsSync(webm), { timeout: 15000 }).toBe(true)
  const v = readFileSync(webm)
  expect(v.readUInt32BE(0)).toBe(0x1a45dfa3)
  expect(v.length).toBeGreaterThan(2000)
  rmSync(webm)
  await expect(win.getByTestId('camera-video')).not.toHaveClass(/rec/)

  await win.getByTestId('sim-stop').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
