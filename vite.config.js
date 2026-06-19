import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// 에디터 버전 = git short SHA(+dirty). PPT 메타정보 기록용.
let _editorVersion = 'dev'
try {
  const sha = execSync('git rev-parse --short HEAD').toString().trim()
  let dirty = ''
  try { if (execSync('git status --porcelain').toString().trim()) dirty = '+' } catch { /* noop */ }
  _editorVersion = sha + dirty
} catch { /* git 없으면 dev */ }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(_editorVersion) },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8321',
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
})
