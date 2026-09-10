# Pipeline de chargement et traitement LiDAR HD

Cette page décrit le trajet d'un nuage de points depuis l'archive IGN LiDAR HD
jusqu'aux tableaux typés exploités par la couche WebGL. Tout s'exécute
**entièrement dans le navigateur**, dans un Web Worker, avec décodage des dalles
COPC via `copc.js` + `laz-perf` (WASM) et reconstruction de surface optionnelle
via PoissonRecon (WASM).

> Le **rendu WebGL 2** (shaders, EDL, intégration MapLibre) est documenté
> séparément dans [LIDAR_RENDERING.md](LIDAR_RENDERING.md).

## Pour les utilisateurs

### Charger un nuage

Dans le panneau **LiDAR** :

1. Centrez la carte sur la zone d'intérêt et ouvrez le panneau.
2. Réglez la **taille de la zone** (50 m à 5 km de côté, dans la limite de
   25 km²) et la **résolution** (voir ci-dessous).
3. Sélectionnez le **mode** :
   - **Points** (`shaded`) — tous les points sont conservés, normales calculées
     par k-NN, coloration par pente + Eye-Dome Lighting. Restitue parfaitement
     falaises, surplombs et végétation.
   - **Delaunay** (`delaunay`) — le sol (classe LAS = 2) est trié et trianglé
     en mesh Delaunay 2.5D, le reste (végétation, bâti) reste en points
     ombrés. Plus propre visuellement sur le sol, et un seul fetch suffit pour
     basculer les classes côté client.
   - **Poisson** (`poisson`) — le sol est reconstruit par PoissonRecon (WASM,
     octree adaptatif), le reste reste en nuage de points ombrés. Sortie la
     plus propre (mesh continu, sans triangles tendus en bordure), mais la plus
     coûteuse à calculer. La **profondeur d'octree** (6 à 12, défaut 9) règle
     le compromis vitesse / finesse.
4. Filtrez les **classes LAS** à conserver (sol, végétation basse / moyenne /
   haute, bâtiments, etc.). Note : en modes `delaunay` et `poisson`, le filtre
   est appliqué côté GPU au runtime — un changement de classes ne déclenche
   pas un nouveau fetch.
5. Lancez le chargement : une barre de progression suit les étapes
   (recherche de dalles → téléchargement → décodage → normales / mesh /
   reconstruction Poisson).

Chaque chargement est ajouté à la liste « Nuages récents » : le rouvrir depuis
la galerie est instantané (aucun re-calcul).

### Résolution : le réglage qui décide du coût

Une dalle COPC est un octree : chaque niveau supplémentaire divise par deux
l'espacement entre points et multiplie par ~quatre le volume à télécharger. Le
curseur **Résolution** choisit le niveau le plus profond parcouru — les niveaux
plus fins ne sont **jamais téléchargés**. C'est la différence de fond avec les
curseurs de densité : ceux-ci jettent des points déjà décodés, la résolution
empêche les octets d'arriver.

Les crans correspondent aux espacements que la pyramide IGN livre réellement
(6,8 m, 3,4 m, 1,7 m, 0,85 m, 0,43 m, puis `max` = densité native), mesurés sur
une dalle de 1 km² :

| niveau ≤ | espacement | points cumulés | Mo cumulés |
|---|---|---|---|
| 0 | 6,8 m | 60 639 | 0,7 |
| 1 | 3,4 m | 609 697 | 5,4 |
| 2 | 1,7 m | 2 268 567 | 17,6 |
| 3 | 0,85 m | 8 653 121 | 51,6 |
| 4 | 0,43 m | 18 232 817 | 97,0 |

D'où le couplage **Auto** (coché par défaut) : agrandir la zone choisit la
résolution la plus fine qui tienne sous un budget de ~6 M de points
téléchargés. Une zone de 3 × 3 km retombe ainsi sur 3,4 m et ~5 M de points là
où la densité native en demanderait 160 M. Bouger le curseur décoche Auto —
c'est le seul geste qui exprime une intention que la taille de la zone ne peut
pas deviner. La ligne sous le curseur affiche l'estimation avant de lancer, et
passe en ambre au-delà du budget.

