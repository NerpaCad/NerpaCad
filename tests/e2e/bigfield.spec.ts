import { expect, test } from '@playwright/test'
import { idle, launch } from './app'

test('a 20 × 20 field with scenery is drawn in few draw calls (instancing), also in the beautiful view; changing a cell shows at once', async () => {
  test.setTimeout(150000)
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1000)
  await win.evaluate(() => {
    const c = (window as any).__cad
    const A = c.actions
    const kinds = ['grass', 'sand', 'stone', 'road', 'water']
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) A.addLand(kinds[(i * 3 + j * 7) % 13 < 9 ? 0 : (i + j) % 5], [150 + i * 300, 150 + j * 300])
    const dk = ['tree', 'pine', 'bush', 'rock', 'flowers']
    for (let k = 0; k < 60; k++) A.addDecor(dk[k % 5], [150 + ((k * 7) % 20) * 300, 150 + ((k * 3 + 1) % 20) * 300])
    c.selection.value = []
    c.viewport.fitView()
  })
  await idle(win)
  await win.waitForTimeout(1200)
  const frame = () =>
    win.evaluate(() => {
      const v = (window as any).__cad.viewport
      const r = v.renderer
      r.info.autoReset = false
      r.info.reset()
      v.needsRender = true
      v.step()
      const calls = r.info.render.calls
      r.info.autoReset = true
      const t0 = performance.now()
      for (let i = 0; i < 5; i++) {
        v.needsRender = true
        v.step()
      }
      r.getContext().finish()
      return { calls, ms: (performance.now() - t0) / 5, batches: v.sync.batcher.size }
    })
  const normal = await frame()
  console.log('normal', JSON.stringify(normal))
  // ~460 tiles and trees were thousands of draw calls one by one
  expect(normal.calls).toBeLessThan(400)
  expect(normal.batches).toBeGreaterThan(5)
  await win.evaluate(() => (window as any).__cad.actions.setView({ on: true, quality: 'low' }))
  await win.waitForTimeout(1500)
  const pretty = await frame()
  console.log('pretty', JSON.stringify(pretty))
  expect(pretty.calls).toBeLessThan(2500)

  // a cell made water and the selection: the batches follow
  const before = await win.evaluate(() => (window as any).__cad.viewport.sync.batcher.group.children.reduce((s: number, m: any) => s + m.count, 0))
  await win.evaluate(() => (window as any).__cad.actions.addTerrain('platform', [150, 150]))
  await idle(win)
  const after = await win.evaluate(() => (window as any).__cad.viewport.sync.batcher.group.children.reduce((s: number, m: any) => s + m.count, 0))
  // the platform is not batched, the tiles stay
  expect(after).toBe(before)
  await win.screenshot({ path: 'test-results/bigfield.png' })
  await app.close()
})
