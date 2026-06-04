# Coupe falaise (cross-section LiDAR)

## Pour les utilisateurs

### À quoi ça sert

L'outil **Coupe falaise** projette le nuage de points LiDAR HD sur un **plan vertical**
défini par une polyligne tracée à la carte, et affiche le résultat dans un graphe à
échelle **strictement 1:1**. Il est conçu pour la préparation de courses verticales —
escalade en grande voie, canyon, descente en rappel, déséquipement — où les distances
horizontales et verticales doivent être lues *à la même échelle* pour évaluer la
longueur de corde nécessaire entre relais.

### Prérequis

L'outil nécessite un **nuage de points LiDAR chargé** (mode `cloud`, `shaded` ou `mesh`
via le panneau LiDAR). Tant qu'aucune donnée LiDAR n'est en mémoire, tous les contrôles
du panneau Coupe falaise restent grisés ; seul le bouton d'onglet est cliquable, avec
une infobulle qui rappelle de charger un nuage.

### Ouvrir le panneau

Le panneau bas comporte deux onglets en pile : **Itinéraire** et **Coupe falaise**.
Cliquez sur **Coupe falaise** pour basculer en mode coupe — le mode *Tracé* s'active
automatiquement. Cliquer une seconde fois sur l'onglet actif **réduit** le panneau
sans perdre l'état.

> **Exclusion mutuelle** : quand l'onglet *Coupe falaise* est ouvert, les clics sur la
> carte n'ajoutent jamais de waypoint d'itinéraire ; quand l'onglet *Itinéraire* est
> ouvert, ils n'ajoutent jamais de point de coupe. Le passage d'un onglet à l'autre
> remet le sous-mode *Tracé* / *Lecture* dans l'état correspondant.

### Tracer une coupe

