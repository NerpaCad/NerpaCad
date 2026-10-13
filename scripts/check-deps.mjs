// Before starting: make sure every package from package.json is installed in a fitting version.
// After an update adds or bumps a library, `npm run dev` installs it by itself instead of failing
// with "Failed to resolve import …" or running against an old version.
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const wanted = { ...pkg.dependencies, ...pkg.devDependencies }

const parse = (v) => v.replace(/^[^\d]*/, '').split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0)
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Enough of npm's range rules for this project: exact, ^x.y.z and ~x.y.z. */
function fits(installed, range) {
  const v = parse(installed)
  const r = parse(range)
  if (/^\d/.test(range)) return cmp(v, r) === 0
  if (cmp(v, r) < 0) return false
  if (range.startsWith('~')) return v[0] === r[0] && v[1] === r[1]
  if (range.startsWith('^')) return r[0] > 0 ? v[0] === r[0] : r[1] > 0 ? v[0] === 0 && v[1] === r[1] : cmp(v, r) === 0
  return true
}

const problems = []
for (const [name, range] of Object.entries(wanted)) {
  const file = join(root, 'node_modules', name, 'package.json')
  if (!existsSync(file)) {
    problems.push(`${name} (нет / missing)`)
    continue
  }
  const version = JSON.parse(readFileSync(file, 'utf8')).version
  if (!fits(version, range)) problems.push(`${name} ${version} → ${range}`)
}

if (problems.length) {
  console.log(`\nНужно обновить пакеты / packages to install: ${problems.join(', ')}`)
  console.log('Запускаю npm install / running npm install…\n')
  const r = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error('\nnpm install завершился с ошибкой / npm install failed')
    process.exit(r.status ?? 1)
  }
}
