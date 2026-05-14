# Analyse et proposition technique — Carte web 3D avec blending hillshade LiDAR

> Cible : nouvelle application web indépendante affichant la couche IGN
> SCAN 25, un terrain 3D à partir du MNT IGN, et un ombrage LiDAR
> `IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` **mêlé en mode
> multiply (ou autre opération de composition) avec la couche de base** —
> et non simplement appliqué en transparence.
> Évolutions prévues : tracé d'itinéraire avec profil altimétrique, calcul
> d'itinéraire entre 2 points, déploiement GitHub Pages.

---

## 1. Analyse des trois produits existants

### 1.1 cartes-ign-app (https://github.com/IGNF/cartes-ign-app)

| Élément | Détail |
|---|---|
| Type | Application mobile hybride (Capacitor 7 → Android / iOS) + PWA |
| Carto core | **MapLibre GL JS 5.11** |
| Build | Webpack 5, Babel, SCSS |
| Plugins clés | `@maplibre/maplibre-gl-compare`, `@maplibre/maplibre-gl-directions`, `@mapbox/mapbox-gl-sync-move`, `pmtiles`, `chart.js` (profil), `proj4`, `idb` (cache offline), Turf.js |
| Données IGN | `data.geopf.fr` : WMTS (raster), TMS (vector tiles `PLAN.IGN`), WMS-r privé (raster-dem `terrainrgb0`) |
| 3D | `map.setTerrain({ source: "terrain", exaggeration: 1.0 })` — `raster-dem` PNG TerrainRGB sur `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.LINEAR` |
| Hillshade | Layer MapLibre natif `type: "hillshade"` calculé client-side sur le DEM |
| Bati 3D | `fill-extrusion` sur tuiles vectorielles `PLAN.IGN` (config externalisée `bati-3d.json`) |
| Itinéraire | `@maplibre/maplibre-gl-directions` + Geoplateforme |
| Profil alti | `chart.js` + service Calcul altimétrique IGN (cf. [src/js/elevation-line-control](src/js/elevation-line-control)) |
| Licence | GPL-3.0 |

**Capacités** : navigation 2D + bascule 3D fluide, comparateur swipe, dessin d'itinéraires, calcul d'itinéraire, isochrones, suivi GPS, hors-ligne, signalements OSM, gestionnaire de couches riche.

**Limites pour notre cas** :
- Le hillshade actuel (`type: "hillshade"`) est calculé à la volée à partir du DEM IGN — résolution moyenne, pas le LiDAR HD.
- L'intégration d'une **couche raster `SHADOW` LiDAR HD pré-calculée** est possible (raster WMTS) mais **MapLibre n'expose aucun mode de composition multiply / overlay** entre layers : seules `raster-opacity`, `raster-brightness/contrast/saturation/hue` existent. Issue ouverte depuis 2020 : [maplibre/maplibre-gl-js#48](https://github.com/maplibre/maplibre-gl-js/issues/48). Aucune ETA.
- Le code est lourdement orienté Capacitor / mobile (StatusBar, BackgroundGeolocation, etc.) → trop de dépendances pour un simple front web.
- La couche `hillshade` IGN est positionnée *au-dessus* des tuiles vectorielles PLAN.IGN — c'est un alpha-blend, pas un multiply ; le rendu est plat dès qu'on assombrit le shadow.

### 1.2 cartes.gouv.fr — « Explorer les cartes » (https://github.com/IGNF/cartes.gouv.fr-entree-carto)

