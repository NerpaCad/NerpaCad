import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Start the app. Each start gets an autosave folder and an (empty) mods folder of its own (a
 * project autosaved by one test must not be offered to the next), unless `env` names them.
 */
export async function launch(env: Record<string, string> = {}): Promise<{ app: ElectronApplication; win: Page }> {
  // Linux CI containers usually have no GPU: fall back to software WebGL there.
  const extra =
    process.platform === 'linux'
      ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
      : []
  const app = await electron.launch({
    args: [resolve(__dirname, '../..'), ...extra],
    env: {
      ...process.env,
      CAD_SKIP_CLOSE_PROMPT: '1',
      ELECTRON_RENDERER_URL: '',
      CAD_AUTOSAVE_DIR: mkdtempSync(join(tmpdir(), 'nerpa-autosave-')),
      // no mods unless a test brings its own (the developer's mods/ folder is not used)
      CAD_MODS_DIR: mkdtempSync(join(tmpdir(), 'nerpa-mods-')),
      ...env
    } as Record<string, string>
  })
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('[data-testid=viewport] canvas')
  await win.evaluate(() => localStorage.setItem('cad.lang', 'ru'))
  return { app, win }
}

/** Screen position of a world point. */
export function project(win: Page, x: number, y: number, z: number) {
  return win.evaluate(
    ([a, b, c]) => (window as any).__cad.project(a, b, c) as { x: number; y: number },
    [x, y, z]
  )
}

export async function idle(win: Page) {
  await win.waitForFunction(() => (window as any).__cad.geomBusy() === 0)
  await win.waitForTimeout(120)
}

export const nodes = (win: Page) => win.evaluate(() => (window as any).__cad.doc.value.nodes)
export const selection = (win: Page) => win.evaluate(() => (window as any).__cad.selection.value)
