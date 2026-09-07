# Copilot instructions — open-cairn

## Language

- **Code is English**: variable, function, type and file names, and **all comments**.
- **The UI is French**: labels, buttons, headings, user-facing error messages, `title`/`aria-label`,
  panel and modal text. Never translate the UI to English.
- Console messages (`console.warn`/`console.error`) follow the code rule — English — unless they
  echo a string already shown to the user.
- **Commit messages are English**, like the code. Existing French commit messages are history:
  leave them alone, do not rewrite them.
- Chat replies to the user and the `docs/` folder are written in French.

## No backward compatibility

The app is **pre-release**. Until the user explicitly says otherwise, do **not** write code whose
only purpose is to keep older data readable:

- no optional field kept "just in case", no fallback branch, no migration path, no version guard
  for previously persisted `localStorage` / IndexedDB / exported-scene shapes;
- when a stored shape changes, change it outright and make the new field **required** — the compiler
  is then the guarantee that every call site was updated;
- the user recreates his scenes and captures; a stale persisted value should fail its validation
  guard and fall back to the default, not be migrated.

Ask before removing back-compat that exists for a reason other than legacy data (for example a
forward-compat version check).

## Documentation

`docs/` describes how the app actually behaves, not just what it was meant to do.
**After any change that could have an impact, re-read the relevant document(s) and update them in
the same pass** — a doc describing behaviour that no longer exists is worse than no doc.

Topic → document:

| Topic touched | Document |
|---|---|
| Basemaps, hillshade, `composite://` | `docs/BASEMAPS_AND_HILLSHADE.md` |
| Camera animation along a route | `docs/FLYOVER.md` |
| IGN services, URLs, API keys | `docs/IGN_DATA_SOURCES.md` |
| LiDAR pipeline (extraction, normals, Poisson, worker) | `docs/LIDAR_PIPELINE.md` |
| LiDAR rendering (WebGL, shaders, EDL, shadows) | `docs/LIDAR_RENDERING.md` |
| Rock, cliffs, palettes, micro-relief | `docs/ROCK_AND_CLIFF_DETAIL.md` |
| PoissonRecon WASM | `docs/POISSON_WASM.md` |
| Relief maps | `docs/RELIEFMAPS_ARCHITECTURE.md` |
| Routing, elevation profile | `docs/ROUTING_AND_ELEVATION.md` |
| Saved routes, GPX | `docs/SAVED_ROUTES_AND_GPX.md` |
| Search, geocoding, coordinates | `docs/SEARCH_AND_COORDINATES.md` |
| URL sharing | `docs/SHARE_VIEW.md` |
| Zustand store, persistence | `docs/STATE_AND_PERSISTENCE.md` |
| Sun, lighting | `docs/SUN_LIGHTING.md` |
| UI shell, responsive, mobile | `docs/UI_SHELL_AND_RESPONSIVE.md` |
| Improvement plan (task status) | `docs/ARCHITECTURE_REVIEW_PLAN.md` |

`README.md` lists the features: update it when a feature is added, removed, or visibly renamed.

## Validation gates

`npm run lint` checks **nothing** (the root `tsconfig.json` has `"files": []`). The real gates are:

```bash
npx tsc -b && npm run lint:test && npm run test:run && npm run build
```

None of these gates compile GLSL (`vite-plugin-glsl` only does textual inclusion): after editing a
shader, do a full page reload and read the console.

SonarQube's cognitive-complexity cap of **15** and its **7-parameter** cap apply, but no config in
the repo enforces them — nothing in the gates will catch a violation. Extract a helper instead of
inlining another branch; bundle related arguments into one object instead of adding an 8th
parameter.

## Verifying a change

A green gate does not mean the change was observed. Before claiming a rendering or pipeline change
works — or that it changes nothing:

- HMR **never** rebuilds a `LidarWebGLLayer` instance → full page reload;
- the LiDAR worker is **not** hot-reloaded → a pipeline change needs a fresh capture;
- `screenshot_page` returns the **previous** frame → take two, keep the second;
- the map does not repaint on its own after a palette/store change → force a frame (move
  `location.hash` + dispatch `HashChangeEvent`);
- `locator.click()` always times out on "element is not stable" (the map animates continuously) →
  click through `page.evaluate`.

Measure before concluding: several shader parameters were "invisible" only because their physical
value was ~3 % of display value.

## One throw is a white page

There is still no `ErrorBoundary` anywhere (task P0-2 in `docs/ARCHITECTURE_REVIEW_PLAN.md`), so any
throw in a passive effect or in a WebGL layer's `onAdd` empties `#root` with no message. Therefore:

- validate every persisted value whose type is a union against its set of allowed values at
  hydration, and fall back to the default (a stale `localStorage` entry can hold a value from
  another branch);
- reset any `useRef` holding a map-bound resource (control, source, listener) in the init effect's
  cleanup, next to `map.remove()` — StrictMode recreates the map and the ref goes stale;
- clamp what a MapLibre constructor option accepts (`pitch > 90` at construction throws).

## Editing files

- Anchor an `oldString` on complete syntactic boundaries; starting mid-block has silently swallowed
  the tail of the surrounding call. Re-read the edited region afterwards.
- A single-line `newString` with no trailing newline glues the statement onto the tail of a `//`
  comment — a recurring GLSL breakage.
- Never write a source file through shell redirection: VS Code's shell integration leaks OSC escape
  bytes into the first line and corrupts it silently.

Adding a LiDAR render setting touches six files in a fixed order — the checklist lives in
`docs/STATE_AND_PERSISTENCE.md`.
