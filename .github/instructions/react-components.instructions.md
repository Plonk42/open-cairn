---
description: "Use when writing React components, hooks and effects."
applyTo: "src/components/**/*.tsx, src/lib/use*.ts"
---
# React components

- `App` and `LidarStudio` are unmounted on every view switch (only `MapContainer` persists):
  state that must survive it goes in the store, not in `useState`/`useRef`.
- An "already fetched" ref set before an `await` must be cleared in the cleanup when the attempt
  did not settle, otherwise a cancelled effect never retries.
- An array rebuilt on every render and listed in the deps of an effect that constructs something
  (a chart, a layer) rebuilds it every frame: `useMemo`.
- Never `confirm()`/`alert()` or `await` before a file input's `.click()`: it consumes the user
  activation and the file picker is refused. Open the picker first, confirm after.
