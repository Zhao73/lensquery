import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  server: {
    watch: {
      ignored: ['**/artifacts/**', '**/n8n-ppt-benchmark/**', '**/output/**', '**/references/**', '**/tmp/**'],
    },
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/.git/**',
      '**/artifacts/**',
      '**/n8n-ppt-benchmark/**',
      '**/output/**',
      '**/references/**',
      '**/release-electron/**',
      '**/tmp/**',
    ],
  },
})
