/**
 * Mods in the app: a robot from a mod (tests/fixtures/mods/testbot) is offered next to NerpaBot,
 * its glTF model is loaded from the mod's folder and painted as its mod.json says, its own sensor
 * module is used; the inspector switches models; About lists the mods (a broken one with its
 * reason); a project with a robot of a mod that is not installed opens with a notice.
 */
import { expect, test } from '@playwright/test'
import { resolve } from 'node:path'
import { idle, launch, nodes } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const MODS = resolve(__dirname, '../fixtures/mods')

/** names and colours of the meshes of a robot's look */
const look = (win: any, id: string) =>
  cad(
    win,
    (rid: string) => {
      const o = (window as any).__cad.viewport.sync.objects.get(rid)
      const out: { name: string; color: string; inSensor: boolean }[] = []
      o?.visual?.traverse((m: any) => {
        if (!m.isMesh) return
        let s = false
        for (let p = m; p; p = p.parent) if (p.name?.startsWith('sensor-')) s = true
        out.push({ name: m.name, color: '#' + m.material.color.getHexString(), inSensor: s })
      })
      return out
    },
    id
  )

test('mods: a robot from a mod next to NerpaBot, its model and module, the inspector, About', async () => {
  const { app, win } = await launch({ CAD_MODS_DIR: MODS })
  await win.getByTestId('mode-robotics').click()
  await expect(win.getByTestId('add-robot')).toContainText('NerpaBot')
  await expect(win.getByTestId('add-robot-testbot')).toContainText('Тестобот')

  // NerpaBot, built in code: no files to load
  await win.getByTestId('add-robot').click()
  await idle(win)
  const nb = (await nodes(win)).find((n: any) => n.prim === 'robot')
  expect(nb.params.robot.model).toBe('nerpabot')
  await expect.poll(async () => (await look(win, nb.id)).map((m: any) => m.name)).toContain('screen')

  // the mod's robot: its glTF through mod://, painted by its colours
  await win.getByTestId('add-robot-testbot').click()
  await idle(win)
  const tb = (await nodes(win)).filter((n: any) => n.prim === 'robot').find((n: any) => n.params.robot.model === 'testbot')
  expect(tb).toBeTruthy()
  await expect.poll(async () => (await look(win, tb.id)).find((m: any) => m.name === 'body')?.color, { timeout: 10000 }).toBe('#7a3cff')
  // its own touch module (the board painted in the touch colour); a line sensor is the built-in one
  await cad(win, (id: string) => {
    const A = (window as any).__cad.actions
    A.attachSensor(id, 1, 'touch')
    A.attachSensor(id, 2, 'line')
  }, tb.id)
  await expect
    .poll(async () => (await look(win, tb.id)).filter((m: any) => m.inSensor).map((m: any) => `${m.name}:${m.color}`), { timeout: 10000 })
    .toEqual(expect.arrayContaining(['body:#c62828', 'board:#1d7a45']))
  await win.screenshot({ path: 'test-results/mods-field.png' })

  // the inspector: model choice; NerpaBot has no pad 9, but pads 1 and 2 stay
  await cad(win, (id: string) => ((window as any).__cad.selection.value = [id]), tb.id)
  await expect(win.getByTestId('robot-model')).toBeVisible()
  await win.getByTestId('robot-model').selectOption('nerpabot')
  const now = (await nodes(win)).find((n: any) => n.id === tb.id)
  expect(now.params.robot.model).toBe('nerpabot')
  expect(now.params.robot.sensors.map((s: any) => s.port)).toEqual([1, 2])

  // About: the mods, the broken one with its reason, the folder button
  await win.click('[data-testid=brand]')
  await expect(win.getByTestId('mod-testbot')).toContainText('TestBot')
  await expect(win.getByTestId('mod-testbot')).toContainText('CC0')
  await expect(win.getByTestId('mod-broken')).toContainText('не подключён')
  await expect(win.getByTestId('mods-open')).toBeVisible()
  await win.getByTestId('about').screenshot({ path: 'test-results/mods-about.png' })
  await app.close()
})

