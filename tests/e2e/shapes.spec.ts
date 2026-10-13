import { expect, test } from '@playwright/test'
import { idle, launch, nodes } from './app'

test('basic shapes: polygon, icosahedron, half sphere and round roof are added and set up', async () => {
  const { app, win } = await launch()
  const errors: string[] = []
  win.on('pageerror', (e) => errors.push(e.message))
  for (const t of ['hemisphere', 'roundRoof', 'polygon', 'icosahedron']) {
    await win.getByTestId(`shape-${t}`).focus()
    await win.keyboard.press('Enter')
    await idle(win)
  }
  let ns = await nodes(win)
  expect(ns.map((n: any) => n.prim)).toEqual(['hemisphere', 'roundRoof', 'polygon', 'icosahedron'])
  // named in the interface language (Russian in the tests)
  ;['Полусфера', 'Круглая кровля', 'Многоугольник', 'Икосаэдр'].forEach((x, i) => expect(ns[i].name.startsWith(x)).toBe(true))
  // the polygon's sides are set in the inspector
  const poly = ns.find((n: any) => n.prim === 'polygon')
  await win.evaluate((id) => ((window as any).__cad.selection.value = [id]), poly.id)
  const sides = win.getByTestId('param-sides')
  await expect(sides).toHaveValue('6')
  await sides.fill('8')
  await sides.press('Enter')
  await idle(win)
  ns = await nodes(win)
  expect(ns.find((n: any) => n.id === poly.id).params.segments).toBe(8)
  // each one has real geometry
  const boxes = await win.evaluate(() => {
    const c = (window as any).__cad
    return c.doc.value.nodes.map((n: any) => c.viewport.worldBoxes([n.id])[n.id])
  })
  for (const b of boxes) expect(b.max[2] - b.min[2]).toBeGreaterThan(5)
  await win.screenshot({ path: 'test-results/shapes-basic.png' })
  expect(errors).toEqual([])
  await app.close()
})
