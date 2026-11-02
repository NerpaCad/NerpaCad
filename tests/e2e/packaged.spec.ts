/**
 * Smoke test of an installed build (not part of the normal run): set PACKAGED_BIN to the program,
 * e.g. PACKAGED_BIN=/opt/NerpaCad/nerpacad, or to an AppImage (add APPIMAGE_EXTRACT_AND_RUN=1
 * where there is no FUSE). Checks that everything loads from the packed files: the geometry
 * engine, the sketch solver, the robot and seal models, physics, the circuits.
 */
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const bin = process.env.PACKAGED_BIN

test.skip(!bin, 'set PACKAGED_BIN to run')

test('installed build: 3D, sketch solver, robotics with models and physics, island and sounds, mods, circuits', async () => {
  test.setTimeout(120000)
  const app = await electron.launch({
    executablePath: bin!,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    env: {
      ...process.env,
      CAD_SKIP_CLOSE_PROMPT: '1',
      CAD_AUTOSAVE_DIR: mkdtempSync(join(tmpdir(), 'nerpa-pk-')),
      CAD_RECENT_FILE: join(mkdtempSync(join(tmpdir(), 'nerpa-pk-recent-')), 'recent.json'),
      // the test mod: its model has to load through mod:// from the packed app's own origin
      CAD_MODS_DIR: resolve(__dirname, '../fixtures/mods')
    }
  })
  const win = await app.firstWindow()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(String(e)))
  // "replace the project with the example?" — yes
  win.on('dialog', (d) => void d.accept())
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('[data-testid=viewport] canvas', { timeout: 30000 })
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)
  expect(await win.title()).toContain('NerpaCad')
  const cad = () => (window as any).__cad

  // 3D: a cube with a hole, grouped (manifold WebAssembly in a worker)
  await win.evaluate(() => {
    const A = (window as any).__cad.actions
    A.addShape('box')
  })
  await win.waitForFunction(() => (window as any).__cad.geomBusy() === 0)
  expect(await win.evaluate(() => (window as any).__cad.doc.value.nodes.length)).toBe(1)

  // sketch solver (planegcs WebAssembly)
  const solved = await win.evaluate(async () => {
    const pts = [
      { id: 'p1', x: 1, y: 1 },
      { id: 'p2', x: 31, y: 2 }
    ]
    const r = await (window as any).__cad.solveSketch({
      points: pts,
      curves: [{ id: 'l1', kind: 'line', p1: 'p1', p2: 'p2' }],
      constraints: [{ id: 'k1', type: 'horizontal', refs: ['l1'] }],
      next: 5
    })
    return r.state
  })
  expect(solved).toBe('ok')

  // robotics: the demo field with the robot model, physics run
  await win.getByTestId('mode-robotics').click()
  await win.getByTestId('load-demo').click()
  await win.waitForTimeout(2500)
  await win.getByTestId('sim-start').click()
  await win.waitForTimeout(2000)
  const moved = await win.evaluate(() => (window as any).__cad.simState.value)
  expect(moved).toBe('running')
  await win.screenshot({ path: 'test-results/packaged-robotics.png' })
  await win.keyboard.press('Escape')

  // 0.2: the island with the heroes (glTF models), their sounds, the beautiful view
  await win.getByTestId('load-island').click()
  await win.waitForTimeout(2500)
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.soundPlayer.started > 0, undefined, { timeout: 15000 })
  await win.screenshot({ path: 'test-results/packaged-island.png' })
  await win.keyboard.press('Escape')

  // 0.2: a robot from a mod next to NerpaBot, its model loaded and painted
  await expect(win.getByTestId('add-robot')).toContainText('NerpaBot')
  await win.getByTestId('add-robot-testbot').click()
  await win.waitForFunction(
    () => {
      const c = (window as any).__cad
      const r = c.doc.value.nodes.find((n: any) => n.prim === 'robot' && n.params.robot.model === 'testbot')
      let ok = false
      c.viewport.sync.objects.get(r?.id)?.visual?.traverse((m: any) => {
        if (m.isMesh && m.name === 'body' && m.material.color.getHexString() === '7a3cff') ok = true
      })
      return ok
    },
    undefined,
    { timeout: 15000 }
  )

  // circuits: the breadboard example runs, the servo turns
  await win.getByTestId('mode-circuits').click()
  await win.getByTestId('ckt-demo2').click()
  await win.getByTestId('ckt-start').click()
  await win.waitForFunction(() => Object.values((window as any).__cad.circuitServos.value).some((s: any) => s.driven && s.powered), undefined, { timeout: 10000 })
  await win.screenshot({ path: 'test-results/packaged-circuits.png' })
  void cad
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
