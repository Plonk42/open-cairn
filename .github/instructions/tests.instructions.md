---
description: "Use when writing or debugging Vitest tests."
applyTo: "**/*.test.ts"
---
# Tests

- Several rejected mocks in a row are reported as unhandled rejections; several promises that never
  resolve leave the process hanging after every assertion passed (`--testTimeout` does not fire).
  Keep at most one, resolved late under fake timers, or make the stub reject on `signal.abort`.
- While diagnosing, write vitest output to a file rather than piping it to `tail` (buffered).
- CI runs in UTC, `vitest.config.ts` pins `Europe/Paris`: rerun a dated test with
  `TZ=UTC npm run test:run`.
- Derive an expected normal from the surface gradient, never by intuition. A flat `(0,0,1)` vertex
  has a degenerate azimuth (treated as north): tilt it a few degrees to test altitude alone.
