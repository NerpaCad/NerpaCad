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
