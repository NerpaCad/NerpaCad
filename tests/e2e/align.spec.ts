/**
 * The align tool (Tinkercad style): L or the toolbar button shows dots round the selection;
 * pointing at a dot previews, clicking lines the shapes up (one undo step) and the tool stays on;
 * a click on one of the selected shapes makes it the reference the others line up with.
 */
import { expect, test } from '@playwright/test'
import { idle, launch } from './app'

const cad = (win: any, fn: (arg?: any) => any, arg?: any) => win.evaluate(fn, arg)
const boxes = (win: any) =>
  cad(win, () => {
    const c = (window as any).__cad
    return c.doc.value.nodes.map((n: any) => ({ id: n.id, ...c.viewport.sync.worldBox(n.id) }))
  })
const dot = (win: any, axis: number, mode: string) => cad(win, ([a, m]: [number, string]) => (window as any).__cad.viewport.alignDotScreen(a, m), [axis, mode])

test('align: dots, preview on hover, click lines up, reference shape, Esc', async () => {
  const { app, win } = await launch()
  // three boxes of different sizes at different places
  const ids = await cad(win, () => {
    const c = (window as any).__cad
    const A = c.actions
    const out: string[] = []
    for (const [x, y, s] of [[-40, -30, 20], [10, 20, 30], [50, -10, 14]]) {
      const id = A.addShape('box')
      const n = c.doc.value.nodes.find((q: any) => q.id === id)
      A.setTransformOf?.(id, { ...n.transform, position: [x, y, 0], scale: [s / 20, s / 20, s / 20] })
      out.push(id)
    }
    return out
  })
  await cad(win, (list: string[]) => {
    const c = (window as any).__cad
    const pos: number[][] = [[-40, -30, 0], [10, 20, 0], [50, -10, 0]]
    const sc = [1, 1.5, 0.7]
    c.doc.value = { ...c.doc.value, nodes: c.doc.value.nodes.map((n: any, i: number) => ({ ...n, transform: { ...n.transform, position: pos[i], scale: [sc[i], sc[i], sc[i]] } })) }
    c.selection.value = list
  }, ids)
  await idle(win)
  await cad(win, () => (window as any).__cad.viewport.fitView())
  await win.waitForTimeout(600)

  await win.keyboard.press('l')
  await expect(win.getByTestId('tb-align')).toHaveClass(/on|active/)
  // no size labels or handles while aligning; 9 dots on the model
  expect(await cad(win, () => (window as any).__cad.viewport.gizmo.visible)).toBe(false)
  for (const a of [0, 1, 2]) for (const m of ['min', 'center', 'max']) expect(await dot(win, a, m), `${a} ${m}`).not.toBeNull()
  await win.screenshot({ path: 'test-results/align-dots.png' })

  // hover the "X max" dot: a preview, nothing recorded; leaving it puts them back
  const before = await boxes(win)
  const xmax = await dot(win, 0, 'max')
  await win.mouse.move(xmax.x, xmax.y)
  await expect.poll(async () => new Set((await boxes(win)).map((b: any) => Math.round(b.max[0] * 1000))).size).toBe(1)
  await win.screenshot({ path: 'test-results/align-preview.png' })
  await win.mouse.move(70, 640)
  await expect.poll(async () => (await boxes(win)).map((b: any) => b.max[0])).toEqual(before.map((b: any) => b.max[0]))

  // click "Y min": lined up, one undo step, the tool stays on
  const ymin = await dot(win, 1, 'min')
  await win.mouse.move(ymin.x, ymin.y)
  await win.mouse.down()
  await win.mouse.up()
  const y0 = (await boxes(win)).map((b: any) => b.min[1])
  expect(Math.max(...y0) - Math.min(...y0)).toBeLessThan(1e-6)
  expect(await cad(win, () => !!(window as any).__cad.viewport.alignTool.active)).toBe(true)
  await cad(win, () => (window as any).__cad.actions.undo())
  await idle(win)
  expect((await boxes(win)).map((b: any) => b.min[1])).toEqual(before.map((b: any) => b.min[1]))

  // the small box as the reference: the others' centres come to its centre, it does not move
  const small = before[2]
  const s = await cad(win, (id: string) => {
    const c = (window as any).__cad
    const b = c.viewport.sync.worldBox(id)
    return c.project((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2])
  }, small.id)
  await win.mouse.click(s.x, s.y)
  expect(await cad(win, () => (window as any).__cad.viewport.alignTool.active)).toBe(true)
  const xc = await dot(win, 0, 'center')
  await win.mouse.move(xc.x, xc.y)
  await win.mouse.down()
  await win.mouse.up()
  const after = await boxes(win)
  const mid = (b: any) => (b.min[0] + b.max[0]) / 2
  for (const b of after) expect(mid(b)).toBeCloseTo(mid(small), 5)
  expect(after[2].min[0]).toBeCloseTo(small.min[0], 6)

  // Esc: off, the size handles are back
  await win.keyboard.press('Escape')
  expect(await cad(win, () => (window as any).__cad.viewport.alignTool.active)).toBe(false)
  expect(await cad(win, () => (window as any).__cad.selection.value.length)).toBe(3)
  await app.close()
})