1. Le mode *Tracé* est actif par défaut à l'ouverture de l'onglet.
2. Cliquez sur la carte pour poser le **premier point**.
3. Cliquez sur les points suivants — la coupe gère une **polyligne à plusieurs
   segments** (utile pour épouser le pied d'une falaise courbe ou contourner une vire).
4. Le graphe se met à jour à partir de **2 points**.
5. Pour retirer le dernier point, cliquez sur l'icône **↩**.
6. Pour effacer toute la coupe et les relais, cliquez sur l'icône **🗑**. Le panneau
   reste ouvert et le mode *Tracé* reste actif — vous pouvez immédiatement retracer.
7. Pour repasser en lecture (sans rien tracer), cliquez sur le bouton *Tracé / Lecture*
   du panneau.

### Le graphe (Canvas 2D, échelle 1:1)

Axes :

- **X** : distance le long de la polyligne, en mètres.
- **Y** : altitude absolue, en mètres NGF — les graduations sont arrondies (0, 1, 2, 5,
  10, 20, 50…) pour faciliter la lecture des longueurs de corde.

Coloration des points (combinable) :

- **Classe ASPRS** — sol, bâti, végétation haute (palette du panneau LiDAR).
- **Profondeur** — modulation de luminosité selon la position du point dans le couloir
  d'échantillonnage (utile pour distinguer surplomb / dévers).

Contrôles dans l'en-tête :

- **Tracé / Lecture** — bascule globale du sous-mode.
- **↩** — retire le dernier point.
- **Couloir** — demi-largeur (m) du couloir échantillonné de chaque côté du plan
  vertical. Plus large = plus de points retenus mais coupe plus floue.
- **Filtres de classe** — Sol (2), Bâti (6), Végét. haute (5) ; au moins une classe doit
  rester active.
- **Classe / Profondeur** — toggles de coloration.
- **Stats** — longueur cumulée de la coupe, dénivelé, nombre de points retenus.
- **🗑** — efface points + relais (ne ferme pas le panneau).

### Relais et corde

Le graphe est cliquable :

- **Clic** sur un point → ajoute un **relais** (avec un label éditable).
- **Clic** sur un relais existant → le supprime.

Le panneau latéral droit (desktop) ou la liste sous le graphe (mobile) listent les
relais et calculent, entre chaque paire :

- la **distance 3D directe** (corde réelle dans le plan vertical) ;
- une **corde recommandée** = distance × (1 + marge), avec une **marge de sécurité
  ajustable** (0–50 %, défaut 15 %) qui couvre la friction, le tirage et les pertes en
  bouts de corde.

Statistiques globales : **corde totale** (somme des cordes recommandées) et **plus
longue** (la corde la plus contraignante du parcours).

### Partage

L'URL hash partageable encode l'état complet de la coupe — polyligne, couloir, filtres
de classe, modes de coloration, marge corde, relais et leurs labels — en plus de l'état
itinéraire / vue / fonds. Voir [SHARE_VIEW.md](SHARE_VIEW.md).

### Limitations connues

- **MapLibre 5.11** ne sait pas draper une polyligne sur un mesh personnalisé
  (`line-z-offset` non supporté) : la ligne tracée à la carte suit le DEM IGN, pas le
  mesh LiDAR. Le graphe, lui, échantillonne bien les vrais points LiDAR.
- Les **points hors couloir** sont silencieusement écartés. Si le graphe paraît vide
  alors que la falaise est sous le tracé, élargissez le **Couloir**.
- Le calcul est **synchrone** — sur des polylignes très longues (> 1 km de coupe sur un
  nuage > 1 M points), un léger lag est attendu.

---

## Pour les développeurs

### Architecture

```
mapStore.bottomMode  ──┐
                       ▼
                  App.tsx                    MapContainer.tsx
                  (BottomModeButton)         (click handlers)
                       │                          │
                       ▼                          ▼
          BottomPanelContent({mode})     bottomMode === 'cliff'
                       │                  ├─ slice.cliffSliceActive
                       ▼                  │   └─ addCliffSlicePoint
              CliffBottomPanel            └─ otherwise: noop (read-only)
                       │
              ┌────────┴────────┐
              │                 │
       CliffSliceChart    StationsSidePanel
       (Canvas 2D 1:1)    (relais + corde)
              ▲
              │
       useCliffSliceProfile()
              ▲
              │
       extractPolylineSliceProfile(source, polyline, halfCorridor, classFilter)
              ▲
              │
       ┌──────┴──────┐
       │             │
   cloudSource   meshAsSliceSource(mesh)
   (lidarShaded)  (lidarMesh, class=2 ground only)
                   merged via mergeSliceProfiles
```

### Modules clés

| Fichier | Rôle |
|---------|------|
| `src/lib/cliffSlice.ts` | Math pure. Définit `SliceSource` (interface générique : `{ centerLng, centerLat, positions, classifications?, pointCount, defaultClass? }`), `extractSliceProfile` (segment unique), `extractPolylineSliceProfile` (multi-segment, accumule les `d` et le bbox altitude), `meshAsSliceSource` (adaptateur `LidarMeshData` → `SliceSource`), `mergeSliceProfiles` (cloud + mesh). |
| `src/components/ui/CliffSliceChart.tsx` | Rendu Canvas 2D **strict 1:1**. Y-axis : graduations arrondies via `niceGridStep` (1-2-5×10ⁿ) ; les labels itèrent sur la hauteur depuis la base (`firstH = ceil(hMin/step)*step`). Click-to-add / click-to-remove relais. Type `ColorMode = 'class' \| 'depth' \| 'class-depth'`. |
| `src/components/ui/CliffSlicePanel.tsx` | Le panneau bas. Exporte `CliffBottomPanel({ profile })` et le hook `useCliffSliceProfile()`. Le composant accepte `profile: SliceProfile \| null` ; quand `null`, il rend `<CliffEmptyState>` à la place du graphe. **Plus aucun export sidebar** — l'ancien onglet de droite a été supprimé. |
| `src/components/ui/ClassFilterChips.tsx` | Chips réutilisables (panneau LiDAR + en-tête de coupe). Prop optionnelle `disabled` qui grise toutes les chips. |
| `src/components/map/MapContainer.tsx` | Handlers `click` / `dblclick` / `contextmenu` / `startDrag` court-circuités quand `mapStore.bottomMode === 'cliff'` — l'itinéraire ne reçoit plus jamais d'événement en mode coupe, et inversement. |
| `src/stores/mapStore.ts` | Source de vérité pour `bottomMode`, `cliffSlice*` (points, stations, corridor, classes, color toggles, rope safety). `clearCliffSlice` conserve `cliffSliceActive: true` pour permettre un retrace immédiat. |
| `src/lib/shareView.ts` | Encode/décode les champs cliff dans le hash URL (`cs`, `cw`, `cc`, `cClass`, `cDepth`, `crs`, `cst`). Tous **optionnels** — payload version `v: 1` reste rétro-compatible. |

### Modèle de données

```ts
// src/lib/cliffSlice.ts
export interface SliceSource {
    centerLng: number;
    centerLat: number;
    positions: Float32Array;          // [dx,dy,dz] meters from center
    classifications?: Uint8Array;     // ASPRS class per point
    pointCount: number;
    defaultClass?: number;            // used when classifications is absent
}

export interface SlicePoint {
    d: number;     // along-polyline distance (m)
    e: number;     // elevation (m)
    depth: number; // perpendicular distance to plane (m, signed)
    cls: number;   // ASPRS class
}

export interface SliceProfile {
    points: SlicePoint[];  // sorted by d
    length: number;        // polyline length (m)
    eMin: number;          // min elevation in profile
    eMax: number;          // max elevation in profile
}
```

### Onglet bottom : machine d'états

`mapStore.bottomMode` (`'route' | 'cliff'`) pilote :

1. Le contenu du panneau bas (`BottomPanelContent({ mode })` dispatche entre
   `<RoutePanel />` et `<CliffBottomPanel />`).
2. Le routage des clics carte (MapContainer court-circuite les handlers route quand
   `bottomMode === 'cliff'`, et inversement le sous-mode `cliffSliceActive` est forcé à
   `false` par le bouton *Itinéraire*).
3. Le bouton actif dans la barre de pills `<BottomModeButton>` (App.tsx).

Règles d'invariant :

- **Au plus un sous-mode trace actif à la fois** : cliquer *Itinéraire* met
  `cliffSliceActive = false` ; cliquer *Coupe falaise* met `routeStore.active = false`
  (et `cliffSliceActive = true`).
- **Lecture seule en mode coupe** : si `cliffSliceActive === false` mais
  `bottomMode === 'cliff'`, les clics ne font rien — le graphe se consulte sans risque.
- **Tab cliquable même sans LiDAR** : `BottomModeButton` reste activable ; seuls les
  contrôles internes de `CliffBottomPanel` sont `disabled` quand
  `noLidar = lidarShaded === null && lidarMesh === null`.
- **Auto-ouverture** : un effet `useEffect` ouvre le panneau et bascule en mode `cliff`
  quand `cliffSlicePoints.length >= 2` (couvre les rechargements de partage URL).

### Ajout d'une nouvelle source de slice

Implémenter l'interface `SliceSource` et la passer à `extractPolylineSliceProfile`.
Exemple pour un nuage chargé hors-pipeline standard (test fixtures) :

```ts
import { extractPolylineSliceProfile, type SliceSource } from '@/lib/cliffSlice';

const src: SliceSource = {
    centerLng: 6.05,
    centerLat: 44.50,
    positions: float32Buffer,           // [dx,dy,dz, dx,dy,dz, ...]
    classifications: classBuffer,
    pointCount: 1234,
    defaultClass: 2,
};
const profile = extractPolylineSliceProfile(
    src,
    [[6.05, 44.50], [6.06, 44.51]],     // [lng, lat][]
    2.5,                                // half-corridor (m)
    [2, 5, 6],                          // class filter
);
```

### Tests visuels recommandés

- **Polyligne courbe** > 4 segments : vérifier la continuité de l'axe X au passage des
  points intermédiaires.
- **Surplomb** (Verdon, Ouest des gorges) : couloir 1.5 m, classe sol+végét haute, mode
  *Profondeur* ; les points dévers doivent être plus sombres.
- **Falaise multi-classes** : nuage avec bâti (6) sous une vire ; vérifier que filtrer
  *Sol* uniquement masque le toit.
- **Partage URL** : tracer 3 points + 2 relais, copier l'URL, recharger, vérifier que
  tout est restauré et que `cliffSliceActive` reste désactivé (mode lecture après
  partage).
- **Onglet sans LiDAR** : ouvrir l'onglet *Coupe falaise* sans charger de LiDAR ;
  tous les contrôles doivent être grisés ; cliquer sur la carte ne doit *rien* faire
  (ni waypoint, ni point de coupe).
