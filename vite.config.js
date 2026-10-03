import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
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
    // git 워크트리는 .claude/worktrees/ 아래, 즉 리포 안에 산다. 빼 두지 않으면 루트에서
    // 테스트를 한 번 돌릴 때 워크트리 수만큼 같은 스위트가 겹쳐 돈다(워크트리 둘이면 3배).
    // 느린 것으로 끝나지 않는다 — jsdom 환경이 그만큼 겹쳐 뜨면서 부하로 타임아웃이 나고,
    // 그게 진짜 실패인지 분간이 안 된다. 실제로 331개가 한 번은 3건 실패, 다음 번엔 전부
    // 통과했다. configDefaults에 얹는다 — exclude를 그냥 쓰면 기본값을 덮어쓴다.
    exclude: [...configDefaults.exclude, '**/.claude/worktrees/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: { lines: 80, functions: 80 },
    },
  },
})
