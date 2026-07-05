import { defineConfig } from 'vite';

// GitHub Pages serves the site from /spire-trial/; dev stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/spire-trial/' : '/',
  // Honor a harness-assigned port (e.g. preview tooling); default otherwise.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
}));