Un ordre de grandeur mesuré : 3 × 3 km à 3,4 m = 38 dalles, ~5 M de points,
environ une minute et demie (l'essentiel du temps part en attente des 429).

### Réglages embarqués avec chaque capture

Un nuage enregistré emporte de quoi le refaire : son emprise (mode, centre,
dimensions du rectangle) et les réglages qui ont servi à le générer, sous forme
d'un petit JSON libre. C'est le `CaptureRecord` de `src/lib/captureParams.ts` —
les réglages seuls diraient *comment* générer, jamais *où*. Trois conséquences :

- **Deux captures de la même zone ne se marchent plus dessus.** L'empreinte des
  réglages (`captureParamsSignature`) entre dans la clé de dédoublonnage
  (`makeCloudKey`), donc relancer la même zone avec une profondeur d'octree ou
  une netteté différente crée une seconde entrée au lieu d'écraser la première.
- **La tuile affiche ce qui distingue.** Parmi les captures d'une même zone, la
  galerie ne met en avant que les réglages dont la valeur varie d'une entrée à
  l'autre (`differingCaptureParamKeys`) ; « Détails » déplie la liste complète,
  emprise et centre compris. Les captures sont aussi datées à la minute.
- **« Recapturer » rejoue le décor sans lancer la capture.**
  `recallCaptureSetup` (lidarSlice) restaure le mode, l'emprise, le cadrage et
  les réglages de génération, puis ouvre le panneau de capture — on peut donc
  changer un curseur avant de relancer, ce qui est tout l'intérêt d'un A/B. Sa
  table d'application est l'inverse de `captureParamsFromState` ; un réglage
  absent ou d'un type inattendu laisse le curseur en place.

Les trois onglets de la galerie exposent les mêmes affordances parce qu'ils
manipulent le même `CaptureRecord` : « Nuages récents » en porte un, « Mes vues »
et « Mis en avant » en portent un par nuage visible (`captures`), donc chacun a
son dépliant « Détails » et son bouton « Recapturer ». Partir d'une scène mise en
avant pour la refaire chez soi est le chemin d'entrée le plus court pour un
nouvel utilisateur. Une scène multi-nuage ne rejoue que son nuage principal —
le rectangle de capture est unique, et l'infobulle du bouton le dit.

### Génération et rendu : ce qui coûte une recapture, et ce qui ne coûte rien

La frontière ne passe pas là où le nom des réglages le suggère. Un nuage récent
n'emporte **que** les réglages de génération, parce qu'eux seuls exigent de
relancer le worker : mode, emprise, densités, et les curseurs Poisson ou grille.

Plusieurs réglages sont cuits à la capture *et* rejoués à chaud, et n'ont donc
rien à faire là :

- `lidarShader`, `lidarSnowLine`, `lidarSnowAmount`, `lidarRockType` — les quatre
  champs de `PaletteSettings`. Ils ne sont plus cuits du tout : ils descendent en
  uniformes, et `mesh.vert` comme `points.vert` évaluent la palette portée en
  GLSL (`glsl/lib/palette.glsl`). Une palette est une **ambiance de scène**, pas
  un paramètre de capture.
- `lidarCloudClasses` — aucun `fetchLidar*` ne reçoit ce paramètre ; c'est un
  masque GPU (`LidarWebGLLayer.setClassMask`).
- `lidarVegGroundGap` / `lidarVegGroundRough` — `recomputeVegHeights` refait les
  hauteurs de végétation en place (~200 ms, voir `LidarCloudOverlay`).

Ils appartiennent à l'**ambiance** d'une scène (`showcaseAmbiance.ts`), pas à
l'identité d'une capture. Les exclure de `makeCloudKey` évite de stocker deux
fois la même géométrie quand seule la couleur a changé.

Conséquence côté galerie : « Nuages récents » ne parle que de géométrie (charger,
recapturer, supprimer) et ne touche jamais au rendu courant — sans quoi rouvrir
un nuage repeindrait celui auquel on est en train de le comparer, shader et
masque de classes étant globaux. « Mes vues », sauvegardée explicitement, porte
l'ambiance : la charger la restaure, et « Appliquer le style »
(`applyAmbianceStyle`) l'applique aux nuages déjà affichés sans rien charger,
`lidarMode` excepté puisqu'il ne concerne que la prochaine capture.

Le format des réglages est délibérément un `Record<string, …>` et non une
interface figée : une entrée écrite par une version antérieure garde ses clés, un
réglage ajouté plus tard n'apparaît que sur les nouvelles entrées, et l'affichage
retombe sur la clé brute pour un réglage qu'il ne connaît pas. Les captures
voyagent aussi dans l'export de scène (`captures` du manifeste) et reviennent
intactes au rechargement. Elles sont recopiées dans le descripteur localStorage
de « Mes vues », comme l'ambiance : la tuile affiche ses détails et propose
« Recapturer » sans ouvrir IndexedDB.

### Limitations connues

- **Aucune dalle** : si la zone n'est pas couverte par LiDAR HD, un toast
  *« Aucune dalle LiDAR HD »* s'affiche. Déplacez-vous ou agrandissez la zone.
- **Lenteur sur les grandes zones** : le coût suit le nombre de dalles (jusqu'à
  64) et la résolution demandée. Une grande zone à résolution fine se paie en
  minutes ; laissez Auto faire son travail, ou descendez d'un cran.
- **Mode Poisson coûteux** : la reconstruction WASM est mono-thread et bloque
  le worker pendant plusieurs secondes (voire dizaines de secondes en
  profondeur 11–12). Préférez `mixed` pour de l'exploration rapide.
- **Erreurs 429 transitoires** : `data.geopf.fr` limite les requêtes par plage
  d'octets agressives. Le pipeline retente automatiquement (jusqu'à 5 fois) ;
  si l'erreur persiste, relancez plus tard.
