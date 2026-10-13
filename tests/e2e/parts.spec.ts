import { expect, test, type Page } from '@playwright/test'
import { idle, launch, nodes } from './app'

async function addPart(win: Page, type: string) {
  await win.getByTestId(`shape-${type}`).focus()
  await win.keyboard.press('Enter')
  await idle(win)
}

const select = (win: Page, id: string) => win.evaluate((x) => ((window as any).__cad.selection.value = [x]), id)

test('parametric parts: bolt, nut, jar with its lid; their settings in the inspector', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.getByTestId('shapes-tab-param').click()
  for (const t of ['bolt', 'nut', 'jar']) await expect(win.getByTestId(`shape-${t}`)).toBeVisible()
  await win.screenshot({ path: 'test-results/parts-panel.png' })
  await addPart(win, 'bolt')
  await addPart(win, 'nut')
  await addPart(win, 'jar')
  let ns = await nodes(win)
  // the jar comes with its lid
  expect(ns.map((n: any) => n.prim)).toEqual(['bolt', 'nut', 'jar', 'jar'])
  expect(ns.slice(2).map((n: any) => n.params.part.piece)).toEqual(['body', 'lid'])
  expect(ns[3].name).toMatch(/крышка/)

  // the bolt: M12, 40 mm, round head
  const bolt = ns[0]
  await select(win, bolt.id)
  await expect(win.getByTestId('part-fields')).toBeVisible()
  await expect(win.getByTestId('size-0')).toBeDisabled()
  await win.getByTestId('part-size-M12').click()
  await win.getByTestId('part-length').fill('40')
  await win.getByTestId('part-length').press('Enter')
  await win.getByTestId('part-head-round').click()
  await idle(win)
  ns = await nodes(win)
  expect(ns[0].params.part).toMatchObject({ size: 'M12', length: 40, head: 'round' })
  await expect(win.getByTestId('part-info')).toContainText('1.75')
  const h = await win.evaluate((id) => {
    const c = (window as any).__cad
    const b = c.viewport.worldBoxes([id])[id]
    return b.max[2] - b.min[2]
  }, bolt.id)
  expect(h).toBeGreaterThan(45)
  await win.screenshot({ path: 'test-results/parts-bolt.png' })
  // the nut: wing style
  await select(win, ns[1].id)
  await win.getByTestId('part-style-wing').click()
  await idle(win)
  expect((await nodes(win))[1].params.part.style).toBe('wing')
  await win.evaluate(() => ((window as any).__cad.selection.value = []))
  await win.keyboard.press('f')
  await win.waitForTimeout(500)
  await win.screenshot({ path: 'test-results/parts-all.png' })
  expect(errors).toEqual([])
  await app.close()
})

test('parametric parts, stage 2: rack, wheel, pulley, washer, spring', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.getByTestId('shapes-tab-param').click()
  for (const t of ['rack', 'wheel', 'pulley', 'washer', 'spring']) await addPart(win, t)
  let ns = await nodes(win)
  expect(ns.map((n: any) => n.prim)).toEqual(['rack', 'wheel', 'pulley', 'washer', 'spring'])
  // nothing lands on top of anything
  const boxes = await win.evaluate(() => {
    const c = (window as any).__cad
    return c.doc.value.nodes.map((n: any) => c.viewport.worldBoxes([n.id])[n.id])
  })
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]
      const b = boxes[j]
      const overlap = a.min[0] < b.max[0] && b.min[0] < a.max[0] && a.min[1] < b.max[1] && b.min[1] < a.max[1]
      expect(overlap, `${i}/${j}`).toBe(false)
    }
  // the wheel: no groove, a D-shaped hole
  await select(win, ns[1].id)
  await win.getByTestId('part-groove').uncheck()
  await win.getByTestId('part-boreShape-d').click()
  await idle(win)
  ns = await nodes(win)
  expect(ns[1].params.part).toMatchObject({ groove: false, boreShape: 'd' })
  // the spring: 10 turns
  await select(win, ns[4].id)
  await win.getByTestId('part-turns').fill('10')
  await win.getByTestId('part-turns').press('Enter')
  await idle(win)
  await expect(win.getByTestId('part-info')).toContainText('60')
  await win.evaluate(() => ((window as any).__cad.selection.value = []))
  await win.keyboard.press('f')
  await win.waitForTimeout(500)
  await win.screenshot({ path: 'test-results/parts-stage2.png' })
  expect(errors).toEqual([])
  await app.close()
})

test('parametric parts, stage 3: box with a lid, hinge, knob, tag', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.getByTestId('shapes-tab-param').click()
  for (const t of ['boxLid', 'hinge', 'knob', 'tag']) await addPart(win, t)
  let ns = await nodes(win)
  expect(ns.map((n: any) => n.prim)).toEqual(['boxLid', 'boxLid', 'hinge', 'knob', 'tag'])
  // the tag's text
  const tag = ns[4]
  await select(win, tag.id)
  await win.getByTestId('part-text').fill('Нерпа')
  await win.getByTestId('part-text').press('Enter')
  await idle(win)
  ns = await nodes(win)
  expect(ns[4].params.part.text).toBe('Нерпа')
  // the box: a sliding lid (both pieces are set separately)
  await select(win, ns[0].id)
  await win.getByTestId('part-style-slide').click()
  await select(win, ns[1].id)
  await win.getByTestId('part-style-slide').click()
  await idle(win)
  ns = await nodes(win)
  expect(ns.slice(0, 2).map((n: any) => n.params.part.style)).toEqual(['slide', 'slide'])
  await win.evaluate(() => ((window as any).__cad.selection.value = []))
  await win.keyboard.press('f')
  await win.waitForTimeout(500)
  await win.screenshot({ path: 'test-results/parts-stage3.png' })
  // the whole panel of parametric parts
  await win.screenshot({ path: 'test-results/parts-panel-all.png', clip: { x: 1160, y: 50, width: 240, height: 810 } })
  expect(errors).toEqual([])
  await app.close()
})
