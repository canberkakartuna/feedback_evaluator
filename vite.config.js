import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Same-origin /api in development, so the client needs no base URL.
    proxy: {
      '/api': {
        target: process.env.API_ORIGIN ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
