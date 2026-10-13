import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import preact from '@preact/preset-vite'
import pkg from './package.json'

/** the code's address from package.json "repository" (a string or { url }), as a web link */
function repoUrl(): string {
  const r = (pkg as Record<string, unknown>).repository as string | { url?: string } | undefined
  const url = typeof r === 'string' ? r : (r?.url ?? '')
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

export default defineConfig({
  main: {
    build: { externalizeDeps: true }
  },
  preload: {
    build: { externalizeDeps: true }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [preact()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_HOMEPAGE__: JSON.stringify(pkg.homepage ?? ''),
      __APP_REPO__: JSON.stringify(repoUrl())
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src/renderer') }
    },
    // manifold-3d ships its own .wasm next to the JS; pre-bundling breaks that path.
    optimizeDeps: { exclude: ['manifold-3d', '@salusoft89/planegcs'], include: ['opentype.js', 'three', 'preact', '@preact/signals'] },
    worker: { format: 'es' },
    build: {
      target: 'chrome140',
      assetsInlineLimit: 0,
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