| Élément | Détail |
|---|---|
| Type | Application web SPA |
| Carto core | **OpenLayers** (via `geopf-extensions-openlayers` 1.0.0-beta — fork local fourni dans le repo) |
| Framework | **Vue 3 + Vite** (Vue 49 %, JS 35 %, TS 11 %) |
| UI | DSFR (vue-dsfr-project) |
| Tests | Playwright + Vitest |
| Licence | AGPL-3.0 |
| Déploiement | GitHub Pages (https://ignf.github.io/cartes.gouv.fr-entree-carto/) |

**Capacités** : sélecteur multi-couches sophistiqué, permaliens, comparateur, calcul d'itinéraires, isochrones, géocodage, dessin, partage. Couches LiDAR `SHADOW` accessibles **mais empilées en alpha**.

**Limites** :
- **Pas de 3D**. OpenLayers n'a pas de support natif terrain ; il faudrait coupler à `ol-cesium` (lourd) ou iTowns.
- Pas de blending multiply — OpenLayers expose pourtant `globalCompositeOperation` (cf. ci-dessous), mais il n'est pas exploité dans cette appli.
- Le portail principal `cartes.gouv.fr` (back-office Symfony + React) ne pilote pas la carte ; c'est ce repo `entree-carto` qui correspond.

### 1.3 geoportail.gouv.fr (Géoportail historique)

| Élément | Détail |
|---|---|
| Carto core | **iTowns** (3D natif, basé Three.js) en mode 3D + OpenLayers en 2D |
| Extensions | `geoportal-extensions` (archivé janvier 2026, remplacé par `geopf-extensions-openlayers`) |
| 3D | iTowns charge un terrain WMTS (TMS PM) + textures aériennes ou cartes |

**Capacités** : 3D plein écran, basculement de couches, profil altimétrique, calcul d'itinéraires, mesures, recherche, vues immersives.

**Limites** :
- Ressenti utilisateur : plus lent que cartes-ign-app (constat dans le brief).
- Stack vieillissante (extensions archivées).
- Pas de blending multiply.
- Pas d'API publique simple pour réutiliser tel quel : iTowns demande une intégration spécifique, le code Géoportail n'est pas open-source.

### 1.4 open-dronelog (https://github.com/arpanghosh8453/open-dronelog) — *référence transverse*

| Élément | Détail |
|---|---|
| Type | App desktop Tauri v2 + variante Docker web (analyse de logs DJI/Litchi) |
| Carto core | **`react-map-gl` + MapLibre GL JS** + **deck.gl** (overlay via `@deck.gl/mapbox` `MapboxOverlay`, `interleaved: false`) |
| Framework | React 18 + TypeScript + Vite + Tailwind + Zustand |
| 3D | `map.setTerrain({ source: 'terrain-dem', exaggeration: 1.4 })` — DEM raster initialement `demotiles.maplibre.org`, fork local utilise **Mapterhorn** (Terrarium webp, zoom 14, tile 512) |
| Hillshade | Layer MapLibre natif `type: "hillshade"` (`hillshade-shadow-color: #473B24`) — **pas de multiply**, juste l'ombrage standard |
| Tracé 3D | `PathLayer` deck.gl en 2D ; **fork local** ajoute un `FlightPath3DLayer` — Custom Layer MapLibre `renderingMode: '3d'` avec shaders GLSL (vertex quad screen-space + couleur par sommet) qui partage le z-buffer du terrain pour gérer l'occlusion |
| Licence | AGPL-3.0 |

**Pertinence pour le projet** :
- C'est un cas réel **react-map-gl + MapLibre + deck.gl + setTerrain** combinés, pile très proche de la cible recommandée plus bas.
- Le `FlightPath3DLayer` du fork local est exactement le pattern *Custom Layer WebGL `renderingMode: '3d'`* préconisé en §3.1 / §4.3 — il valide :
  - la création d'un programme WebGL, gestion VBO/IBO, matrice MVP fournie par MapLibre ;
  - `gl.enable(DEPTH_TEST)` + `depthFunc(LEQUAL)` pour l'occlusion par le terrain ;
  - `MercatorCoordinate.fromLngLat([lng, lat], alt)` pour positionner en altitude réelle ;
  - `triggerRepaint()` après mise à jour des données ;
  - blending premultiplié (`gl.blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`).
  → exactement la mécanique à reprendre en remplaçant `blendFunc` par `(DST_COLOR, ONE_MINUS_SRC_ALPHA)` pour obtenir un *multiply*.
- **Pas** d'exemple de blending multiply hillshade : la confusion initiale est levée.

**Limites pour notre cas** :
- Pas d'utilisation des services IGN (Esri / OSM / OpenTopoMap / Mapterhorn).
- Pas de calcul d'itinéraire ni de profil alti.
- Le hillshade est natif (sans composition multiply).

### 1.5 Synthèse comparative

| Critère | cartes-ign-app | cartes.gouv.fr-entree-carto | geoportail.gouv.fr | open-dronelog (fork local) |
|---|---|---|---|---|
| Lib carto | MapLibre GL JS 5 | OpenLayers + ext. GPF | iTowns + OL | MapLibre + react-map-gl + deck.gl |
| Framework | Vanilla JS (Capacitor) | Vue 3 + Vite | Custom | React 18 + Vite + TS |
| 3D terrain | ✅ natif (`setTerrain`) | ❌ | ✅ (iTowns) | ✅ (Mapterhorn DEM) |
| Bâtiments 3D | ✅ `fill-extrusion` | ❌ | ✅ | ❌ |
| Hillshade LiDAR pré-calculé | partiel | ✅ (alpha) | ✅ (alpha) | ❌ (hillshade natif standard) |
| **Blending multiply** | ❌ | ❌ | ❌ | ❌ |
| Custom Layer 3D WebGL démontré | ❌ | ❌ | ❌ | ✅ (`FlightPath3DLayer`) |
| Itinéraire / isochrone | ✅ | ✅ | ✅ | ❌ |
| Profil altimétrique | ✅ | ✅ | ✅ | ❌ |
| Licence | GPL-3 | AGPL-3 | propriétaire | AGPL-3 |
| Déploiement statique GitHub Pages | partiel (PWA) | ✅ | ❌ | n/a (Tauri/Docker) |

**Aucun des quatre ne propose de composition multiply** entre la couche de base et l'ombrage : c'est la fonctionnalité différenciante à construire. En revanche, le fork local d'open-dronelog fournit un **patron Custom Layer MapLibre `renderingMode: '3d'` complet et fonctionnel** — directement transposable pour porter le blending multiply (cf. §4.3).

---

## 2. Ressources IGN disponibles (Géoplateforme — `data.geopf.fr`)

Tous les services publics sont gratuits et anonymes (sans clé) sur les couches « Découverte » ; quelques produits raster haute résolution (`HIGHRES.LINEAR` terrain RGB) requièrent une clé `GPF_key` via `https://data.geopf.fr/private/wms-r/wms`.

### 2.1 Endpoints

| Service | URL | Format | Usage |
|---|---|---|---|
| WMTS | `https://data.geopf.fr/wmts` | PNG/JPEG | Tuiles raster pré-calculées (recommandé pour le perf) |
| TMS (vector) | `https://data.geopf.fr/tms/1.0.0/{layer}/{z}/{x}/{y}.pbf` | MVT | Tuiles vectorielles (`PLAN.IGN`, `BDTOPO`...) |
| WMS-r | `https://data.geopf.fr/wms-r/wms` | PNG | Raster « à la volée » (utile pour TerrainRGB) |
| WMS-v | `https://data.geopf.fr/wms-v/wms` | PNG | Vecteur stylisé serveur |
| WFS | `https://data.geopf.fr/wfs/ows` | GeoJSON | Vecteur brut |
| Géocodage | `https://data.geopf.fr/geocodage/search` | JSON | Recherche d'adresses / POI |
| Autocomplétion | `https://data.geopf.fr/geocodage/completion` | JSON | Suggestions saisie |
| Calcul d'itinéraire | `https://data.geopf.fr/navigation/itineraire` | GeoJSON | Valhalla (voiture, piéton) |
| Isochrone | `https://data.geopf.fr/navigation/isochrone` | GeoJSON | Aire desservie |
| Calcul altimétrique | `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json` | JSON | Profil 3D le long d'une ligne |

### 2.2 Couches utiles pour le projet

| Identifiant WMTS | Description | Format | Zoom natif |
|---|---|---|---|
| `GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR` | **SCAN 25 Tour** (carte topographique IGN 1:25 000) | JPEG | 6 → 16 |
| `GEOGRAPHICALGRIDSYSTEMS.MAPS` | SCAN classique multi-échelles | JPEG | 0 → 18 |
| `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` | Plan IGN (version vectorielle disponible aussi en TMS) | PNG | 0 → 19 |
| `ORTHOIMAGERY.ORTHOPHOTOS` | Orthophotos couleur | JPEG | 0 → 20 |
| `IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` | **Ombrage LiDAR HD du MNS** (canopée + bâti) | PNG | jusqu'à 17–18 sur zones couvertes |
| `IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` | Ombrage LiDAR HD du MNT (sol nu) | PNG | idem |
| `IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` | Ombrage MNH (hauteur) | PNG | idem |
| `IGNF_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` | Ombrage ancien MNT 25 m (couverture nationale) | PNG | 0 → 17 |
| `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES` (WMS-r `terrainrgb0`) | DEM encodé Mapbox TerrainRGB pour `raster-dem` | PNG 256 | 6 → 14 (clé requise) |
| `GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN` | Carte des pentes (>30°/35°/40°/45°) | PNG | 0 → 17 |

**Important** :
- Les couches `SHADOW` sont des **images grises pré-calculées** (pas du DEM). Elles s'utilisent comme un raster classique (`type: "raster"`) et peuvent donc être composées avec n'importe quel mode de blending.
- Pour le terrain MapLibre 3D, il faut un raster-dem encodé (TerrainRGB / Terrarium). IGN expose `terrainrgb0` via WMS-r privé.
- La couverture LiDAR HD n'est pas encore nationale (~80 % France métropolitaine fin 2025) ; prévoir un *fallback* sur l'ombrage classique.

### 2.3 Bibliothèques officielles

- `geopf-extensions-openlayers` — widgets (LayerSwitcher, Search, Route, Iso, Elevation) pour OpenLayers ; package npm publié.
- `geopf-extensions-leaflet` — équivalent Leaflet (pas de 3D).
- iTowns — moteur 3D développé par IGN/CNES, basé Three.js, supporte WMTS, MNT, vector tiles, dalles 3D.
- `ign-gpf-mapbox-style` — styles JSON MapLibre pour PLAN.IGN vector tiles.

### 2.4 Quotas

Cf. [limites d'usage](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/) :
- Découverte (anonyme) : 50 req/s par IP, 5 millions de tuiles/jour.
- Pas de tracking d'origine ; OK pour un site statique GitHub Pages.

---

## 3. Le problème du blending dans les bibliothèques carto WebGL

| Lib | Support blending layer/layer | Mécanisme | 3D terrain |
|---|---|---|---|
| **MapLibre GL JS** | ❌ alpha uniquement | Issue #48 ouverte 2020 (pas de roadmap) | ✅ `setTerrain` |
| **Mapbox GL JS** | ❌ idem (PR #13583 ouverte 2025) | — | ✅ |
| **OpenLayers** | ⚠️ partiel : `globalCompositeOperation` au niveau Layer (Canvas2D) — mais cassé sur les layers WebGLTile | `layer.on('prerender', evt => evt.context.globalCompositeOperation = 'multiply')` | ❌ (sans `ol-cesium`) |
| **Cesium** | ✅ via shaders custom + `Material` | WebGL custom | ✅ natif (terrain + 3D Tiles) |
| **iTowns** | ⚠️ via shaders Three.js | personnalisable (THREE.Material) | ✅ natif |
| **deck.gl / luma.gl** | ✅ via `parameters: { blendFunc: ... }` | WebGL2 explicite | partiel (TerrainLayer) |

### 3.1 Solutions de contournement existantes pour MapLibre

1. **Multi-canvas + CSS `mix-blend-mode: multiply`** — preuve de concept par wipfli :
   https://github.com/wipfli/hillshade-multiply-blending — deux instances MapLibre superposées, blending fait par le navigateur. Marche en 2D ; **incompatible avec le terrain 3D** car les deux cartes ne partagent pas la profondeur.
2. **Custom Layer MapLibre** (`map.addLayer({ type: 'custom', render(gl, matrix) {...} })`) — on récupère le `WebGLRenderingContext` actif, on règle `gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA)` (= multiply) avant de dessiner notre raster d'ombrage avec un shader minimaliste. Compatible 3D : la couche custom est rendue dans la même scène, suit le terrain.
3. **Pré-composition serveur** : utiliser un endpoint WMS-r « combined » qui sert SCAN 25 déjà multiplié par le shadow LiDAR. Demande un proxy. Pas idéal (pas de bascule dynamique du réglage).
4. **Forcer `gl-blend-mode` via `wipfli/hillshade-multiply-blending`-style multi-cartes** sans 3D, et accepter de basculer en 2D quand l'ombrage est activé. Compromis acceptable.

### 3.2 OpenLayers — `globalCompositeOperation`

Sur un `TileLayer` Canvas (non-WebGL), il suffit de :
```js
const shadow = new TileLayer({ source: new WMTS({...}) });
shadow.on('prerender', e => { e.context.globalCompositeOperation = 'multiply'; });
shadow.on('postrender', e => { e.context.globalCompositeOperation = 'source-over'; });
```
→ rendu multiply parfait, mais **pas de 3D terrain** sans `ol-cesium`.

---

## 4. Solution technique recommandée

### 4.1 Pile cible

| Couche | Choix | Justification |
|---|---|---|
| Build / dev | **Vite 6** + **TypeScript 5** | HMR instantané, tree-shaking optimal, build statique pour GitHub Pages |
| Carto | **MapLibre GL JS 5.11+** | 3D terrain natif, Custom Layer WebGL, écosystème (directions, draw, compare, pmtiles), licence BSD-3 |
| Blending | **Custom Layer MapLibre** + shader GLSL | Composition multiply / screen / overlay dans la même passe WebGL, compatible 3D |
| 3D | `setTerrain({ source: "terrain", exaggeration: 1.0 })` sur DEM TerrainRGB IGN (`terrainrgb0`) | Identique à cartes-ign-app, éprouvé |
| UI framework | **React 18** + **Tailwind CSS 4** | Composants interactifs, styling utilitaire rapide, écosystème le plus large |
| State | **Zustand** | Store léger, pas de boilerplate Redux, pattern déjà validé (open-dronelog) |
| Charts (profil) | **ECharts** (ou **uPlot** si poids critique) | Gradient par segment, interaction brushLink, crosshair synchronisé nativement |
| Itinéraire | `@maplibre/maplibre-gl-directions` → API Geoplateforme `navigation/itineraire` | Valhalla (voiture, piéton, vélo) |
| Géocodage | API Geoplateforme `geocodage/search` + composant React custom | Pas de dépendance lourde |
| Dessin | `@mapbox/mapbox-gl-draw` (compatible MapLibre) | Tracé d'itinéraire libre |
| Profil alti | API Geoplateforme `altimetrie/.../elevationLine.json` | Profil 3D le long d'une ligne, côté serveur |
| Animations | **Framer Motion** (ou CSS transitions simples pour les panneaux) | Transitions fluides overlays / menus |
| Déploiement | **GitHub Pages** via GitHub Actions (`vite build` → `gh-pages` branch) | Demande remplie |

### 4.2 Architecture modulaire

```
src/
├── main.tsx                         # Point d'entrée, providers
├── App.tsx                          # Layout racine (carte + overlays)
│
├── stores/                          # État global (Zustand)
│   ├── mapStore.ts                  # viewState, pitch, bearing, layers actifs
│   ├── routeStore.ts                # tracé courant, waypoints, profil alti
│   └── uiStore.ts                   # panneaux ouverts, mode, préférences
│
├── components/
│   ├── map/
│   │   ├── MapContainer.tsx         # <Map> react-map-gl/maplibre, sync store
│   │   ├── TerrainControl.tsx       # activation 3D / exaggeration
│   │   ├── MultiplyBlendLayer.tsx   # Custom Layer (§4.3) — encapsulé React
│   │   ├── RouteLayer.tsx           # GeoJSON du tracé + marqueurs
│   │   └── MapOverlays.tsx          # Marker courant, crosshair hover
│   │
│   ├── ui/
│   │   ├── Sidebar.tsx              # Panneau latéral (slide-over, responsive)
│   │   ├── LayerSwitcher.tsx        # Sélecteur couches base / overlay
│   │   ├── SearchBar.tsx            # Géocodage + autocomplétion
│   │   ├── SettingsPanel.tsx        # Intensité blend, exaggeration, thème
│   │   └── ActionSheet.tsx          # Menu contextuel mobile (bottom sheet)
│   │
│   ├── elevation/
│   │   ├── ElevationChart.tsx       # Graphe profil alti (ECharts)
│   │   ├── ElevationSync.ts        # Logique hover ↔ carte bidirectionnel
│   │   └── useElevationProfile.ts   # Hook : appel API + cache résultat
│   │
│   └── routing/
│       ├── DirectionsPanel.tsx      # Formulaire départ / arrivée
│       └── RouteResults.tsx         # Résumé (temps, distance, D+)
│
├── layers/
│   ├── MultiplyRasterLayer.ts       # CustomLayerInterface WebGL (multiply)
│   ├── shaders/
│   │   ├── multiply.vert.glsl       # Vertex shader (tuile quad)
│   │   └── multiply.frag.glsl       # Fragment shader (sample + blend)
│   └── tileManager.ts               # Gestion cache tuiles visibles → textures
│
├── lib/
│   ├── ign.ts                       # URLs / helpers Geoplateforme
│   ├── mapStyles.ts                 # Styles MapLibre (SCAN 25, PlanIGN, Ortho)
│   └── utils.ts                     # Formatage, coordonnées, couleurs
│
└── types/
    └── index.ts                     # Types partagés (Route, ElevationPoint…)
```

**Principes directeurs :**
- **Séparation stricte** : logique WebGL (`layers/`) isolée des composants React ; communication via le store Zustand.
- **Composants purs** : chaque fichier `components/` expose un seul composant, dépend du store pour l'état, émet des actions (pas de logique métier inline).
- **Hooks custom** (`useElevationProfile`, `useRouteCompute`) encapsulent les appels réseau + cache + états de chargement.
- **Feature folders** (`elevation/`, `routing/`) pour regrouper UI + logique d'un domaine — facilite l'ajout de fonctionnalités futures sans polluer le reste.

### 4.3 UI / UX — Design interactif

#### Philosophie
- **Carte plein écran** : aucune barre de navigation fixe en haut ; tout est en overlay flottant semi-transparent avec `backdrop-blur`.
- **Mobile-first** : bottom-sheet (action sheet) pour les interactions, panneau latéral en slide-over sur desktop.
- **Dark mode** par défaut (fond carte sombre avec SCAN 25), toggle clair.
- **Micro-interactions** : transitions 200 ms sur les panneaux, hover highlight instantané.

#### Layout principal

```
┌──────────────────────────────────────────────────────────────┐
│  [🔍 Search]                        [⚙ Settings] [Layers]   │  ← overlay top
│                                                              │
│                                                              │
│                     MAP (plein écran)                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Panneau latéral (routing / infos)                   │    │  ← slide-over
│  │  ─────────────────────────────────────               │    │    gauche
│  │  Départ : ________                                   │    │
│  │  Arrivée : ________                                  │    │
│  │  [Calculer]                                          │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Elevation Profile Chart (resizable, dockable bottom)    ││  ← overlay bottom
│  │  ▓▓▓▓▓▓▓░░░░░░░░░░░░░░▒▒▒▒▒▒▒▒▒▒▒▒▒▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ││    (drag resize)
│  │  200m                      ↑ hover marker             890m││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

#### Overlays & menus

| Élément | Comportement | Implémentation |
|---|---|---|
| **Layer switcher** | Grille d'icônes miniatures (SCAN 25 / Ortho / Plan IGN / OpenStreetMap) + toggles overlays (hillshade, pentes) | Popover `absolute top-right`, Framer Motion `AnimatePresence` |
| **Settings** | Sliders : intensité hillshade, exaggeration terrain ; toggle 3D ; thème clair/sombre | Panneau slide-over droit, `backdrop-blur-lg bg-white/10` |
| **Search** | Input flottant top-left, autocomplétion dropdown, géocodage → fly-to | Composant contrôlé, debounce 300 ms |
| **Contextuel (clic droit / long press)** | « Itinéraire depuis ici », « Itinéraire vers ici », « Altitude ici » | `ActionSheet` (mobile bottom-sheet, desktop context-menu) |
| **Profil altimétrique** | Barre ancrée en bas, hauteur ajustable (drag handle), réductible | `ResizablePanel` avec `min-h-[120px]` et `max-h-[40vh]` |

### 4.4 Profil altimétrique — spécification détaillée

#### Fonctionnalités

1. **Rendu gradient par élévation** : chaque segment de la courbe est coloré selon une rampe (vert bas → jaune → rouge haut). Implémentation via `visualMap` ECharts (type `continuous`, dimension `y`).
2. **Synchronisation bidirectionnelle hover carte ↔ graphe** :
   - **Graphe → Carte** : le `mousemove` sur le chart calcule l'index du point le plus proche → mise à jour d'un marqueur (`Marker` MapLibre) sur le tracé + bulle affichant altitude/distance.
   - **Carte → Graphe** : le `mousemove` sur le tracé (via `queryRenderedFeatures` ou deck.gl picking) → ECharts `dispatchAction({ type: 'showTip', seriesIndex, dataIndex })` pour positionner le crosshair.
   - **Store partagé** : `routeStore.hoverIndex` (nullable number) ; chaque côté observe et met à jour.
3. **Axes** : X = distance cumulée (m / km), Y = altitude (m). Grilles légères, labels auto.
4. **Informations au survol** : tooltip compact (altitude, pente %, distance depuis le départ, coordonnées).
5. **Zone de remplissage** : `areaStyle` avec gradient vertical (même rampe couleur que la ligne).
6. **Responsive** : le panneau bottom est drag-resizable ; le graphe refit via `ResizeObserver` → `chart.resize()`.

#### Snippet d'intégration

```tsx
// components/elevation/ElevationChart.tsx (simplifié)
import ReactECharts from 'echarts-for-react';
import { useRouteStore } from '@/stores/routeStore';

export function ElevationChart() {
  const { profile, hoverIndex, setHoverIndex } = useRouteStore();

  const option = {
    xAxis: { type: 'value', name: 'Distance (m)', axisLabel: { formatter: '{value} m' } },
    yAxis: { type: 'value', name: 'Alt. (m)' },
    series: [{
      type: 'line',
      data: profile.map((p) => [p.dist, p.alt]),
      smooth: 0.2,
      showSymbol: false,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.3 },
    }],
    visualMap: {
      show: false,
      dimension: 1, // color by Y (altitude)
      min: profile.length ? Math.min(...profile.map(p => p.alt)) : 0,
      max: profile.length ? Math.max(...profile.map(p => p.alt)) : 1000,
      inRange: { color: ['#22c55e', '#facc15', '#ef4444'] },
    },
    tooltip: { trigger: 'axis', formatter: (params) => { /* alt, pente, dist */ } },
  };

  const onChartHover = (params) => {
    if (params.dataIndex != null) setHoverIndex(params.dataIndex);
  };

  return (
    <ReactECharts
      option={option}
      onEvents={{ updateAxisPointer: onChartHover }}
      style={{ height: '100%', width: '100%' }}
    />
  );
}
```

#### Synchronisation `ElevationSync.ts`

```ts
// components/elevation/ElevationSync.ts
import { useEffect } from 'react';
import { useRouteStore } from '@/stores/routeStore';
import type { MapRef } from 'react-map-gl/maplibre';

/** Met à jour le marqueur carte quand hoverIndex change (graphe → carte) */
export function useChartToMapSync(mapRef: React.RefObject<MapRef>) {
  const { profile, hoverIndex } = useRouteStore();

  useEffect(() => {
    if (hoverIndex == null || !profile[hoverIndex] || !mapRef.current) return;
    const { lng, lat, alt } = profile[hoverIndex];
    // Déplacer le marqueur de survol
    // (via un state local ou un layer source GeoJSON dédié)
  }, [hoverIndex, profile, mapRef]);
}
```

### 4.5 Architecture des couches cartographiques

```
┌─────────────────────────────────────────────────────────┐
│  MapLibre Map (terrain enabled, pitch / bearing libres) │
│                                                         │
│  Sources :                                              │
│   • terrain   : raster-dem (TerrainRGB IGN, WMS-r)      │
│   • scan25    : raster (WMTS GEOGRAPHICALGRIDSYSTEMS    │
│                       .MAPS.SCAN25TOUR)                 │
│   • lidar-shd : raster (WMTS IGNF_LIDAR-HD_MNS         │
│                       .ELEVATIONGRIDCOVERAGE.SHADOW)    │
│                                                         │
│  Layers (ordre de rendu) :                              │
│   1. scan25         (type: raster)                      │
│   2. lidar-blend    (type: custom — multiply via WebGL) │
│   3. route-line     (type: line, GeoJSON)               │
│   4. hover-marker   (type: symbol / circle)             │
│   5. waypoints      (type: symbol)                      │
│                                                         │
│  setTerrain → tout est draqué sur le DEM en 3D          │
└─────────────────────────────────────────────────────────┘
```

### 4.6 Implémentation du Custom Layer multiply

```ts
// src/lib/MultiplyRasterLayer.ts
import maplibregl from 'maplibre-gl';

export class MultiplyRasterLayer implements maplibregl.CustomLayerInterface {
  id: string;
  type = 'custom' as const;
  renderingMode = '3d' as const; // suit le terrain
  private map!: maplibregl.Map;
  private program!: WebGLProgram;
  // ... textures issues d'un TileCache personnel ou via map.getSource('lidar-shd')

  constructor(id: string, private sourceId: string) { this.id = id; }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    this.map = map;
    // compile le shader (un quad texturé par tuile)
    this.program = compile(gl, vertSrc, fragSrc);
  }

  render(gl: WebGLRenderingContext, matrix: number[]) {
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    // multiply : C_out = C_dst * C_src + C_dst * (1 - alpha_src)
    gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    // … bind matrix, parcourir les tuiles visibles, dessiner
    gl.disable(gl.BLEND);
  }
}
```

Avantages :
- **Une seule passe**, profondeur partagée avec le terrain.
- Mode de blending paramétrable (multiply / screen / overlay) via `gl.blendFunc` ou un shader custom (`fragColor = base * shadow`).
- Possible de moduler dynamiquement l'intensité (`fragColor = mix(base, base * shadow, intensity)`).

**Pattern validé** : le fork local `open-dronelog` (branche `map-3d`, fichier `src/components/map/FlightPath3DLayer.ts`) implémente exactement ce schéma (Custom Layer MapLibre 3D, shaders GLSL, VBO/IBO, `MercatorCoordinate.fromLngLat`, gestion depth/blend) — il sert de point de départ direct ; il suffit de remplacer la géométrie « ligne » par un quad texturé par tuile et `gl.blendFunc` par `(DST_COLOR, ONE_MINUS_SRC_ALPHA)`.

Alternative simple si on n'a pas besoin de 3D pour l'ombrage : utiliser le **patch wipfli multi-canvas** + `mix-blend-mode: multiply`, avec dégradation gracieuse (désactivation du blending dès que `pitch > 0`).

### 4.7 Roadmap incrémentale

1. **Iteration 1 — MVP carte + blending**
   - Vite + React + Tailwind + TypeScript, structure modulaire (`stores/`, `components/`, `layers/`).
   - MapLibre : SCAN 25 + terrain 3D + Custom Layer multiply `LIDAR-HD_MNS.SHADOW`.
   - UI : carte plein écran, layer switcher (popover icônes), slider intensité hillshade.
   - Dark mode par défaut, responsive.
   - CI GitHub Actions → GitHub Pages.
2. **Iteration 2 — Tracé + profil altimétrique interactif**
   - `mapbox-gl-draw` pour ligne libre + import GPX/GeoJSON (`@tmcw/togeojson`).
   - Appel `elevationLine.json` → store `routeStore.profile[]`.
   - `ElevationChart` (ECharts) : gradient couleur par altitude, zone remplie, tooltips.
   - Synchronisation bidirectionnelle hover graphe ↔ carte (marqueur mobile sur le tracé).
   - Panneau bottom resizable (drag handle).
3. **Iteration 3 — Calcul d'itinéraire & géocodage**
   - `@maplibre/maplibre-gl-directions` → `data.geopf.fr/navigation/itineraire`.
   - Panneau latéral (slide-over) : champs départ/arrivée avec autocomplétion géocodage.
   - Résultats : temps, distance, D+/D−, instructions pas-à-pas.
   - Menu contextuel (clic droit / long press) : « Itinéraire depuis/vers ici ».
4. **Iteration 4 — Polish & features avancées**
   - Sélecteur couche base (SCAN 25 / Plan IGN / Ortho) + overlay toggles.
   - Permaliens (zoom, center, pitch, bearing, couches actives) via URL hash.
   - PWA (manifest + Service Worker, cache tiles IndexedDB).
   - Export GPX du tracé, partage d'itinéraire.
   - Transitions Framer Motion sur panneaux / popovers.

### 4.8 Pourquoi pas iTowns / Cesium ?

- iTowns est techniquement plus puissant en 3D (dalles 3D, terrain natif), mais l'écosystème UI / itinéraire / draw est nettement moins mature, le bundle plus lourd, et le constat utilisateur sur Géoportail montre des perfs inférieures à MapLibre sur ce même périmètre.
- Cesium offre un blending arbitraire mais demande des assets terrain payants ou une conversion du DEM IGN en `quantized-mesh`, et l'orientation « globe » n'est pas pertinente pour un usage local.
- MapLibre + Custom Layer reste donc le meilleur compromis perf / contrôle / écosystème pour la cible.

### 4.9 Risques & points d'attention

| Risque | Mitigation |
|---|---|
| Couverture LiDAR HD partielle | Fallback automatique sur `IGNF_ELEVATION...SHADOW` (couverture nationale) selon la bbox visible |
| Quota WMS-r privé (`terrainrgb0`) | Demander une clé GPF_key dédiée, monitorer ; ou utiliser PMTiles d'un DEM Terrarium hébergé |
| Custom Layer + terrain : effet de profondeur | Tester avec `renderingMode: '3d'` ; si artefacts, basculer en `'2d'` mais perdre l'occlusion |
| MapLibre upgrade cassant (la v6 prévue) | Pin sur 5.11.x, surveillance changelog |
| Rendu sur écrans haute densité | Tuiles `@2x` non disponibles côté IGN → utiliser `transformRequest` pour dégrader / activer `pixelRatio: 1` |

---

## 5. Récapitulatif

- **4 produits analysés**, **0 ne fait du blending multiply** sur les couches LiDAR — c'est le différenciateur du nouveau projet. Le fork open-dronelog valide le pattern Custom Layer 3D WebGL.
- Les ressources IGN nécessaires existent toutes en libre accès (`data.geopf.fr` WMTS pour le SCAN 25 et l'ombrage LiDAR, WMS-r pour le DEM TerrainRGB, services navigation/altimétrie pour les évolutions).
- La pile recommandée : **Vite + React 18 + TypeScript + Tailwind + Zustand + MapLibre GL JS 5 + ECharts** avec un **Custom Layer WebGL** dédié pour la composition `multiply` — compatible terrain 3D, déployable en site statique sur GitHub Pages.
- **Architecture modulaire** : stores Zustand (map / route / ui), feature folders (`elevation/`, `routing/`), layers WebGL isolés, composants React purs.
- **UI** : carte plein écran, overlays flottants `backdrop-blur`, panneau latéral slide-over, panneau profil bottom resizable, layer switcher iconique, dark mode, action sheet contextuel, micro-transitions.
- **Profil altimétrique** : gradient couleur par altitude (ECharts `visualMap`), synchronisation bidirectionnelle hover graphe ↔ carte (store partagé `hoverIndex`).
- Plan progressif en 4 itérations : MVP carte/blending → tracé + profil interactif → itinéraire → polish/PWA.

---

## 6. Vision long terme — Détection de passages de crête (« Brèche »)

### 6.1 Objectif

Identifier, à partir des données LiDAR HD IGN, des **passages praticables sur des crêtes non cotées sur le SCAN 25** — brèches, épaules, fenêtres rocheuses — invisibles sur la cartographie classique mais détectables à la résolution 50 cm du MNT LiDAR.

### 6.2 Pourquoi le LiDAR HD change la donne

| Source DEM | Résolution | Rendu crête | Passage 2 m visible |
|---|---|---|---|
| RGE Alti® 1 m (actuel IGN) | 1 m | crête lissée | difficilement |
| SCAN 25 courbes | 10 m équidistance | abstrait | non |
| **LiDAR HD MNT** (Niveau 3) | **0,5 m** | arête au pixel près | **oui** |

Le MNT LiDAR HD expose chaque col, chaque brèche comme une dépression locale dans un profil de crête — directement exploitable algorithmiquement.

### 6.3 Couches IGN à utiliser

| Couche | Rôle |
|---|---|
| `IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` | Visualisation ombrage sol nu (blending multiply sur SCAN 25) |
| `IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE` (WCS / WMS-r) | Valeurs DEM brutes pour l'analyse (profils transversaux) |
| `GEOGRAPHICALGRIDSYSTEMS.SLOPES.MOUNTAIN` | Carte des pentes — filtre des passages trop raides |
| API `altimetrie/elevationLine.json` | Profil altimétrique le long d'une ligne tracée à la main |

### 6.4 Approche algorithmique

#### Étape 1 — Tracer la ligne de crête
L'utilisateur trace une ligne sur la crête (outil dessin existant, `mapbox-gl-draw`). Cette ligne devient l'axe d'analyse.

#### Étape 2 — Profils transversaux
Pour chaque point de la ligne de crête (tous les N mètres), on calcule un **profil perpendiculaire** court (ex. 30 m de chaque côté) en appelant l'API `elevationLine.json`. Le minimum local de ce profil transversal donne la hauteur de passage à ce point.

#### Étape 3 — Détection des minima locaux de crête
Sur le profil longitudinal de la crête (axe principal), on cherche les **minima locaux** (passages) par rapport aux sommets voisins avec un seuil minimal configurable (ex. dénivellé > 5 m, largeur < 10 m).

#### Étape 4 — Score de praticabilité
Pour chaque passage candidat :
- Pente maximale des 2 versants (`SLOPES.MOUNTAIN`) → exclure > 45°
- Largeur du passage au seuil utilisateur
- Dénivelé relatif au sommet voisin
- Score composite → couleur du marqueur (vert / orange / rouge)

#### Étape 5 — Affichage
- Marqueurs sur la carte pour chaque passage détecté, colorés par score.
- Clic sur un marqueur → profil transversal dans le panneau elevation chart.
- Profil longitudinal de la crête avec passages surlignés.

### 6.5 Implications architecture (à prévoir dès maintenant)

```
src/
├── stores/
│   └── ridgeStore.ts            # ligne de crête courante, passages détectés, filtres
│
├── components/
│   └── ridge/
│       ├── RidgeDrawTool.tsx    # outil dessin ligne de crête (wraps mapbox-gl-draw)
│       ├── PassageMarkers.tsx   # marqueurs carte (score coloré)
│       ├── PassagePanel.tsx     # liste des passages + filtres (pente max, dénivellé min)
│       └── CrossProfile.tsx    # profil transversal au clic
│
└── lib/
    └── ridgeAnalysis.ts         # algo détection minima, scoring, appels elevationLine
```

**Principe de non-régression** : le `ridgeStore` et le feature folder `ridge/` s'ajoutent à côté des stores existants sans toucher à `routeStore` ni aux composants de tracé libre.

### 6.6 Limites et points d'attention

| Contrainte | Mitigation |
|---|---|
| Couverture LiDAR HD non nationale | Vérifier la bbox disponible avant activation ; fallback RGE Alti 1 m ; indicateur visuel de couverture |
| Quota API `elevationLine` (profils multiples) | Batching des requêtes, cache localStorage par ligne, calcul différé (debounce 500 ms sur le tracé) |
| Faux positifs (couloirs d'avalanche, creux rocheux courts) | Seuil de largeur minimum du passage configurable + seuil de dénivellé |
| Précision GPS vs résolution LiDAR | L'outil est une aide à la décision, pas une garantie — disclaimer obligatoire |
| Accès au DEM brut (valeurs numériques) | L'API `elevationLine` suffit pour les profils ; pas besoin de télécharger les tuiles DEM brutes côté client |