- **Pas d'annulation** : un chargement en cours ne peut pas être interrompu
  proprement ; lancer un nouveau chargement remplace simplement le résultat
  (logique « le dernier gagne »).

---

## Pour les développeurs

### Vue d'ensemble

```mermaid
flowchart LR
    UI[LidarCaptureControls<br/>UI] -->|loadLidarCloud| Store[mapStore<br/>Zustand]
    Store --> IDX[lib/lidarBrowser/index.ts<br/>worker wrapper]
    IDX --> WC[workerClient.ts]
    WC --> WK[worker.ts<br/>DedicatedWorker]
    WK --> PIPE[pipeline.ts<br/>fetchCommon + finalizers]
    PIPE --> WFS[wfs.ts]
    PIPE --> EXT[extract.ts<br/>COPC reader]
    WFS --> IGN[(data.geopf.fr<br/>COPC LAZ tiles)]
    EXT --> IGN
    PIPE --> FIN[mesh.ts / normals.ts / slope.ts]
    Store --> OV[LidarCloudOverlay<br/>LidarWebGLLayer]
    OV --> MAP[MapLibre canvas]
```

Les trois modes (`shaded`, `delaunay`, `poisson`) partagent le même prélude
(`fetchCommon`) puis dispatchent vers un finalizer dédié. `delaunay` et
`poisson` produisent tous deux un `LidarMixedData` (mesh sol + nuage non-sol),
`shaded` produit un `LidarShadedCloudData` ; la couche overlay les traite
uniformément.

### Fichiers

