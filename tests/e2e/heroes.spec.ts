import { expect, test } from '@playwright/test'
import { idle, launch, nodes } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
const prog = (...blocks: any[]) => {
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] }
  return { blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', x: 20, y: 20, next: { block: blocks[0] } }] } }
}

test('heroes: Читик and Геннадий join the seal, each with only its own blocks; they run, jump, fly and swim', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m: any) => m.type() === 'error' && errors.push(m.text()))
  win.on('pageerror', (e: any) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)

  // the three heroes from the panel
  await win.getByTestId('add-cheetah').scrollIntoViewIfNeeded()
  await win.getByTestId('add-cheetah').click()
  await idle(win)
  let ns = await nodes(win)
  const cheetah = ns.find((x: any) => x.prim === 'nerpa')
  expect(cheetah.name).toBe('Читик')
  expect(cheetah.params.nerpa.species).toBe('cheetah')
  // its palette: run and jump, ledge and water; no swimming or flying
  await win.locator('.blocklyToolboxCategory', { hasText: 'Движение' }).click()
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'бежать' })).toHaveCount(1)
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'запрыгнуть вперёд' })).toHaveCount(1)
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'плыть' })).toHaveCount(0)
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'взлететь' })).toHaveCount(0)

  await win.getByTestId('add-pigeon').click()
  await idle(win)
  ns = await nodes(win)
  const pigeon = ns.find((x: any) => x.params?.nerpa?.species === 'pigeon')
  expect(pigeon.name).toBe('Геннадий')
  await win.waitForTimeout(400)
  await win.locator('.blocklyToolboxCategory', { hasText: 'Движение' }).click()
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'взлететь' })).toHaveCount(1)
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'приземлиться' })).toHaveCount(1)
  await expect(win.locator('.blocklyFlyout .blocklyText', { hasText: 'бежать' })).toHaveCount(0)
  await win.getByTestId('add-nerpa').click()
  await idle(win)

  // a scene: a platform for Читик, a pond for the seal and for Геннадий to fly over
  const ids = await cad(win, () => {
    const c = (window as any).__cad
    const A = c.actions
    c.selection.value = c.doc.value.nodes.map((n: any) => n.id)
    A.deleteSelected()
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) A.addLand(j >= 2 && i >= 2 && i <= 4 ? 'water' : 'grass', [150 + i * 300, 150 + j * 300])
    A.addTerrain('platform', [1350, 150])
    const cheetah = A.addNerpa([450, 150], 'cheetah')
    const pigeon = A.addNerpa([150, 1050], 'pigeon')
    const seal = A.addNerpa([450, 750], 'seal')
    return { cheetah, pigeon, seal }
  })
  await idle(win)
  await win.waitForTimeout(1500)
  await cad(win, () => {
    ;(window as any).__cad.selection.value = []
    ;(window as any).__cad.viewport.fitView()
  })
  await win.waitForTimeout(800)
  await win.screenshot({ path: 'test-results/heroes-idle.png' })

  const set = (id: string, program: any) => cad(win, (a: any) => (window as any).__cad.actions.setProgram(a.id, a.program), { id, program })
  await set(ids.cheetah, prog({ type: 'cheetah_run', inputs: { CM: n(100) } }, { type: 'cheetah_leap' }, { type: 'nerpa_walk', inputs: { CM: n(5) } }))
  await set(ids.pigeon, prog({ type: 'pigeon_takeoff', inputs: { CM: n(40) } }, { type: 'pigeon_fly', inputs: { CM: n(150) } }, { type: 'pigeon_land' }))
  await set(ids.seal, prog({ type: 'nerpa_turn', inputs: { DEG: n(90) }, fields: { DIR: 'LEFT' } }, { type: 'nerpa_walk', inputs: { CM: n(60) } }))
  await win.getByTestId('sim-start').click()
  await win.waitForFunction(() => (window as any).__cad.simState.value === 'running')
  const pos = (id: string) =>
    cad(win, (i: string) => {
      const o = (window as any).__cad.viewport.sync.objects.get(i)
      return { x: o.position.x, y: o.position.y, z: o.position.z, anim: o.visual?.userData.state?.anim }
    }, id)
  await win.waitForFunction((id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.z > 150, ids.pigeon, { timeout: 15000 })
  await win.screenshot({ path: 'test-results/heroes-run.png' })
  await win.waitForFunction((id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.z > 100, ids.cheetah, { timeout: 15000 })
  await win.waitForFunction((id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.x > 1500, ids.pigeon, { timeout: 20000 })
  await win.waitForFunction((id: string) => (window as any).__cad.viewport.sync.objects.get(id).position.z < 20, ids.pigeon, { timeout: 20000 })
  const c = await pos(ids.cheetah)
  // the platform is built on the grass (1 cm): its top is at 13 cm
  expect(c.z).toBe(130)
  const s = await pos(ids.seal)
  expect(s.y).toBeGreaterThan(1200)
  const p = await pos(ids.pigeon)
  expect(p.x).toBeGreaterThan(1500)
  expect(p.z).toBeLessThan(20)
  await win.screenshot({ path: 'test-results/heroes-after.png' })
  await win.getByTestId('sim-stop').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
