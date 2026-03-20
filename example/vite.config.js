import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    outDir: '../docs/example'
  },
  optimizeDeps: {
    include: ['chess.js']
  }
})