| Fichier | Rôle |
|---------|------|
| [src/components/ui/lidar/LidarCaptureControls.tsx](../src/components/ui/lidar/LidarCaptureControls.tsx) | UI : emprise, densité, mode, réglages Poisson, déclenchement du chargement |
| [src/stores/mapStore.ts](../src/stores/mapStore.ts) | Action `loadLidarCloud`, gestion des courses (latest-wins) |
| [src/lib/lidarBrowser/index.ts](../src/lib/lidarBrowser/index.ts) | Wrapper qui dispatche vers le worker |
| [src/lib/lidarBrowser/workerClient.ts](../src/lib/lidarBrowser/workerClient.ts) | Côté main : `postMessage`, dé-multiplexage par id, transferables |
| [src/lib/lidarBrowser/worker.ts](../src/lib/lidarBrowser/worker.ts) | Boucle de réception, appel `pipeline.ts`, collecte des transferables |
| [src/lib/lidarBrowser/pipeline.ts](../src/lib/lidarBrowser/pipeline.ts) | `fetchCommon` + finalizers `fetchLidarShaded` / `fetchLidarDelaunay` / `fetchLidarPoisson` |
| [src/lib/lidarBrowser/wfs.ts](../src/lib/lidarBrowser/wfs.ts) | Recherche de dalles via WFS IGN (bbox lng,lat) |
| [src/lib/lidarBrowser/extract.ts](../src/lib/lidarBrowser/extract.ts) | Décodage COPC range-fetch, sémaphore + retry 429 |
| [src/lib/lidarBrowser/normals.ts](../src/lib/lidarBrowser/normals.ts) | Normales par k-NN (k=12, 2 itérations) |
| [src/lib/lidarBrowser/mesh.ts](../src/lib/lidarBrowser/mesh.ts) | Triangulation Delaunay 2.5D du sol, filtrage des longues arêtes |
| [src/lib/lidarBrowser/poissonRecon.ts](../src/lib/lidarBrowser/poissonRecon.ts) | Wrapper WASM PoissonRecon v18.76 (chargement paresseux, parsing PLY binaire) |
| [src/lib/lidarBrowser/poissonBase.ts](../src/lib/lidarBrowser/poissonBase.ts) | Socle synthétique (plancher + 4 murs orientés) qui referme le terrain en brique à fond plat |
| [src/lib/lidarBrowser/slope.ts](../src/lib/lidarBrowser/slope.ts) | Palette de référence CPU (`vertexColor`) — le rendu passe par `glsl/lib/palette.glsl` |
| [src/lib/lidarBrowser/bdforet.ts](../src/lib/lidarBrowser/bdforet.ts) | Typage des essences par BD Forêt® v2 : WFS, remplissage scanline des peuplements en raster 2 m, étiquetage des points |
| [src/lib/lidarBrowser/proj.ts](../src/lib/lidarBrowser/proj.ts) | WGS84 ↔ Lambert-93 |
| [public/wasm/poissonrecon.mjs](../public/wasm/poissonrecon.mjs) | Bundle WASM PoissonRecon (chargé via `import()` dynamique) |

### Étape commune : `fetchCommon`

Les trois modes partagent le même prélude de fetch / crop, exécuté dans le
worker. À noter : `delaunay` et `poisson` ignorent le filtre `classes` à ce
stade — il leur faut le sol (classe 2) pour le mesh **et** le non-sol pour le
nuage. Le filtrage final est délégué au mask GPU de la couche overlay.

```mermaid
flowchart TD
    P([BrowserFetchParams<br/>lng, lat, radius, stride,<br/>targetSpacingM, classes]) --> R[Clamp radius 20-4000m<br/>Clamp stride 1-200]
    R --> L93[proj.ts<br/>lng,lat → Lambert-93 x0,y0]
    L93 --> WFS[wfs.ts findTiles<br/>bbox query data.geopf.fr WFS]
    WFS -->|0 tiles| ERR([Throw 'no_lidar_tile'])
    WFS -->|N tiles| FAN[Promise.all over tiles]
    FAN --> EXT[extract.ts<br/>extractPoints per tile]
    EXT --> MERGE[concat Float32 positions<br/>+ Uint8 classifications]
    MERGE --> OUT([positions, classifications,<br/>pointCount, radius,<br/>centerLng, centerLat])
```

Notes :

- `radius` est le **demi-côté** d'un carré L93, pas un rayon de cercle.
- `wfs.ts` ramène jusqu'à **64 dalles** (`MAX_TILES`) : une zone de 5 km de côté
  en couvre 36 au pire cadrage. Au-delà, la liste est tronquée sans avertir —
  c'est la garde de dernier recours, pas un réglage.
- `targetSpacingM` est convertie par `copcMaxLevel` en profondeur d'octree
  maximale, **par dalle**, à partir de l'espacement racine lu dans son en-tête
  (~6,8 m sur LiDAR HD) : la décision ne suppose donc aucune constante IGN.
- Le bbox WFS utilise l'ordre **lng/lat** malgré `srsname=EPSG:4326` —
  particularité IGN (cf. [wfs.ts](../src/lib/lidarBrowser/wfs.ts)).
