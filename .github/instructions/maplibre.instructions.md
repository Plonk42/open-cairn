---
description: "Use when adding MapLibre sources, layers, custom layers, style listeners or camera code."
applyTo: "src/components/map/**, src/lib/skyProjection.ts, src/lib/panoramaDetail.ts, src/lib/freeCamera.ts, src/lib/viewpointCamera.ts"
---
# MapLibre

- Do not gate on `map.isStyleLoaded()`: it waits for tiles too and stays false after a style
  rebuild. Try the call and poll on the exception (`styleReady.ts`).
- Anything re-run on `styledata` (`applyWhenStyleReady`) must do nothing when nothing changed.
  `setPaintProperty` short-circuits; `setSky` and `moveLayer` do not — they re-fire `styledata`,
  the map repaints forever and `idle` never fires. On a still map, `render` must count 0.
- `setStyle({diff:true})` re-adds a layer whose source changed at the top of the stack, above the
  custom layers. Their order is re-asserted in `reassertCustomLayerOrder` (`MapContainer.tsx`);
  a new custom layer belongs there. Custom layers are absent from `getStyle().layers`: read
  `map.getLayersOrder()`.
- With 3D terrain, the first `map.unproject()` after a camera change redraws the terrain into the
  coords framebuffer and blocks on `readPixels` (~6 ms). Keep it off per-frame paths.
