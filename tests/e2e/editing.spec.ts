import { expect, test } from '@playwright/test'
import { idle, launch, nodes, project, selection } from './app'

test('box select, align, mirror, duplicate, delete, keyboard', async () => {
  const { app, win } = await launch()
  // wide enough for align and mirror to sit in the toolbar (narrower windows put them in «More»)
  await win.setViewportSize({ width: 1700, height: 900 })
  await win.waitForTimeout(300)
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.click('[data-testid=shape-box]')
  await win.click('[data-testid=shape-sphere]')
  await win.click('[data-testid=shape-wedge]')
  await idle(win)
  let ns = await nodes(win)
  // click-added shapes do not overlap each other
  const xs = ns.map((n: any) => `${n.transform.position[0]},${n.transform.position[1]}`)
  expect(new Set(xs).size).toBe(3)

  // rubber-band select everything from an empty corner of the workplane
  await win.keyboard.press('Escape')
  expect(await selection(win)).toHaveLength(0)
  const a = await project(win, -95, -95, 0)
  const b = await project(win, 95, 95, 0)
  await win.mouse.move(a.x, a.y)
  await win.mouse.down()
  await win.mouse.move(b.x, b.y, { steps: 6 })
  await win.mouse.up()
  expect(await selection(win)).toHaveLength(3)

  // align all to the minimum X
  await win.click('[data-testid=tb-align]')
  await win.click('[data-testid=align-0-min]')
  await win.keyboard.press('Escape')
  ns = await nodes(win)
  const boxes = await win.evaluate(() => {
    const c = (window as any).__cad
    return c.doc.value.nodes.map((n: any) => c.viewport.sync.worldBox(n.id).min[0])
  })
  expect(Math.max(...boxes) - Math.min(...boxes)).toBeLessThan(1e-6)

  // mirror the wedge along X: scale x becomes negative
  const wedge = ns.find((n: any) => n.prim === 'wedge')
  await win.evaluate((id) => ((window as any).__cad.selection.value = [id]), wedge.id)
  await win.click('[data-testid=tb-mirror]')
  await win.click('[data-testid=mirror-0]')
  ns = await nodes(win)
  expect(ns.find((n: any) => n.id === wedge.id).transform.scale[0]).toBe(-1)

  // duplicate, then arrow-nudge the copy, then delete it
  await win.keyboard.press('Control+D')
  expect(await nodes(win)).toHaveLength(4)
  const copyId = (await selection(win))[0]
  expect(copyId).not.toBe(wedge.id)
  const before = (await nodes(win)).find((n: any) => n.id === copyId).transform.position
  await win.keyboard.press('Control+ArrowUp')
  const after = (await nodes(win)).find((n: any) => n.id === copyId).transform.position
  expect(after[2] - before[2]).toBe(1)
  await win.keyboard.press('Delete')
  expect(await nodes(win)).toHaveLength(3)

  // H makes a hole, S makes it solid again
  await win.evaluate((id) => ((window as any).__cad.selection.value = [id]), wedge.id)
  await win.keyboard.press('h')
  expect((await nodes(win)).find((n: any) => n.id === wedge.id).isHole).toBe(true)
  await win.keyboard.press('s')
  expect((await nodes(win)).find((n: any) => n.id === wedge.id).isHole).toBe(false)

  // help dialog opens and closes
  await win.keyboard.press('F1')
  await expect(win.locator('[data-testid=help]')).toBeVisible()
  await win.keyboard.press('F1')
  await expect(win.locator('[data-testid=help]')).toHaveCount(0)

  // theme switcher: every theme applies, the choice sticks, then back to cyberpunk
  for (const id of ['desert', 'sea', 'industrial', 'cyberpunk']) {
    await win.click('[data-testid=tb-theme]')
    await win.click(`[data-testid=theme-${id}]`)
    expect(await win.evaluate(() => document.documentElement.dataset.theme)).toBe(id)
    expect(await win.evaluate(() => localStorage.getItem('cad.theme'))).toBe(id)
  }

  expect(errors).toEqual([])
  await app.close()
})