- Les positions sont des **METER\_OFFSETS** (Float32 est/nord/up) relatifs au
  centre de la requête (`centerLng`, `centerLat`). Cela maintient une précision
  Float32 exploitable sur plusieurs centaines de mètres.

### Décodage COPC par dalle (`extract.ts`)

Une dalle COPC est un fichier LAZ de 0.5–2 GB indexé par un octree dans son
EVLR. On HTTP-Range-fetch uniquement les nœuds qui intersectent notre bbox.

```mermaid
flowchart TD
    T([tileUrl, x0, y0,<br/>radius, stride, targetSpacing,<br/>classFilter]) --> G[Getter.create url<br/>+ semaphore + retry]
    G --> H[Copc.create<br/>reads LAS header + COPC VLR]
    H --> LVL[copcMaxLevel<br/>root spacing → max depth]
    LVL --> WALK[collectIntersectingNodes<br/>BFS over hierarchy pages<br/>skips nodes deeper than max]
    WALK --> NODES[List of CopcNode<br/>with key, offset, length]
    NODES --> PAR[Promise.all over nodes]
    PAR --> DEC[runOnLazPerf<br/>Copc.loadPointDataView]
    DEC --> FILT[Per-point loop:<br/>bbox crop, stride decimation,<br/>classification whitelist]
    FILT --> SUB[Subarray to actual kept count]
    SUB --> AGG[Concat node results]
    AGG --> OUT([positions Float32 + classifications Uint8<br/>in METER_OFFSETS])
```

#### Throttle et retry sur les 429 de `data.geopf.fr`

IGN limite les rafales de range-requests. Le wrapper `get` gère ça de façon
transparente :

```mermaid
flowchart LR
    REQ([get begin, end]) --> SEM{inflight &lt; MAX_INFLIGHT?<br/>currently 2}
    SEM -->|no| WAIT[await queue slot]
    SEM -->|yes| FETCH[rawGet via copc.js]
    WAIT --> FETCH
    FETCH --> CHK{byteLength == expected?}
    CHK -->|yes| OK([return buffer])
    CHK -->|no| DEC[Decode body as UTF-8<br/>look for 429/503/'too many']
    DEC -->|retriable| BACK[Exponential backoff<br/>500/1000/2000/4000ms + jitter]
    BACK -->|attempt &lt; 5| FETCH
    DEC -->|not retriable| THROW([Throw with body snippet])
    BACK -->|attempt 5| THROW
```

- Jusqu'à **5 tentatives**, soit ≤ 7.5 s de backoff cumulé.
- Le sémaphore est par-dalle (chaque appel `extractPoints`). Avec 1–4 dalles,
  la concurrence globale effective est `tiles × MAX_INFLIGHT`. Si les 429
  persistent, baisser encore `MAX_INFLIGHT` ou hisser le sémaphore au scope
  module.

### Finalisation par mode

Après `fetchCommon`, le worker dispatche vers l'un des trois finalizers.

```mermaid
flowchart TD
    F([fetchCommon output]) --> K{Mode}

    K -->|shaded| S[fetchLidarShaded]
    S --> S1[normals.ts<br/>computeNormalsKNN<br/>k=12, 2 iterations]
    S1 --> SO([LidarShadedCloudData<br/>+ normals + classifications])

    K -->|delaunay| M[fetchLidarDelaunay]
    M --> M1[Split ground class=2<br/>vs non-ground]
    M1 --> M2[mesh.ts buildMesh<br/>2.5D Delaunator + maxEdge filter]
    M2 --> M3[Non-ground:<br/>kNN normals]
    M3 --> MO([LidarMixedData<br/>mesh + shaded])

    K -->|poisson| P[fetchLidarPoisson]
    P --> P1[Split ground vs non-ground]
    P1 --> P2[poissonRecon.ts<br/>WASM reconstruct<br/>octree depth 6-12]
    P2 --> P3[Parse binary PLY<br/>+ normalsFromMesh]
    P3 --> P4[Non-ground:<br/>kNN normals]
    P4 --> PO([LidarMixedData<br/>mesh + shaded])
```

