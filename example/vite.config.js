import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    outDir: '../docs/example'
  },
  optimizeDeps: {
    include: ['chess.js']
  }
})
