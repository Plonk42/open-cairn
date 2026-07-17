# Architecture Review & Improvement Plan

> 🧭 A step-by-step, actionable plan derived from the deep architectural review of open-cairn
> (2026-07). Work through it incrementally — each task has a stable ID, concrete steps,
> acceptance criteria, and a verification gate. Check items off as they land.

This document is a **living plan**, not a spec. Update statuses and notes as work progresses.

---

## Table of contents

- [How to use this document](#how-to-use-this-document)
- [Verification gates](#verification-gates)
- [Task index](#task-index)
- [Quick start: the five highest-value items](#quick-start-the-five-highest-value-items)
- [P0 — Correctness & safety](#p0--correctness--safety)
- [P1 — Maintainability & testability](#p1--maintainability--testability)
- [P2 — Architecture hardening](#p2--architecture-hardening)
- [P3 — Performance & polish](#p3--performance--polish)
- [UX — Newcomer onboarding](#ux--newcomer-onboarding)
- [Progress log](#progress-log)

---

## How to use this document

- Each task has an **ID** (e.g. `P0-1`), a **status**, a **scope** (S/M/L = size of change surface, not a time estimate), the **problem**, **evidence** (file references), **action steps** (checkboxes), and **acceptance criteria**.
- Prefer landing tasks in the priority order below, but any task is self-contained.
- After every task, run the [verification gates](#verification-gates) before marking it Done.
- Statuses: `☐ Not started` · `◐ In progress` · `☑ Done` · `⊘ Won't do`.

---

## Verification gates

The canonical gates for this repo (see repo memory — do **not** trust `npm run lint`, it checks nothing):

```bash
npx tsc -b            # real type-check (app + node projects)
npm run lint:test     # type-check the test project (tsconfig.test.json)
npm run test:run      # Vitest, all unit tests
npm run build         # production build (tsc -b && vite build)
```

A task is **Done** only when the gates relevant to it are green (a docs-only or CI-only task may not need all four).

---

## Task index

| ID | Priority | Scope | Title | Status |
|------|----------|-------|-------|--------|
| P0-1 | P0 | S | Fix CI type-check (currently a no-op) | ☐ |
| P0-2 | P0 | S | Add React error boundaries | ☐ |
| P1-1 | P1 | L | Consolidate the vegetation/cliff height engine | ☐ |
| P1-2 | P1 | M | Add store-slice + share round-trip tests | ☐ |
| P1-3 | P1 | M | Add one Playwright golden-path E2E in CI | ☐ |
| P1-4 | P1 | M | Reduce selector explosion in hot components | ☐ |
| P1-5 | P1 | M | Add ESLint flat config encoding house rules | ☐ |
| P2-1 | P2 | S | Centralize share-state restore | ☐ |
| P2-2 | P2 | M | Version + validate `PersistedSettings` | ☐ |
| P2-3 | P2 | M | Split god files (`LidarWebGLLayer`, `MapContainer`) | ☐ |
| P2-4 | P2 | S | Document + assert the flat-field mirroring invariants | ☐ |
| P3-1 | P3 | S | Manual vendor chunking in Vite | ☐ |
| P3-2 | P3 | M | Move `recomputeVegHeights` off the main thread | ☐ |
| UX-1 | UX | M | First-run coach-marks for the classic map view | ☐ |
| UX-2 | UX | M | "See an example" landing CTA | ☐ |
| UX-3 | UX | S | Make the LiDAR Studio discoverable from the main view | ☐ |
| UX-4 | UX | M | "Expert mode" disclosure for veg tuning knobs | ☐ |
| UX-5 | UX | S | Keyboard shortcuts + `?` cheat-sheet | ☐ |
| UX-6 | UX | S | Richer share dialog (preview + QR) | ☐ |
| UX-7 | UX | M | Accessibility pass on icon-only controls | ☐ |
| UX-8 | UX | L | i18n extraction (optional) | ☐ |

---

## Quick start: the five highest-value items

If bandwidth is limited, do these first, in order:

1. **P0-1** — Fix the CI type-check. Prevents type errors from merging.
2. **P0-2** — Add error boundaries. Prevents a single throw from white-screening the app.
3. **UX-1 + UX-2** — First-run coach-marks and a "See an example" CTA. Biggest lever for newcomers.
4. **P1-1** — Consolidate the veg-height engine. Tames the #1 maintainability liability.
5. **P1-2 + P1-3** — Store tests + one E2E in CI. Closes the largest testability gap.

---

## P0 — Correctness & safety

### P0-1 · Fix CI type-check (currently a no-op) · Scope S · Status ☐

**Problem.** CI's "Type check" step runs `npm run lint` = `tsc --noEmit` against the root `tsconfig.json`, which has `"files": []` and only project `references`. Plain `tsc --noEmit` (not `-b`) compiles **zero files**, so type errors can merge to `main`.

**Evidence.** `.github/workflows/ci.yml`, `tsconfig.json`, `package.json` (`lint` script).

**Action steps.**
- [ ] Change the CI "Type check" step to `npx tsc -b`.
- [ ] Add a step running `npm run lint:test`.
- [ ] (Optional) Add `npm run build` as a CI job to catch build-only breakages.
- [ ] Update `README.md` if it references `npm run lint` as the type-check gate.
- [ ] (Optional) Repoint the `lint` npm script to `tsc -b` to remove the footgun entirely.

**Acceptance.** CI fails on a deliberately introduced type error; passes on a clean tree.

---

### P0-2 · Add React error boundaries · Scope S · Status ☐

**Problem.** No `ErrorBoundary` exists anywhere. Any render-time throw in a WebGL layer or panel white-screens the entire client-only app, with no server-side hotfix path.

**Evidence.** No `componentDidCatch`/`getDerivedStateFromError` in `src/`.

**Action steps.**
- [ ] Create `src/components/ui/ErrorBoundary.tsx` with a reset/reload fallback UI.
- [ ] Wrap the view swap in `src/Root.tsx` (classic `<App/>` and the lazy `<LidarStudio/>`) so a Studio crash can't kill the map shell.
- [ ] Optionally wrap `LidarCloudOverlay` so a GL failure degrades to "cloud failed to render" instead of a blank app.
- [ ] Log caught errors to `console.error` (and leave a hook for future telemetry).

**Acceptance.** A thrown error in a child renders the fallback, not a blank page; "reset view" recovers.

---

## P1 — Maintainability & testability

### P1-1 · Consolidate the vegetation/cliff height engine · Scope L · Status ☐

**Problem.** `groundHeight.ts` is ~1432 lines with a ~1016-line test and 26 exports, and carries ~40 iterations of cliff-classification band-aids (many superseded per repo memory). The complexity has leaked into the store (38 `setLidarVeg*` setters), the persisted schema (~25 `lidarVeg*` fields), and the UI (~18 diagnostic controls).

**Evidence.** `src/lib/lidarBrowser/groundHeight.ts`, `src/stores/slices/lidarSlice.ts`, `src/stores/persistence.ts`, `src/components/ui/lidar/LidarAppearanceControls.tsx`.

**Action steps.**
- [ ] Introduce a `VegHeightConfig` options object (single source of truth for the tuning knobs) with documented defaults.
- [ ] Extract a self-contained `src/lib/lidarBrowser/vegHeight/` module (engine + config type + the `vegDiag` buffer format), decoupled from the store.
- [ ] Move experimental/diagnostic knobs behind the existing debug flag (`src/lib/debugFlags.ts`) so they don't inflate `PersistedSettings` or the default UI (feeds UX-4).
- [ ] Dead-code pass: delete code paths documented as SUPERSEDED in repo memory.
- [ ] Keep the existing unit tests green; add tests for the consolidated config surface.

**Acceptance.** Public behavior unchanged (tests green); knob count in `PersistedSettings` reduced; the engine module has no store import.

**Notes.** This is the largest task — split into sub-PRs (config object → module extraction → dead-code removal → knob gating).

---

### P1-2 · Add store-slice + share round-trip tests · Scope M · Status ☐

**Problem.** All 221 tests are lib-level; there are 0 tests for the Zustand slices or for the share-link round-trip *through the store*.

**Evidence.** `find src -name '*.test.tsx'` → 0; no test imports `@testing-library/react`.

**Action steps.**
- [ ] Add slice tests for `viewSlice`, `terrainSlice`, `settingsSlice`, `lidarSlice` (pure reducers, no DOM).
- [ ] Add a share round-trip test: `encodeShare(state) → applySharedState → assert store equality` (pairs with P2-1).
- [ ] Cover the mirroring invariants (`lidarShaded` ↔ `lidarClouds[0]`, flat map-style ↔ `mapStyleByView[view]`).

**Acceptance.** New tests run under `npm run test:run` and `npm run lint:test`; the invariants are asserted.

---

### P1-3 · Add one Playwright golden-path E2E in CI · Scope M · Status ☐

**Problem.** No automated end-to-end coverage, despite Playwright already being used ad-hoc for manual verification (per repo memory). Several documented regressions would have been caught by one E2E.

**Action steps.**
- [ ] Add Playwright as a dev dependency and a minimal config.
- [ ] Script the golden path: load map → search a place → open Studio → capture a small LiDAR zone (or load a showcase scene) → export.
- [ ] Run it in CI on a schedule or on PRs (headless, with a sensible timeout).
- [ ] Document how to run it locally in `README.md`.

**Acceptance.** The E2E passes in CI against a preview build; fails if the golden path breaks.

**Notes.** Keep it to *one* stable path first; expand later. Network-dependent IGN calls may need mocking or a resilient retry.

---

### P1-4 · Reduce selector explosion in hot components · Scope M · Status ☐

**Problem.** `LidarCloudOverlay.tsx` has ~50 individual `useMapStore((s) => …)` subscriptions; `LidarAppearanceControls.tsx` has ~79 store hooks. Each is a separate subscription and a re-render trigger.

**Evidence.** `src/components/map/LidarCloudOverlay.tsx`, `src/components/ui/lidar/LidarAppearanceControls.tsx`.

**Action steps.**
- [ ] Group related reads with Zustand's `useShallow` into cohesive objects (e.g. all veg knobs, all EDL settings).
- [ ] Verify effect dependency arrays still behave (grouped objects change identity only when a member changes).
- [ ] Spot-check render counts before/after (React DevTools or a temporary counter).

**Acceptance.** Subscription count materially reduced; no behavioral change; gates green.

---

### P1-5 · Add ESLint flat config encoding house rules · Scope M · Status ☐

**Problem.** No ESLint config exists; house rules (no multiple `Array#push`, cognitive-complexity ≤ 15, `globalThis` over `window`, `.at(-1)` over `[len-1]`) are enforced manually via the IDE + tribal knowledge, causing repeated churn.

**Evidence.** No `.eslintrc*` / `eslint.config.*`.

**Action steps.**
- [ ] Add `eslint` + `typescript-eslint` + relevant plugins (sonarjs, unicorn) as dev deps.
- [ ] Create `eslint.config.js` (flat config) encoding the known rules.
- [ ] Add a `lint:code` npm script and wire it into CI.
- [ ] Fix or scope-disable existing violations incrementally (don't block on a full clean sweep).

**Acceptance.** `npm run lint:code` runs in CI; the documented rules are enforced automatically.

---

## P2 — Architecture hardening

### P2-1 · Centralize share-state restore · Scope S · Status ☐

**Problem.** `main.tsx` manually calls ~20 store setters to rehydrate a shared link, duplicating the schema in `shareView.ts`. Adding a shared field means editing three places.

**Evidence.** `src/main.tsx`, `src/lib/shareView.ts`.

**Action steps.**
- [ ] Add `applySharedState(store, shared)` co-located with the decoder in `shareView.ts`.
- [ ] Replace the imperative block in `main.tsx` with a single call.
- [ ] Unit-test it (pairs with P1-2).

**Acceptance.** Adding a shared field touches one file; round-trip test green.

---

### P2-2 · Version + validate `PersistedSettings` · Scope M · Status ☐

**Problem.** `PersistedSettings` is a ~90-field flat, unvalidated bag parsed via raw `JSON.parse`, with no version stamp. Fine while unreleased; risky as release approaches.

**Evidence.** `src/stores/persistence.ts`.

**Action steps.**
- [ ] Add a `version` field and a small migration switch (or adopt a schema validator).
- [ ] Group the experimental `lidarVeg*` knobs under a nested key (e.g. `vegDebug?: {…}`) so a reset is one key (pairs with P1-1/UX-4).
- [ ] Guard against malformed payloads (validate → fall back to defaults).

**Acceptance.** Old payloads load or migrate cleanly; malformed payloads don't crash; version stamped.

---

### P2-3 · Split god files · Scope M · Status ☐

**Problem.** `LidarWebGLLayer.ts` (~2085 lines), `MapContainer.tsx` (~1110 lines, 15 effects / 22 subscriptions), `lidarSlice.ts` (~966 lines).

**Evidence.** File line counts above.

**Action steps.**
- [ ] `LidarWebGLLayer`: extract pure helpers (LOD selection, stride, frustum out-codes, bbox) into standalone tested modules; finish what's already partially done.
- [ ] `MapContainer`: extract terrain-sync and style-rebuild effects into custom hooks (`useTerrainSync`, `useMapStyleRebuild`).
- [ ] `lidarSlice`: shrinks naturally once P1-1 lands; extract veg plumbing.

**Acceptance.** Each extracted helper is independently unit-tested; behavior unchanged; gates green.

---

### P2-4 · Document + assert the flat-field mirroring invariants · Scope S · Status ☐

**Problem.** `lidarShaded`/`lidarMesh` mirror `lidarClouds[0]`, and the flat map-style fields mirror `mapStyleByView[appView]`. Clever, but the source of several documented bugs.

**Evidence.** `src/stores/slices/lidarSlice.ts`, `src/stores/mapStyleView.ts`, `src/stores/slices/viewSlice.ts`.

**Action steps.**
- [ ] Write a short invariant doc comment at each mirror site.
- [ ] Add dev-only assertions (or a store test) that the mirror holds after each relevant setter.

**Acceptance.** Invariants documented; a test fails if a future change breaks the mirror.

---

## P3 — Performance & polish

### P3-1 · Manual vendor chunking in Vite · Scope S · Status ☐

**Problem.** No `manualChunks` — vendor caching on deploys is coarser than it could be.

**Evidence.** `vite.config.ts` (no `build.rollupOptions`).

**Action steps.**
- [ ] Add `build.rollupOptions.output.manualChunks` splitting `maplibre-gl`, deck.gl, `chart.js`.
- [ ] Verify chunk sizes with `npm run build` and confirm no regression in lazy boundaries.

**Acceptance.** Stable vendor chunks; total transferred bytes on repeat visits improve.

---

### P3-2 · Move `recomputeVegHeights` off the main thread · Scope M · Status ☐

**Problem.** The debounced (150 ms) main-thread veg-height recompute can freeze the UI on multi-million-point clouds.

**Evidence.** `src/stores/slices/lidarSlice.ts` (`recomputeVegHeights`), `src/components/map/LidarCloudOverlay.tsx`.

**Action steps.**
- [ ] Move the recompute into the existing worker boundary (`src/lib/lidarBrowser/`), returning updated buffers.
- [ ] Keep the debounced trigger; show a subtle "recomputing…" affordance.
- [ ] Best sequenced after P1-1 (the engine is already isolated by then).

**Acceptance.** No main-thread jank during recompute on a large cloud; results identical to the sync path.

---

## UX — Newcomer onboarding

### UX-1 · First-run coach-marks for the classic map view · Scope M · Status ☐

**Problem.** The Studio has a 7-step tutorial, but the main view — where everyone lands — has none.

**Evidence.** `src/components/lidar/tutorial/`, `src/App.tsx`.

**Action steps.**
- [ ] Reuse the Studio tutorial's spotlight component for the classic view.
- [ ] Highlight: search, layer switcher, the Studio CTA, the route tool.
- [ ] Persist a one-time "seen" flag (mirror `studioTutorialSeen`); allow re-open via a `?` button.

**Acceptance.** First visit shows dismissible coach-marks; they don't reappear after completion; re-openable.

---

### UX-2 · "See an example" landing CTA · Scope M · Status ☐

**Problem.** A first-time visitor sees a plain map, not the feature that makes the app special.

**Action steps.**
- [ ] Add a "Voir un exemple" button in the main view that flies to a curated summit and loads a showcase scene.
- [ ] Reuse existing showcase infrastructure (`public/showcase/`, `ShowcaseGallery`).

**Acceptance.** One click produces an instant, framed LiDAR "wow" moment from the main view.

---

### UX-3 · Make the LiDAR Studio discoverable from the main view · Scope S · Status ☐

**Problem.** `?view=lidar` is the headline feature but reachable only via one panel CTA.

**Action steps.**
- [ ] Add a labeled top-bar entry ("Studio LiDAR — explorer un relief en 3D") with a one-line explainer.

**Acceptance.** The Studio is reachable and self-explained from the main chrome.

---

### UX-4 · "Expert mode" disclosure for veg tuning knobs · Scope M · Status ☐

**Problem.** ~38 vegetation sliders overwhelm newcomers (and experts).

**Evidence.** `src/components/ui/lidar/LidarAppearanceControls.tsx`.

**Action steps.**
- [ ] Collapse advanced knobs under a single "Réglages avancés (expert)" disclosure.
- [ ] Keep only auto-height + shader in the default view.
- [ ] Coordinate with P1-1/P2-2 (knobs behind the debug flag / nested persisted key).

**Acceptance.** Default UI shows a handful of controls; experts opt in to the rest.

---

### UX-5 · Keyboard shortcuts + `?` cheat-sheet · Scope S · Status ☐

**Action steps.**
- [ ] Add shortcuts for orbit, capture, reset-view, toggle panels.
- [ ] Add a `?`-triggered overlay listing them.

**Acceptance.** Shortcuts work; the cheat-sheet lists them.

---

### UX-6 · Richer share dialog (preview + QR) · Scope S · Status ☐

**Problem.** Share is copy-to-clipboard + tooltip only; the "URL encodes the whole view" feature is invisible.

**Evidence.** `src/lib/useShare.ts`.

**Action steps.**
- [ ] Add a small share dialog with a preview thumbnail and a QR code.

**Acceptance.** Sharing surfaces a preview + copyable link + QR.

---

### UX-7 · Accessibility pass on icon-only controls · Scope M · Status ☐

**Problem.** Many controls are icon-only `<button title=…>` without robust `aria-label`s / focus states.

**Action steps.**
- [ ] Audit icon-only buttons; add `aria-label`s.
- [ ] Ensure visible focus rings and keyboard operability for segmented controls and sliders.

**Acceptance.** Keyboard-only navigation reaches all primary controls; screen-reader labels present.

---

### UX-8 · i18n extraction (optional) · Scope L · Status ☐

**Problem.** All strings are hardcoded French. Fine if the audience is strictly France; a blocker for broader reach.

**Action steps.**
- [ ] Decide whether broader reach is a goal (if not, mark `⊘ Won't do`).
- [ ] If yes, extract strings to a message catalog while the count is still manageable.

**Acceptance.** Strings resolve through an i18n layer; adding a locale is config-only.

---

## Progress log

Record notable landings here (date · task · one-line summary · commit/PR).

- _(none yet)_
