import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base path so the build works on GitHub Pages (served from a
// /<repo>/ subpath) as well as Vercel / local preview.
export default defineConfig({
  base: './',
  plugins: [react()],
})
