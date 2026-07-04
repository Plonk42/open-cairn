// Minimal Node ESM resolve hook: appends `.ts` (or `/index.ts`) to relative
// specifiers that have no extension, so source files using extensionless
// imports (resolved by Vite/tsc at build time) can run under raw `node`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
        const base = new URL(specifier, context.parentURL);
        for (const cand of [`${base.href}.ts`, `${base.href}/index.ts`]) {
            if (existsSync(fileURLToPath(cand))) return next(cand, context);
        }
    }
    return next(specifier, context);
}
