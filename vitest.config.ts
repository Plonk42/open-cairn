import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
    viteConfig,
    defineConfig({
        test: {
            environment: 'jsdom',
            globals: true,
            setupFiles: ['./src/test/setup.ts'],
            include: ['src/**/*.{test,spec}.{ts,tsx}'],
            // The sky maths reads a local wall clock (`minutesOfDay` is minutes
            // since LOCAL midnight), so an expected sunrise is only a number
            // once a zone is named. Without this the suite passes in France and
            // fails in CI, which runs in UTC.
            env: { TZ: 'Europe/Paris' },
        },
    }),
);