test('a project with a robot of a mod that is not installed: a notice, NerpaBot on the field, the model kept', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  // NerpaBot only: one robot tile, named; the inspector has no model choice
  await expect(win.getByTestId('add-robot')).toContainText('NerpaBot')
  await expect(win.locator('[data-testid^=add-robot-]')).toHaveCount(0)
  const file = {
    format: 'nerpacad-project',
    version: 6,
    app: 'NerpaCad',
    doc: {
      version: 6,
      nodes: [],
      robo: [
        {
          id: 'r1',
          kind: 'prim',
          prim: 'robot',
          name: 'Робот 1',
          color: '#4cc9f0',
          isHole: false,
          params: { robot: { model: 'robbo', sensors: [{ port: 1, type: 'line' }] } },
          transform: { position: [450, 450, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
        }
      ]
    }
  }
  await cad(win, (text: string) => (window as any).__cad.actions.openProjectData(new TextEncoder().encode(text).buffer, null, 'old.nerpa'), JSON.stringify(file))
  await expect(win.locator('.toast')).toContainText('robbo')
  await win.getByTestId('mode-robotics').click()
  await idle(win)
  await expect.poll(async () => (await look(win, 'r1')).map((m: any) => m.name)).toContain('screen')
  await cad(win, () => ((window as any).__cad.selection.value = ['r1']))
  await expect(win.getByTestId('robot-model-missing')).toContainText('robbo')
  expect((await nodes(win))[0].params.robot.model).toBe('robbo')
  await app.close()
})

test('mods: a hero of a mod and its pieces (a static relief block, a movable crate); a robot stops at the block', async () => {
  test.setTimeout(90000)
  const { app, win } = await launch({ CAD_MODS_DIR: MODS })
  const errors: string[] = []
  win.on('pageerror', (e: Error) => errors.push(e.message))
  await win.getByTestId('mode-robotics').click()

  // the hero: next to the built-in ones, moving like the seal, its body in the hero's colour
  await expect(win.getByTestId('add-hero-testpet')).toContainText('Тестозверь')
  await win.getByTestId('add-hero-testpet').click()
  await idle(win)
  const pet = (await nodes(win)).find((n: any) => n.prim === 'nerpa')
  expect(pet.params.nerpa).toMatchObject({ species: 'seal', model: 'testpet' })
  expect(pet.color).toBe('#ff7f50')
  await expect.poll(async () => (await look(win, pet.id)).find((m: any) => m.name === 'body')?.color, { timeout: 10000 }).toBe('#ff7f50')

  // the relief block: on the middle of a tile, static, with its triangles in the project
  await win.getByTestId('field-tab-relief').click()
  await win.getByTestId('prop-teststep').click()
  await expect.poll(async () => (await nodes(win)).filter((n: any) => n.params.prop === 'teststep').length).toBe(1)
  const block = (await nodes(win)).find((n: any) => n.params.prop === 'teststep')
  expect(block.prim).toBe('mesh')
  expect(block.fixed).toBe(true)
  expect(Math.abs((block.transform.position[0] - 150) % 300)).toBe(0)
  const tris = await cad(win, () => (window as any).__cad.doc.value.meshes['mod-teststep'].triangles.length)
  expect(tris).toBe(72)
  await expect
    .poll(() => cad(win, (id: string) => (window as any).__cad.viewport.sync.objects.get(id)?.visual?.name, block.id), { timeout: 10000 })
    .toBe('prop-visual')

  // the crate: scenery that can be pushed, with its weight
  await win.getByTestId('field-tab-decor').click()
  await win.getByTestId('prop-testcrate').click()
  await expect.poll(async () => (await nodes(win)).filter((n: any) => n.params.prop === 'testcrate').length).toBe(1)
  const crate = (await nodes(win)).find((n: any) => n.params.prop === 'testcrate')
  expect(crate.fixed).toBeUndefined()
  expect(crate.mass).toBe(50)
  await win.screenshot({ path: 'test-results/mods-pieces.png' })

  // a robot driving at the block (175 mm high) stops at it
  const [bx, by] = block.transform.position
  const robot = await cad(
    win,
    (a: any) => {
      const A = (window as any).__cad.actions
      const id = A.addRobot([a.x, a.y])
      const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
      A.setProgram(id, {
        blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', id: 'st', x: 20, y: 20, next: { block: { type: 'robo_motors', id: 'm', inputs: { LEFT: n(70), RIGHT: n(70) } } } }] }
      })
      return id
    },
    { x: bx - 600, y: by }
  )
  await idle(win)
  await win.getByTestId('sim-start').click()
  await win.waitForTimeout(4000)
  const rx = await cad(win, (id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.x, robot)
  await win.getByTestId('sim-stop').click()
  expect(rx).toBeGreaterThan(bx - 450)
  expect(rx).toBeLessThan(bx - 150)

  // About lists them
  await win.click('[data-testid=brand]')
  await expect(win.getByTestId('mod-testbot')).toContainText('Тестозверь')
  await expect(win.getByTestId('mod-testbot')).toContainText('Тестоблок')
  expect(errors).toEqual([])
  await app.close()
})
