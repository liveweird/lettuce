import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/login': 'http://localhost:8080',
      '/logout': 'http://localhost:8080',
      '/users': 'http://localhost:8080',
      '/teams': 'http://localhost:8080',
      '/feedbacks': 'http://localhost:8080',
    },
  },
})
