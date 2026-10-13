import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { idle, launch, nodes, project, selection } from './app'

test('shapes, mouse editing, holes, grouping, undo, export', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))

  // 1. drag a box from the panel onto the workplane: a preview follows the cursor
  const target = await project(win, -30, 0, 0)
  const tile = await win.locator('[data-testid=shape-box]').boundingBox()
  await win.mouse.move(tile!.x + tile!.width / 2, tile!.y + tile!.height / 2)
  await win.mouse.down()
  await win.mouse.move(target.x + 40, target.y, { steps: 6 })
  await win.mouse.move(target.x, target.y, { steps: 6 })
  await expect
    .poll(() => win.evaluate(() => (window as any).__cad.viewport.ghost?.visible ?? false))
    .toBe(true)
  await win.screenshot({ path: join(tmpdir(), 'cad-e2e-ghost.png') })
  await win.mouse.up()
  expect(await win.evaluate(() => (window as any).__cad.viewport.ghost)).toBeNull()
  await idle(win)
  let ns = await nodes(win)
  expect(ns).toHaveLength(1)
  expect(ns[0].prim).toBe('box')
  expect(Math.abs(ns[0].transform.position[0] + 30)).toBeLessThan(3)

  // 2. click-add a cylinder at the center
  await win.click('[data-testid=shape-cylinder]')
  await idle(win)
  ns = await nodes(win)
  expect(ns).toHaveLength(2)
  const cylId = ns[1].id

  // 3. drag the cylinder with the mouse by +20 mm in X
  const from = await project(win, 0, 0, 10)
  const to = await project(win, 20, 0, 10)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
  await win.mouse.move(to.x, to.y, { steps: 5 })
  await win.mouse.up()
  ns = await nodes(win)
  const cyl = ns.find((n: any) => n.id === cylId)
  expect(cyl.transform.position[0]).toBeGreaterThan(17)
  expect(cyl.transform.position[0]).toBeLessThan(23)
  expect(Number.isInteger(cyl.transform.position[0])).toBe(true) // snapped to the 1 mm grid

  // 4. height handle: drag the top handle up by ~10 mm
  const cx = cyl.transform.position[0]
  const top = await project(win, cx, 0, 20)
  const top2 = await project(win, cx, 0, 30)
  await win.mouse.move(top.x, top.y)
  await win.mouse.down()
  await win.mouse.move(top2.x, top2.y, { steps: 8 })
  await win.mouse.up()
  ns = await nodes(win)
  const tall = ns.find((n: any) => n.id === cylId)
  expect(tall.transform.scale[2]).toBeGreaterThan(1.3)
  expect(tall.transform.position[2]).toBe(0)

  // 5. inspector: exact size, then make it a hole
  await win.fill('[data-testid=size-2]', '30')
  await win.press('[data-testid=size-2]', 'Enter')
  await win.fill('[data-testid=size-0]', '10')
  await win.press('[data-testid=size-0]', 'Enter')
  await win.fill('[data-testid=size-1]', '10')
  await win.press('[data-testid=size-1]', 'Enter')
  await win.fill('[data-testid=pos-0]', '-30')
  await win.press('[data-testid=pos-0]', 'Enter')
  await win.fill('[data-testid=pos-2]', '-5')
  await win.press('[data-testid=pos-2]', 'Enter')
  await win.click('[data-testid=insp-hole]')
  ns = await nodes(win)
  expect(ns.find((n: any) => n.id === cylId).isHole).toBe(true)

  // 6. select all + group
  await win.keyboard.press('Control+A')
  await win.click('[data-testid=tb-group]')
  await idle(win)
  ns = await nodes(win)
  expect(ns).toHaveLength(1)
  expect(ns[0].kind).toBe('group')
  await win.screenshot({ path: join(tmpdir(), 'cad-e2e-group.png') })

  // 7. export STL through a stubbed save dialog
  const out = join(tmpdir(), `cad-e2e-${Date.now()}.stl`)
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as any
  }, out)
  await win.click('[data-testid=tb-export]')
  await win.click('.dropdown-menu .menu-item >> nth=0')
  await expect.poll(() => existsSync(out)).toBe(true)
  const buf = readFileSync(out)
  const tris = buf.readUInt32LE(80)
  expect(tris).toBeGreaterThan(40)
  expect(buf.length).toBe(84 + tris * 50)
  rmSync(out)

  // 8. undo the grouping, redo it
  await win.keyboard.press('Control+Z')
  expect(await nodes(win)).toHaveLength(2)
  await win.keyboard.press('Control+Y')
  expect(await nodes(win)).toHaveLength(1)

  // 9. ungroup restores both shapes
  await win.click('[data-testid=tb-ungroup]')
  expect(await nodes(win)).toHaveLength(2)
  expect(await selection(win)).toHaveLength(2)

  // 10. language switch
  await win.click('[data-testid=tb-lang]')
  await win.click('[data-testid=lang-en]')
  await expect(win.locator('[data-testid=shapes-tab-basic]')).toHaveText('Basic')
  await win.click('[data-testid=tb-lang]')
  await win.click('[data-testid=lang-ru]')
  await expect(win.locator('[data-testid=shapes-tab-basic]')).toHaveText('Основные')

  expect(errors).toEqual([])
  await app.close()
})

test('save and open a project', async () => {
  const { app, win } = await launch()
  await win.click('[data-testid=shape-text]')
  await win.click('[data-testid=shape-torus]')
  await idle(win)
  const file = join(tmpdir(), `cad-e2e-${Date.now()}.nerpa`)
  await app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as any
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as any
  }, file)
  await win.keyboard.press('Control+S')
  await expect.poll(() => existsSync(file)).toBe(true)
  const before = await nodes(win)
  await win.click('[data-testid=tb-new]')
  expect(await nodes(win)).toHaveLength(0)
  await win.click('[data-testid=tb-open]')
  await expect.poll(async () => (await nodes(win)).length).toBe(2)
  expect(await nodes(win)).toEqual(before)
  expect(await win.title()).toContain('.nerpa')
  expect(await win.title()).toContain('NerpaCad')
  expect(JSON.parse(readFileSync(file, 'utf8')).format).toBe('nerpacad-project')
  rmSync(file)
  await app.close()
})