- **Mixed** : mesh Delaunay 2.5D rapide via [Delaunator](https://github.com/mapbox/delaunator),
  avec filtrage des arêtes longues pour éliminer les triangles tendus en
  bordure de zone. Idéal pour de l'exploration rapide.
- **Poisson** : reconstruction de surface PoissonRecon v18.76 (Misha Kazhdan)
  compilée en WASM, chargée paresseusement depuis `/wasm/poissonrecon.mjs`. Le
  module produit un PLY binaire qu'on reparse en `Float32Array` positions +
  `Uint32Array` indices. Les normales sont ensuite recalculées par
  pondération d'aires (`normalsFromMesh` dans `pipeline.ts`).

  Avant la reconstruction, `poissonBase.ts` ajoute un **socle** : un plancher
  quelques mètres sous le point le plus bas, normales vers le bas, et quatre murs
  verticaux coplanaires sur les bords du rectangle de capture. Sans lui le
  solveur referme le dessous en coussin bombé.

  Tout y est dimensionné en **cellules d'octree** (`octreeCellM` : plus grand côté
  de la bbox / 2^profondeur), jamais en distances absolues — une valeur en mètres
  se comporte correctement à une seule échelle de capture :

  - les **pas d'échantillonnage** sont des multiples de la cellule, sinon un
    plafond en mètres fige la densité du socle pendant que la capture s'agrandit
    (une emprise de 3 km émettait 1,6 M de points de socle pour 383 k points de
    sol) ;
  - la **profondeur de la plinthe** vaut au moins `POISSON_BASE_MARGIN_CELLS`
    (6) cellules, en plus du plancher absolu `POISSON_BASE_MARGIN_M` (3 m). Les
    3 m seuls font 5,1 cellules sur une capture de 300 m mais **0,5 cellule** sur
    une capture de 3 km : la plinthe passe alors sous la résolution du solveur,
    les colonnes de mur ne reçoivent plus qu'un ou deux échantillons, plus rien
    ne contraint le dessous et le coussin revient — exactement ce que le socle
    est censé empêcher ;
  - le pas vertical des murs vaut **une** cellule (et non deux), pour que ces
    6 cellules de plinthe donnent bien 6 échantillons sur la colonne la plus
    courte ;
  - le **pas du plancher** vaut `FLOOR_STEP_CELLS` = **1,5 cellule**, et c'est
    une falaise, pas un réglage de confort. Mesuré sur le solveur de production
    (capture 3 km, `depth 9`), le débord du maillage sous le plancher vaut :

    | Pas du plancher | Débord sous le plancher |
    |---|---|
    | 1 cellule | 0,4 cellule |
    | 1,5 cellule | 0,7 cellule |
    | 2 cellules | 0,9 cellule |
    | 2,75 cellules | **6,9 cellules** |
    | 3 cellules | **50 cellules** (≈ 260 m) |

    Au-delà de ~2,5 cellules le plan porte trop peu d'échantillons par nœud
    terminal (`--samplesPerNode 1.5`) : il cesse d'exister pour le solveur, et
    le dessous s'affaisse au travers sur des centaines de mètres — un gros
    **coussin localisé**, typiquement sur la partie plate et basse du modèle où
    la plinthe est la plus mince.

  Le coût du socle reste stable à iso-emprise entre 300 m et 3 km : les trois
  pas suivent la cellule d'octree, donc le nombre de points ne dépend que de la
  profondeur, pas de la taille de la capture — 117 k points de plancher
  (341 × 341) aux deux échelles. C'est ~3× le budget du pas à 3 cellules, et
  c'est le prix d'un socle qui tient.

  Mesuré sur le solveur de production, le maillage déborde toujours d'environ
  **0,7 cellule d'octree** sous le plancher : ce débord résiduel est une
  propriété du solveur, pas un défaut de profondeur, et il ne sert à rien
  d'épaissir le socle pour le réduire.

  La profondeur d'échantillonnage reste plafonnée à
  `POISSON_BASE_MAX_SAMPLE_DEPTH` : plancher et murs sont plans, ils ne gagnent
  rien à être échantillonnés à la finesse du terrain.

