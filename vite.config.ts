import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

// For GitHub Pages deployment under /<repo>/, set VITE_BASE at build time.
const base = process.env.VITE_BASE ?? '/';

// vitest 2.x doesn't honour vite-plugin-glsl's declarative `transform.filter`
// (Vite ≥ 6.3), so the shader transform would run on every test file. Tests
// don't import shaders, so the plugin is only needed for dev/build.
const isVitest = !!process.env.VITEST;

export default defineConfig({
    base,
    plugins: [react(), ...(isVitest ? [] : [glsl()])],
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
