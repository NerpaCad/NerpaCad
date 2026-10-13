import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project } from './app'

const land = (ns: any[]) => ns.filter((n) => n.prim === 'terrain' && ['ground', 'water'].includes(n.params.terrain.kind))

test('landscape: drag a tile, paint and erase with the brush, set a road line, a pond with a bridge', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  win.on('pageerror', (e) => errors.push(String(e)))
  await win.getByTestId('mode-robotics').click()
  await win.waitForTimeout(1200)
  for (const k of ['grass', 'sand', 'stone', 'road', 'water']) await expect(win.getByTestId(`land-${k}`)).toBeVisible()

  // drag grass onto a cell
  const b = await win.getByTestId('land-grass').boundingBox()
  const target = await project(win, 170, 120, 0)
  await win.mouse.move(b!.x + 20, b!.y + 20)
  await win.mouse.down()
  await win.mouse.move(target.x - 40, target.y, { steps: 5 })
  await win.mouse.move(target.x, target.y, { steps: 5 })
  await win.mouse.up()
  await idle(win)
  let ns = land(await nodes(win))
  expect(ns).toHaveLength(1)
  expect(ns[0].params.terrain).toEqual({ kind: 'ground', height: 10, surface: 'grass' })
  expect(ns[0].transform.position).toEqual([150, 150, 0])

  // the brush: water over three cells in one stroke (one undo step)
  await win.getByTestId('land-brush').click()
  await win.getByTestId('land-water').click()
  await expect(win.getByTestId('land-water')).toHaveClass(/chosen/)
  const p1 = await project(win, 150, 450, 0)
  const p2 = await project(win, 750, 450, 0)
  await win.mouse.move(p1.x, p1.y)
  await win.mouse.down()
  await win.mouse.move(p2.x, p2.y, { steps: 12 })
  await win.mouse.up()
  await idle(win)
  ns = land(await nodes(win))
  expect(ns.filter((n: any) => n.params.terrain.kind === 'water')).toHaveLength(3)
  await win.screenshot({ path: 'test-results/landscape-brush.png' })
  await win.evaluate(() => (window as any).__cad.actions.undo())
  expect(land(await nodes(win))).toHaveLength(1)
  await win.evaluate(() => (window as any).__cad.actions.redo())
  expect(land(await nodes(win))).toHaveLength(4)

  // Shift: a rectangle 3 × 2 cells in one stroke; Ctrl: a straight line of sand
  await win.getByTestId('land-grass').click()
  const r1 = await project(win, 150, 1050, 0)
  const r2 = await project(win, 750, 1350, 0)
  await win.keyboard.down('Shift')
  await win.mouse.move(r1.x, r1.y)
  await win.mouse.down()
  await win.mouse.move(r2.x, r2.y, { steps: 8 })
  await win.screenshot({ path: 'test-results/landscape-area.png' })
  await win.mouse.up()
  await win.keyboard.up('Shift')
  await idle(win)
  const inRect = (ns: any[]) => land(ns).filter((n: any) => n.transform.position[1] >= 1050 && n.transform.position[1] <= 1350)
  expect(inRect(await nodes(win))).toHaveLength(6)
  await win.getByTestId('land-sand').click()
  const l1 = await project(win, 1050, 150, 0)
  const l2 = await project(win, 1050, 1350, 0)
  await win.keyboard.down('Control')
  await win.mouse.move(l1.x, l1.y)
  await win.mouse.down()
  await win.mouse.move(l2.x + 40, l2.y, { steps: 8 })
  await win.mouse.up()
  await win.keyboard.up('Control')
  await idle(win)
  const sand = land(await nodes(win)).filter((n: any) => n.params.terrain.surface === 'sand')
  expect(sand.map((n: any) => n.transform.position[0])).toEqual([1050, 1050, 1050, 1050, 1050])
  // one undo step each
  await win.evaluate(() => (window as any).__cad.actions.undo())
  expect(land(await nodes(win)).filter((n: any) => n.params.terrain.surface === 'sand')).toHaveLength(0)
  await win.evaluate(() => (window as any).__cad.actions.undo())
  expect(inRect(await nodes(win))).toHaveLength(0)
  await win.getByTestId('land-water').click()

  // the eraser takes the middle one away; Esc puts it down
  await win.getByTestId('land-erase').click()
  const pm = await project(win, 450, 450, 0)
  await win.mouse.move(pm.x, pm.y)
  await win.mouse.down()
  await win.mouse.up()
  await idle(win)
  expect(land(await nodes(win))).toHaveLength(3)
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('land-erase')).not.toHaveClass(/on/)

  // the inspector: grass → road, with a straight line
  await win.evaluate((id) => ((window as any).__cad.selection.value = [id]), ns[0].id)
  await win.getByTestId('land-surface-road').click()
  await win.getByTestId('land-line-straight').click()
  ns = land(await nodes(win))
  expect(ns.find((n: any) => n.transform.position[0] === 150 && n.transform.position[1] === 150).params.terrain).toEqual({
    kind: 'ground',
    height: 10,
    surface: 'road',
    line: 'straight'
  })
  await win.screenshot({ path: 'test-results/landscape-inspector.png' })

  // scenery from its tab: a tree dragged next to the tiles stands on the floor; the brush goes away
  await win.getByTestId('land-brush').click()
  await win.getByTestId('field-tab-decor').click()
  await expect(win.getByTestId('land-brush')).toHaveCount(0)
  const tb = await win.getByTestId('decor-tree').boundingBox()
  const spot = await project(win, -300, 600, 0)
  await win.mouse.move(tb!.x + 20, tb!.y + 20)
  await win.mouse.down()
  await win.mouse.move(spot.x - 40, spot.y, { steps: 5 })
  await win.mouse.move(spot.x, spot.y, { steps: 5 })
  await win.mouse.up()
  await idle(win)
  const tree = (await nodes(win)).find((n: any) => n.prim === 'decor')
  expect(tree.params.decor).toEqual({ kind: 'tree' })
  expect(tree.transform.position[2]).toBe(0)
  expect(await win.evaluate(() => (window as any).__cad.viewport.dragging)).toBe(false)
  await win.getByTestId('field-tab-land').click()
  await expect(win.getByTestId('land-brush')).not.toHaveClass(/on/)

  // an island: grass all round, a pond in the middle with a bridge over it, a road, sand and stone
  await win.evaluate(() => {
    const c = (window as any).__cad
    c.selection.value = c.doc.value.nodes.map((n: any) => n.id)
    c.actions.deleteSelected()
  })
  await idle(win)
  expect(await nodes(win)).toHaveLength(0)
  await win.evaluate(() => {
    const A = (window as any).__cad.actions
    const kind = (i: number, j: number) => {
      if (i >= 2 && i <= 3 && j >= 1 && j <= 3) return 'water'
      if (j === 0) return 'road'
      if (i === 5) return 'sand'
      if (i === 0 && j >= 2) return 'stone'
      return 'grass'
    }
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) A.addLand(kind(i, j), [150 + i * 300, 150 + j * 300])
    A.addRobot([450, 150], 0)
    A.addNerpa([1350, 750])
    A.addTerrain('platform', [450, 1650])
    A.addDecor('tree', [200, 1300])
    A.addDecor('tree', [1650, 1350])
    A.addDecor('pine', [1350, 1350])
    A.addDecor('pine', [250, 900])
    A.addDecor('bush', [1350, 300])
    A.addDecor('rock', [1700, 400])
    A.addDecor('flowers', [900, 1350])
    A.addDecor('flowers', [1000, 1200])
  })
  await idle(win)
  await win.waitForTimeout(800)
  await win.evaluate(() => {
    ;(window as any).__cad.selection.value = []
    ;(window as any).__cad.viewport.fitView()
  })
  await win.waitForTimeout(900)
  await win.screenshot({ path: 'test-results/landscape-island.png' })
  ns = await nodes(win)
  // scenery stands on the tiles under it
  expect(ns.filter((n: any) => n.prim === 'decor').every((n: any) => n.transform.position[2] === 10)).toBe(true)
  await win.evaluate(() => (window as any).__cad.viewport.zoom(0.45))
  await win.waitForTimeout(700)
  await win.screenshot({ path: 'test-results/landscape-close.png' })
  // a run: the water moves, nothing breaks
  await win.getByTestId('sim-start').click()
  await win.waitForTimeout(1500)
  await win.screenshot({ path: 'test-results/landscape-run.png' })
  await win.getByTestId('sim-stop').click()
  expect(errors.filter((e) => !/DevTools|Autofill/.test(e))).toEqual([])
  await app.close()
})
