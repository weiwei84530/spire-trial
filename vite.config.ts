import { defineConfig } from 'vite';

// GitHub Pages serves the site from /spire-trial/; dev stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/spire-trial/' : '/',
}));
