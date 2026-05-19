import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'pipeline-entry.js'),
      name: 'FlatPipeline',
      formats: ['iife'],
      fileName: () => 'pipeline.iife.js',
    },
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
