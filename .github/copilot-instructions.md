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
| Sun, moon, lighting | `docs/SUN_LIGHTING.md` |
| UI shell, responsive, mobile | `docs/UI_SHELL_AND_RESPONSIVE.md` |
| Improvement plan (task status) | `docs/ARCHITECTURE_REVIEW_PLAN.md` |
| Things left aside / to revisit later | `docs/TODO.md` |
| Choices the maintainer settled | `docs/DECISIONS.md` |

Read `docs/DECISIONS.md` before proposing to change a behaviour or a layout: do not reopen a
settled choice without a new fact, and record there any new choice the user settles.

`README.md` lists the features: update it when a feature is added, removed, or visibly renamed.

Whenever a task leaves something aside ("later", "out of scope", a fix identified but not applied)
or a discovery surfaces a defect/idea worth revisiting, append a `- [ ] ...` entry to
`docs/TODO.md` in the same pass — do not just mention it in the chat reply and move on.

## Mobile is half the app

The app has **two chromes**, not one desktop chrome with a narrower layout. Below 768 px the whole
desktop shell is unmounted and replaced:

| Desktop | Mobile (`< 768 px`) |
|---|---|
| `TopBarActions.tsx` (button group) | `MobileActionsMenu.tsx` (the `⋯` dropdown) |
| `RouteBottomBar` + `RouteDock` | `MobileToolbar` + bottom sheets |
| `App.tsx` / `LidarStudio.tsx` desktop branch | `MobileLayout.tsx` / `StudioMobileShell` |

So a new affordance added to `TopBarActions` **does not exist on a phone** until it is also placed
in `MobileActionsMenu` — which both mobile shells share, hence its `view` prop. Whenever you add or
move a control, ask where its mobile twin lives and put it there in the same pass.

The same applies to gestures — a feature reachable by touch but undrivable by touch is still
missing:

- anything driven by the **wheel** needs a **two-finger pinch** equivalent (`fovAfterPinch` next to
  `fovAfterWheel` is the pattern);
- anything driven by `mousedown` needs pointer events, `e.button` guarded by `pointerType`, and
  multi-pointer bookkeeping keyed by `pointerId` — a second finger must not read as a jump;
- when MapLibre's gesture handlers are **disabled**, MapLibre also drops its `maplibregl-touch-*`
  classes, and with them the canvas `touch-action: none`. The browser then claims the gesture and
  fires `pointercancel` at the first finger move. Set `canvas.style.touchAction = 'none'` for the
  duration and restore the previous value in the cleanup;
- `pointercancel` has already released the capture — `releasePointerCapture` throws a second time.
  Guard with `hasPointerCapture`.

Check the result at a phone viewport (390 × 844), not just at a narrow desktop window, and keep the
mobile section of `docs/UI_SHELL_AND_RESPONSIVE.md` (including its *Limitations*) in step.

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
value was ~3 % of display value. Never answer a rendering bug report without reproducing it in the
browser first. The `verify-in-browser` skill holds the recipes.

## Diagnosing

Mistakes that recurred on this codebase:

- a constant in an absolute unit (metres, tiles) is right at one capture size only — express it in
  the unit of the computation (octree cell, texture pixel) and keep the absolute value as a floor;
- an analytic law that contradicts a measured table already in the repo is wrong — reread the table;
- a threshold calibrated alone goes stale when a filter is added downstream — re-sweep it after
  each new guard, on labelled data rather than hand-picked examples;
- an integer derived by `Math.round` from a continuous quantity makes a sawtooth in everything
  downstream — bypass the derivation where it is meaningless rather than change the rounding;
- "nothing moves and no error": look for what can never finish (orphan promise, request without
  timeout) before looking for slowness;
- a `200 OK` can still be wrong for a given request shape — check a known value alone *and* in a
  batch before trusting a sampling;
- a measurement made to confirm a hypothesis proves nothing; when a diagnosis falls, remove what it
  motivated instead of keeping it "just in case".

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
- Removing an item from the middle of an ordered Markdown list renumbers the following ones, and
  option numbers are referenced elsewhere — break the list with an HTML comment instead.
- Never `git add -A`: the tree often holds unrelated work in progress. Stage named files, or
  `git commit -m … -- <paths>`.

Adding a LiDAR render setting touches six files in a fixed order — the checklist lives in
`docs/STATE_AND_PERSISTENCE.md`.
