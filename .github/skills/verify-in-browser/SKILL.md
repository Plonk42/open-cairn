---
name: verify-in-browser
description: 'Verify a change live in the shared Playwright page on the Vite dev server: reach the app store and map, drive the camera and controls, capture screenshots, test GLSL and worker code without a capture, inspect downloads, check IGN data. Use when observing a rendering, UI or pipeline change, reproducing a bug, or measuring performance in the browser.'
user-invocable: false
---

# Verify in the browser

Complements « Verifying a change » in `.github/copilot-instructions.md` (full reload, fresh capture,
two screenshots, forced repaint, click via `page.evaluate`) — not repeated here.

## Reach the app state

- `import('/src/…')` from `page.evaluate` can return a **second instance** of the module (Vite adds
  `?t=` after an edit): `mapInstance` is null and mutations do nothing. Resolve the URL the app loaded:
  ```js
  const url = performance.getEntriesByType('resource').map(e => e.name)
    .filter(n => /stores\/mapStore/.test(n)).pop();
  const { useMapStore } = await import(/* @vite-ignore */ url);
  const map = useMapStore.getState().mapInstance;
  ```
- Simpler for camera or date: write `localStorage['open-cairn-settings']` and reload. Dump the whole
  value first and restore it at the end — it is the user's state.
- Never `import('/src/lib/*.json')` in the page: Vite caches the JS-module form and the app's
  `?url` fetch then gets `export default …`. Restart the dev server to recover.
- Never probe an idb-keyval database with a bare `indexedDB.open`: it creates the base without its
  object store, a permanent corruption. Use `createStore` + `keys` from
  `/node_modules/.vite/deps/idb-keyval.js`.
- Never pass a hand-built object to a camera setter or write `map.transform`: the transform is
  corrupted until reload.
- `page.evaluate` is plain JS (no `as`). A click and a DOM query in the same call read the old DOM.
- A cloud re-opened from IndexedDB was built by the old code: check the layer id / `createdAt`.

## Navigate

- `page.goto` to the same URL with another hash does not reload: go to `about:blank` first.
  `#share=` is consumed on load; build a share URL in the page with `buildShareUrl`.
- Several tabs at the same URL: select the page on a unique query parameter.
- Remove every `page.route()` (`page.unrouteAll({ behavior: 'ignoreErrors' })`) before handing
  back: a forgotten handler silently blocks every future tile request on the shared page.

## Drive controls

- React-controlled range input:
  ```js
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  ```
- Viewpoint mode re-applies its own pose on `idle`: `setPitch`/`jumpTo` do not stick. Replay the
  gestures on the canvas (`WheelEvent` for the field of view, pointer events for heading/pitch).

## Observe and measure

- The shared page is VS Code's Simple Browser (Electron) on an integrated GPU: its frame rate says
  nothing about smoothness. Measure synchronous JS time or normalised quantities (°/s, px/s).
- Small details: `page.screenshot({ path, clip })` then `view_image`; `clip` is in CSS px while the
  image comes out at the device pixel ratio (1.5). Enlarge with PIL if needed.
- Downloads emit no Playwright event here: hook `HTMLAnchorElement.prototype.click` and
  `URL.createObjectURL` (keep the first blob).
- To test gallery display without a 4-minute capture, inject a synthetic entry in `localStorage`
  and reload (`useSyncExternalStore` does not see writes from another context).

## GLSL and worker without a capture

- Link: `import('/src/components/map/lidar-gl/shaders.ts')`, compile and link each program in a
  throwaway WebGL2 canvas, check `getUniformLocation`/`getAttribLocation` on what was added.
- GLSL ↔ CPU parity: fragment shader = `#version 300 es` + `palette.glsl` text + a `main()` that
  outputs `paletteAlbedo(...)`; draw one point on a 1×1 canvas, `readPixels`, compare to
  `vertexColor` from `slope.ts`.
- Worker-only code: `new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })),
  { type: 'module' })` whose source imports the module by absolute URL; post stage markers to tell
  an import failure from a slow fetch.

## IGN data

- Never conclude "the data is wrong" from a mesh — it is solver output. Re-read the source
  (`extractPoints` on the tile, or `mcp_geocontext_altitude`).
- A 400 from `data.geopf.fr` can be intermittent: replay the same URL 20–30 times first.
- Do not trust a capabilities `WGS84BoundingBox`: probe real tiles.

## Node scripts importing `src/`

`src/` uses extensionless imports; run with the resolve hook:
```bash
node --import='data:text/javascript,import{register}from"node:module";import{pathToFileURL}from"node:url";register("./tools/showcase/ts-resolve.mjs",pathToFileURL("./"));' script.ts
```
