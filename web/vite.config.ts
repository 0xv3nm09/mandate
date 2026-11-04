import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // relative base → the same build runs at '/', on Render, or on GitHub Pages
  // under a repo subpath (e.g. 0xv3nm09.github.io/mandate/web/dist/index.html)
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
});