Aucun de ces chemins ne produit de couleurs : la palette est évaluée par sommet
dans les vertex shaders (voir `docs/LIDAR_RENDERING.md`), le pipeline ne sort que
de la géométrie et des classifications.

Dans les deux cas (`delaunay` et `poisson`), la sortie est un `LidarMixedData`
(mesh sol + nuage ombré non-sol), donc la couche overlay les traite de la
même manière.

### Frontière worker (`workerClient` ↔ `worker`)

```mermaid
sequenceDiagram
    participant Store as mapStore.loadLidarCloud
    participant IDX as lib/lidarBrowser/index.ts
    participant WC as workerClient.ts
    participant WK as worker.ts
    participant PIPE as pipeline.ts

    Store->>IDX: fetchLidarShaded(params)
    IDX->>WC: dispatch('shaded', params)
    WC->>WK: postMessage({id, kind, params})
    WK->>PIPE: fetchLidarShaded(paramsWithProgress)
    loop progress events
        PIPE-->>WK: onProgress(stage, detail)
        WK-->>WC: postMessage({id, type:'progress'})
        WC-->>Store: onProgress callback (UI updates)
    end
    PIPE-->>WK: LidarShadedCloudData (typed arrays)
    WK->>WK: collectTransferables(data)
    WK-->>WC: postMessage({id, ok, data}, [buffers])
    WC-->>IDX: resolve(data)
    IDX-->>Store: data
    Store->>Store: set({lidarShaded: data})
```

Contrats clés :

- **Params clonables uniquement** : `workerClient.cleanParams` retire `signal`
  et `onProgress` (les fonctions et `AbortSignal` ne survivent pas à
  `postMessage`). L'annulation n'est pas propagée ; le store gère les courses
  en mode « le dernier gagne ».
- **Transferables** : chaque buffer de TypedArray du résultat est transféré
  en zéro-copie. Après `postMessage`, les références côté worker sont
  détachées.
- **Progress** : messages streamés de la forme
  `{ id, type: 'progress', progress: LidarProgress }`, dé-multiplexés par id
  de requête.

### Des données aux pixels

Une fois les données dans le store, l'overlay se ré-affiche :

```mermaid
flowchart LR
    Store[mapStore.lidarShaded] --> OV[LidarCloudOverlay.tsx]
    OV --> LWG[LidarWebGLLayer<br/>custom GL with EDL + AO]
    LWG --> MAP[MapLibre custom layer]
```

`LidarWebGLLayer` utilise `args.defaultProjectionData.mainMatrix` de MapLibre
pour que les points restent calés sur le fond à n'importe quel pitch / bearing
/ zoom. Les METER\_OFFSETS sont convertis en Mercator dans le vertex shader via
`MercatorCoordinate.meterInMercatorCoordinateUnits()`.

### Limitations techniques

- **Pas de propagation d'annulation** vers le worker : un nouveau chargement
  ne stoppe pas l'ancien, on s'appuie sur la logique « latest-wins » du store.
- **Sémaphore par-dalle** : avec N dalles en parallèle, la concurrence
  globale est `N × MAX_INFLIGHT` ; sous 429 persistant, hisser le sémaphore
  au scope module est plus robuste que baisser `MAX_INFLIGHT`.
- **Float32 METER\_OFFSETS** : la précision se dégrade au-delà de quelques
  kilomètres ; le clamp `radius ≤ 1000 m` reste confortablement dans la zone
  exploitable.

### Points d'entrée pour le debug

| Symptôme                                        | Piste                                                                    |
|-------------------------------------------------|--------------------------------------------------------------------------|
| Retries `429 Too Many Requests`                 | Baisser `MAX_INFLIGHT` dans [extract.ts](../src/lib/lidarBrowser/extract.ts) |
| Toast *« Aucune dalle LiDAR HD »*               | Bbox WFS ; vérifier l'ordre lng,lat dans `wfs.ts`                        |
| Points qui dérivent au pitch / pan              | Matrice du shader `LidarWebGLLayer` ; vérifier l'usage de `mainMatrix`   |
| Worker silencieux / pas de progression          | Vérifier que `workerClient.cleanParams` conserve les params requis       |
