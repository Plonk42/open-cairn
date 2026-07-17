# Plan: Unify Itinéraire + LiDAR Studio into one app

Make the two shells (`?view=map` Itinéraire home + `?view=lidar` Studio LiDAR) feel like one app by (a) sharing the search+app-name box and a view-switch across both, and (b) reworking the Itinéraire view to adopt Studio's floating-overlay + bottom-bar-of-pills organization. Maximize component reuse; keep bars theme-aware; keep route editing in a resizable bottom panel; present saved routes like the LiDAR gallery.

## Phase 1 — Shared chrome + view switch *(makes it "one app" immediately)*
Strategy: **shared components, composed per view** (not mounted once at Root). Extracting to shared components gives identical visuals + a single source of truth without the cross-boundary absolute-positioning coupling that Root-mounting would create (each view's top bar flanks the header box with different buttons — Studio: Orbite/Export/Galerie/help; Itinéraire: Itinéraires). The header box is cheap DOM, so remounting it on a view switch is negligible (the persistent-at-Root pattern exists only for the expensive-to-rebuild `MapContainer`). If preserving in-progress search text across a switch ever matters, lift the query to the store/URL — out of scope for now.

1. Extract the top-left box (app logo + name + Share button + `SearchBox` + `CursorCoordinates`) out of App.tsx into a new theme-aware **shared** `AppHeaderBox` component.
2. New shared `ViewSwitch` segmented control ("Itinéraire | Studio LiDAR") calling `useView().setView('map'|'lidar')`. This replaces Studio's "Quitter le studio" button *and* gives the map view a first-class entry into Studio.
3. Each view composes its own top bar from these shared components as normal flex siblings alongside its own action buttons:
   - LidarStudio: drop its "Studio LiDAR" label + "Quitter" button; compose `AppHeaderBox` + action group (Orbite / Export / Galerie / help) + `ViewSwitch`.
   - App.tsx (Itinéraire): drop its inline top-left box; compose `AppHeaderBox` + the new "Itinéraires" gallery button + `ViewSwitch`.

## Phase 2 — Generic theme-aware bottom bar *(depends on P1)*
4. Extract Studio's `BottomBarItem` pill+popover into a reusable, theme-aware `BottomBar` + `BottomBarPill` (light default + `dark:` variants). Studio keeps a `dark` wrapper (unchanged look); Itinéraire omits it → follows `uiTheme`. Same dual pattern the gallery already uses. `StudioBottomBar` re-consumes the generic version.

## Phase 3 — Itinéraire adopts the Studio layout *(depends on P2)*
5. Replace App.tsx's right sidebar (RIGHT_TABS) with a bottom pill bar built on the generic `BottomBar`: **Couches** → `LayerSwitcher` popover, **Réglages** → `SettingsPanel` popover.
6. Convert the current bottom-panel mode toggle into two more bottom-bar pills — **Itinéraire** and **Coupe falaise** — that open the existing resizable editing panel (`RoutePanel` / `CliffBottomPanel`) above the bar, restyled to match.
7. Drop the Itinéraire "Rendu 3D LiDAR" tab (`LidarCloudPanel` "Ouvrir le studio" CTA is now redundant with the switch). Remove `RIGHT_TABS`/`RightTabContent`.

## Phase 4 — Saved-routes gallery *(parallel with P3)*
8. New `SavedRoutesGallery` modal mirroring `ShowcaseGallery` (portal, tiles), reusing `SavedRoutesPanel`'s `PreviewThumb` for tiles and `savedRoutes.ts` (`useSavedRoutes`, load via routeStore `importRoute`, rename/delete). Trigger from a top-bar **Itinéraires** button (like Studio's "Galerie"). Retire the sidebar `SavedPanel`.

## Phase 5 — Mobile *(depends on P1–P4)*
9. Rework `MobileLayout` to the unified shell: shared header box + a compact `ViewSwitch`, tools in the existing bottom sheet, and Studio reachable on mobile (net-new — Studio was desktop-only). Adapt Studio's desktop-only bars to a mobile sheet/tab presentation.

## Relevant files
- `src/App.tsx` — remove inline top-left box; compose `AppHeaderBox` + `ViewSwitch` + "Itinéraires" button into its top bar; remove right sidebar (`RIGHT_TABS`, `SidebarTabButton`); wire the new bottom pill bar; keep the resizable bottom panel + `BottomPanelContent`.
- `src/components/lidar/LidarStudio.tsx` — remove label + Quitter from `StudioTopBar`; compose `AppHeaderBox` + `ViewSwitch`; keep Orbite/Export/Galerie/help.
- `src/Root.tsx` — unchanged for chrome (keeps only the persistent `MapContainer` + view swap).
- `src/components/lidar/StudioRenderSettings.tsx` — extract/theme-aware `BottomBarItem` → generic `BottomBar`; adapt `QuickBasemapSwitch`, `ResetSettingsButton`.
- `src/components/lidar/StudioBottomBar.tsx` — consume generic bar.
- `src/components/panels/PanelTabs.tsx` — drop `RightTab*`; keep `BottomPanelContent`.
- New shared components: `src/components/shell/AppHeaderBox.tsx`, `ViewSwitch.tsx`, `BottomBar.tsx`, `RouteBottomBar.tsx`; `src/components/ui/SavedRoutesGallery.tsx`.
- `src/components/ui/SavedRoutesPanel.tsx` — export `PreviewThumb` for reuse.
- `src/components/MobileLayout.tsx` — unified mobile shell (Phase 5).

## Verification
1. Gates after each phase: `npx tsc -b`, `npm run lint:test`, `npm run test:run` (221 tests), `npm run build` (never trust `npm run lint`).
2. Live (Playwright on the shared browser page): switch Itinéraire↔Studio via the new switch with no full map reload (persistent `MapContainer` preserved even though each view re-composes its own top bar); shared `AppHeaderBox` looks/behaves identically in both; Couches/Réglages popovers open; route + cliff bottom panel open/resize; saved-routes modal lists tiles, loads a route; toggle light/dark → Itinéraire bars follow theme, Studio stays dark.
3. Mobile viewport: header + switch + bottom sheet tools usable; Studio reachable.

## Decisions
- Shared chrome via shared COMPONENTS composed per-view (not mounted once at Root) — identical visuals + single source of truth, without cross-boundary layout coupling.
- Reuse-first: one generic `BottomBar` powers both views; `PreviewThumb` reused for route tiles; `LayerSwitcher`/`SettingsPanel`/`RoutePanel`/`CliffBottomPanel` reused unchanged.
- Theme-aware bars via light-default + `dark:` variants; Studio keeps `dark` wrapper.
- Excluded: LiDAR render controls in Itinéraire (stay Studio-only, per prior decision); route editing stays a bottom panel (not a popover).

## Further considerations
1. Studio action buttons (Orbite/Export/Galerie/help) — keep them grouped in the top bar beside the shared box, or move Export/Galerie into the bottom bar for symmetry with Itinéraire's "Itinéraires" button? Recommend: **keep in top bar** (least churn), mirror by putting Itinéraire's "Itinéraires" button in the top bar too.
2. Mobile Studio (Phase 5) is genuinely net-new and the largest chunk. Recommend landing P1–P4 (desktop) first as a verifiable milestone, then P5. Option A: this order / Option B: insist all phases before any merge.
