---
description: "Use when editing the LiDAR capture pipeline or anything it imports (worker code)."
applyTo: "src/lib/lidarBrowser/**"
---
# LiDAR pipeline — worker constraints

- Every module reachable from `pipeline.ts` runs in the Web Worker: no `document`, no `new Image()`,
  no `HTMLCanvasElement`. Use `OffscreenCanvas`, `createImageBitmap(await res.blob())`, `fetch`.
  A DOM call there fails only at runtime, often inside a best-effort `catch` that hides it.
- `LidarWebGLLayer.setMesh`/`setData` skip the upload when the array reference is unchanged: a
  producer must allocate a new typed array, never mutate one in place.
- The worker is not hot-reloaded: judge a pipeline change on a fresh capture.
