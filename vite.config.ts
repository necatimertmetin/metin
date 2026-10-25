import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, isPreview }) => ({
  plugins: [react()],
  /* the built site is served from GitHub Pages at necatimertmetin.github.io/metin/ (and `vite preview` serves it the same way) */
  base: command === 'build' || isPreview ? '/metin/' : '/',
}))
