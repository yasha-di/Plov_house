import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// On GitHub Actions the base path becomes "/<repo-name>/" automatically,
// so GitHub Pages serves assets from the right sub-path. Locally it stays "/".
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1]

export default defineConfig({
  plugins: [react()],
  base: repo ? `/${repo}/` : '/',
})
