import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

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
        proxy: {
            // Proxy LiDAR cloud requests to the local Node service.
            // Override with VITE_LIDAR_CLOUD_PROXY=http://host:port if needed.
            '/api/lidar-cloud': {
                target: process.env.VITE_LIDAR_CLOUD_PROXY ?? 'http://localhost:8788',
                changeOrigin: true,
            },
        },
    },
});
