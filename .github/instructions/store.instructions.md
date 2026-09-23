---
description: "Use when editing Zustand slices, persistence or hydration."
applyTo: "src/stores/**"
---
# Store

- A slice must never import from `LidarWebGLLayer.ts` or anything that pulls in shaders, not even a
  type: `tsconfig.test.json` has no `*.frag`/`*.vert` declarations, so `npm run lint:test` breaks
  while `tsc -b` and the editor stay green. Duplicate the small type locally instead.
- Clouds are uploaded by reference: when patching a cloud, allocate new arrays.
