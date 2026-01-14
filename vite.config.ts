import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      // Local dev proxy to avoid CORS (mirrors Vercel `/api/cursor/*` function)
      '/api/cursor': {
        target: 'https://api.cursor.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/cursor/, ''),
      },
    },
  },
})
