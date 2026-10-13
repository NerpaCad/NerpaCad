/**
 * The installed mods: read once at start (before anything is drawn), their robots registered for
 * the panel, the inspector, the simulation and the geometry worker. See `core/robotics/mods.ts`.
 */
import { signal } from '@preact/signals'
import { type ModInfo, parseMod } from '../core/robotics/mods'
import { ROBOTS, type RobotSpec, registerRobot } from '../core/robotics/robot'
import { geom } from '../core/geom/client'

export interface InstalledMod {
  /** its folder's name (and full path) */
  folder: string
  path: string
  /** null: it could not be used (see errors) */
  mod: ModInfo | null
  errors: string[]
}

/** what the mods folder holds (the About window lists it) */
export const installedMods = signal<InstalledMod[]>([])
/** every robot model there is: NerpaBot first, then those of the mods */
export const robotModels = signal<RobotSpec[]>(Object.values(ROBOTS))

let started: Promise<void> | null = null

/** Read the mods (once). Never fails: a broken mod is listed with what is wrong with it. */
export function initMods(): Promise<void> {
  started ??= (async () => {
    const found = await window.api?.modsList?.().catch(() => []) ?? []
    const taken = new Set(Object.keys(ROBOTS))
    const out: InstalledMod[] = []
    for (const f of found) {
      if (f.manifest === null) {
        out.push({ folder: f.folder, path: f.path, mod: null, errors: ['mod.json not found'] })
        continue
      }
      const r = parseMod(f.manifest, `mod://${f.key}/`, taken)
      if (r.mod) for (const robot of r.mod.robots) if (registerRobot(robot)) taken.add(robot.id)
      out.push({ folder: f.folder, path: f.path, ...r })
      if (r.errors.length) console.warn(`mod ${f.folder}:`, r.errors.join('; '))
    }
    installedMods.value = out
    robotModels.value = Object.values(ROBOTS)
    const fromMods = Object.values(ROBOTS).filter((x) => x.mod)
    if (fromMods.length) geom.setRobots(fromMods)
  })()
  return started
}
