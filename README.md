# open-crete

Carte web 3D avec ombrage LiDAR HD en mode **multiply** sur les fonds IGN, calcul d'itinéraire et profil altimétrique.

## Fonctionnalités

- **Fonds de carte** — SCAN 25, Plan IGN, Orthophotos, OpenStreetMap, LiDAR brut
- **Ombrage LiDAR HD** — Composition en temps réel (mode multiply ou neutre) des couches ombrage MNS / MNT / MNH de l'IGN sur le fond sélectionné, via un protocole custom `composite://` et un blending canvas 2D
- **Terrain 3D** — Relief MapLibre alimenté par le MNT haute résolution IGN (TerrainRGB)
- **Itinéraire** — Tracé multi-points sur la carte avec deux modes :
  - *Guidé* : segments calculés par l'API Navigation IGN (piéton, chemin le plus court)
  - *Libre* : ligne droite entre les points
- **Profil altimétrique** — Graphique interactif (Chart.js) avec coloration par pente, survol synchronisé avec la carte, sélection par drag avec surbrillance du tronçon
- **Interface** — Sidebar rétractable (couches / réglages) + panneau bas (itinéraire / profil), points numérotés sur la carte

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Build | Vite |
| UI | React 18 · TypeScript · Tailwind CSS |
| Cartographie | MapLibre GL JS 5.11 |
| État | Zustand |
| Graphiques | Chart.js |
| Données | IGN Géoplateforme (WMTS, WMS-r, Navigation, Calcul altimétrique) |

## Développement

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Architecture

### Vue d'ensemble

L'application est une SPA React sans backend. Toutes les données proviennent des services publics de la Géoplateforme IGN (WMTS, WMS-r, Navigation, Calcul altimétrique).

```
src/
├── components/
│   ├── map/MapContainer.tsx        # Initialisation MapLibre, couches GeoJSON route, interactions
│   └── ui/
│       ├── LayerSwitcher.tsx       # Sélection fond de carte + source hillshade + terrain 3D
│       ├── SettingsPanel.tsx        # Mode de blend, intensité, qualité de rendu
│       ├── RoutePanel.tsx           # Gestion waypoints, mode guidé/libre, stats
│       └── ElevationChart.tsx       # Profil altimétrique interactif (Chart.js canvas)
├── lib/
│   ├── compositeProtocol.ts        # Protocole custom composite:// (voir ci-dessous)
│   ├── elevation.ts                # Échantillonnage altimétrique via API IGN
│   ├── geo.ts                      # Haversine, interpolation linéaire, découpage
│   ├── ign.ts                      # URLs WMTS/WMS-r, définitions des couches IGN
│   ├── mapStyle.ts                 # Génération dynamique du style MapLibre
│   └── routing.ts                  # Appel API Navigation IGN (piéton, shortest)
└── stores/
    ├── mapStore.ts                 # Vue, couche de base, hillshade, terrain, qualité
    └── routeStore.ts               # Waypoints, segments, profil, sélection, hover
```

### Protocole `composite://`

MapLibre GL JS ne supporte pas nativement les modes de composition (multiply, overlay…) entre couches raster. L'application contourne cette limitation via un protocole custom enregistré avec `maplibregl.addProtocol('composite', ...)`.

**Fonctionnement** :
1. MapLibre demande une tuile à l'URL `composite://<base>/<shadow>/<blend>/<intensity>/<detail>/{z}/{x}/{y}`
2. Le handler télécharge en parallèle la tuile du fond (SCAN 25, Plan IGN, etc.) et la tuile ombrage LiDAR HD
3. Les deux images sont composées dans un `OffscreenCanvas` 2D selon le mode choisi :
   - **lidar-neutral** : pixel-par-pixel, les zones sombres du LiDAR assombrissent le fond, les zones claires l'éclaircissent légèrement (gain asymétrique ombre/lumière)
   - **multiply** : `globalCompositeOperation = 'multiply'` natif du canvas 2D
4. L'`ImageBitmap` résultant est renvoyé directement à MapLibre (pas de ré-encodage PNG)

Le protocole gère aussi l'**overzoom** (la tuile source est découpée si le zoom dépasse le maxZoom de la couche) et le **detail scale** (les tuiles shadow sont chargées à un zoom supérieur puis assemblées pour gagner en finesse).

### Terrain 3D

Le relief utilise la source `raster-dem` de MapLibre alimentée par le DEM haute résolution IGN :
- Endpoint : WMS-r privé (`data.geopf.fr/private/wms-r`) avec la couche `ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.LINEAR` en encodage TerrainRGB
- Exagération verticale configurable (défaut : 1.2×)

### Itinéraire et profil

Le système de tracé fonctionne par segments entre waypoints :
1. L'utilisateur clique sur la carte pour poser des points
2. Chaque segment est calculé indépendamment (guidé via `data.geopf.fr/navigation/itineraire` profil piéton, ou ligne droite en mode libre)
3. Les segments sont fusionnés en une polyligne unique affichée via des couches GeoJSON MapLibre
4. Le profil altimétrique est calculé via l'API `data.geopf.fr/altimetrie` sur les coordonnées de la route
5. Le graphique Chart.js offre : coloration par pente, hover synchronisé (marker sur la carte), et sélection drag → surbrillance du tronçon sur la carte

### Services IGN utilisés

| Service | Endpoint | Usage |
|---------|----------|-------|
| WMTS public | `data.geopf.fr/wmts` | Plan IGN, Ortho, LiDAR HD ombrage (MNS/MNT/MNH) |
| WMTS privé | `data.geopf.fr/private/wmts` | SCAN 25 Tour (clé `ign_scan_ws`) |
| WMS-r privé | `data.geopf.fr/private/wms-r` | DEM TerrainRGB haute résolution |
| Navigation | `data.geopf.fr/navigation/itineraire` | Calcul d'itinéraire piéton (bdtopo-osrm) |
| Altimétrie | `data.geopf.fr/altimetrie` | Profil altimétrique le long d'une ligne |

## Licence

AGPL-3.0 (TBD).
