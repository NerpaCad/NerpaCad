import { test, expect } from '@playwright/test'
import { idle, launch } from './app'
test('after Stop the seal stands in its rest pose again (no frozen stride)', async () => {
  const { app, win } = await launch()
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(800)
  await win.evaluate(() => {
    const A = (window as any).__cad.actions
    A.addNerpa([300, 300])
    const d = (window as any).__cad.doc.value
    const seal = d.nodes.find((n: any) => n.prim === 'nerpa')
    const n = (v: number) => ({ shadow: { type: 'robo_number', fields: { NUM: v } } })
    A.setProgram(seal.id, { blocks: { languageVersion: 0, blocks: [{ type: 'robo_start', x: 20, y: 20, next: { block: { type: 'nerpa_walk', inputs: { CM: n(200) } } } }] } })
  })
  await idle(win)
  await win.waitForTimeout(2500)
  const pose = () => win.evaluate(() => {
    const v = (window as any).__cad.viewport
    const V = v.camera.position.constructor
    let g: any = null
    v.scene.traverse((o: any) => { if (o.name === 'seal-visual') g = o })
    g.updateWorldMatrix(true, true)
    const out: number[] = []
    g.traverse((o: any) => { if (o.isSkinnedMesh) { const t = new V(); for (let i = 0; i < o.geometry.attributes.position.count; i += 37) { o.getVertexPosition(i, t); out.push(+t.x.toFixed(5), +t.z.toFixed(5)) } } })
    return out
  })
  const before = await pose()
  await win.getByTestId('sim-start').click()
  await win.waitForTimeout(1300)
  const during = await pose()
  await win.keyboard.press('Escape')
  await win.waitForTimeout(600)
  const after = await pose()
  const diff = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])))
  // in the model's own units: compared with its size
  const size = Math.max(...before) - Math.min(...before)
  expect(diff(before, during)).toBeGreaterThan(0.03 * size)
  expect(diff(before, after)).toBeLessThan(0.001 * size)
  await app.close()
})
