import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// For GitHub Pages deployment under /<repo>/, set VITE_BASE at build time.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});
