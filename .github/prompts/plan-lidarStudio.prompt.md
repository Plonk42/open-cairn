# Plan: LiDAR Studio — interface dédiée plein écran + vitrine d'ambiances

## User intent
Le rendu LiDAR 3D est devenu LA fonction phare. Lui donner une **interface dédiée** (route `?view=lidar`) avec sa propre coquille UI, qui met en valeur le rendu et regroupe TOUS ses réglages, en gardant l'effet "wow" (vrai relief 3D montagne, détail inégalé). Architecture extensible pour fonctions futures. Ajout d'un système d'**export/galerie d'ambiances** (géométrie 3D + heure/ombrage/caméra) hébergées en GitHub Release pour un chargement instantané.

## Decisions (from user Q&A)
- Forme: **page/route séparée** `?view=lidar` avec son propre shell (PAS un simple toggle, PAS juste une refonte de l'onglet).
- Fond de carte 2D: **affiché par défaut mais masquable** sous le nuage (ortho IGN par défaut pour le contexte; toggle hide-basemap existant conservé et fonctionnel).
- Cibles: **desktop d'abord**, mobile fonctionnel.
- Onglet LiDAR classique → **launcher compact** (option A): porte d'entrée (CTA héro vers le studio + load express + récents + aperçu vitrine). Réglages fins migrent au studio. État partagé via store → zéro doublon.
- `.bin` vitrine = géométrie **+ ambiance + caméra**, settings versionnés (forward-compat).
- Hébergement vitrine = **GitHub Release assets** (hors arbre git); manifeste `index.json` seul commité; pas de Git LFS.
- Compression = **meshopt** (décodeur ~qq KB, lazy), décodage en JS car le CDN Release sert du brut.
- Galerie **vide au départ**, peuplée ensuite via l'export.
- Empty state: si aucun nuage n'est chargé et que la galerie est vide, afficher dans la zone centrale du studio un CTA "Charger un nuage LiDAR" (déclenche `loadLidarCloud()`) avec une courte phrase explicative. Cet état est distinct du launcher compact de l'onglet classique.
- Fonctions futures à anticiper (extension points, PAS toutes implémentées en phase 1): coupe falaise intégrée, bookmarks/points de vue cinématiques, mesures 3D, export (image HD/vidéo/3D), annotations.

## Current architecture (key facts)
- Vite SPA, pas de router. `main.tsx` fait restore share (`#share=`) PUIS rend `<App/>`.
- MapLibre map créée dans `MapContainer.tsx`, stockée dans mapStore via `setMapInstance`. `hash:true` (écrit `#map=z/lat/lng`). `?view=` (search param) coexiste avec le hash sans conflit.
- Overlays lazy dans MapContainer: `LidarCloudOverlayGate`, `CliffSlicePathOverlayGate`, `LidarPreviewGate` — réutilisables tels quels.
- TOUT l'état LiDAR est dans `mapStore` (Zustand) → un shell alternatif partage l'état automatiquement, pas de duplication.
- LiDAR aujourd'hui = 1 onglet sur 4 (RightTab 'lidar') dans sidebar 320px (`w-80`). `LidarCloudPanel.tsx` ~1100 lignes, ~50 réglages tassés + sous-composants inline (ShadowControls, SunDateControl, LidarStatusLine, progress, OrbitControl).
- Store LiDAR: lidarMode ('shaded'|'delaunay'|'poisson'), lidarShader, lidarShaded/lidarMesh (RAM), loading/error/progress, lidarCloudRadius/Stride/Classes, PointSize/SizeCompensation/Opacity/PhotoOpacity/HideBasemap, EDL (Edl/Strength/Radius/FarPlane), Sun (lidarSunDate/Shadows/ShadowStrength), Poisson (Depth/SamplesPerNode/PointWeight). ~30 champs persistés (localStorage `open-cairn-settings`).
- Entry actuel: bouton "Charger ici" → `loadLidarCloud()` (mapStore) → worker pipeline.
- SonarQube cognitive-complexity cap 15 sur App.tsx (et convention repo) → extraire helpers.
- Lint: `npm run lint`; build: `npm run build`.

## Plan (phased)

### Phase 0 — Routing (fondation)
- Nouveau `src/lib/useView.ts`: hook lisant `view` depuis `location.search` (`?view=lidar`), écoute `popstate`, expose `{ view, setView }`. `setView` fait `history.pushState`/`replaceState` en préservant le hash (map/share). Type `AppView = 'map' | 'lidar'`.
- Nouveau `src/Root.tsx`: switch racine. `view==='lidar'` → `<Suspense><LidarStudio/></Suspense>` (lazy import), sinon `<App/>`. Garde share-restore intact (déjà fait dans main.tsx avant render).
- `src/main.tsx`: rendre `<Root/>` au lieu de `<App/>`.
- Switch de shell = MapContainer démonté/remonté → map recréée (acceptable). État LiDAR conservé (store). Au remontage, l'overlay WebGL LiDAR se reconstruit automatiquement depuis `lidarShaded`/`lidarMesh` du store (le gate `LidarCloudOverlayGate` re-rend la géométrie sans relancer WFS/COPC/Poisson) → le nuage réapparaît sans re-déclencher le pipeline de chargement.

### Phase 1 — Extraction des contrôles réutilisables
But: casser le monolithe `LidarCloudPanel.tsx` en briques partagées (studio + onglet classique consomment les mêmes).
- Nouveau dossier `src/components/ui/lidar/`:
  - `LidarCaptureControls.tsx` — mode (Points/Delaunay/Poisson), Poisson depth/samples/pointWeight, rayon, densité (STRIDE_STOPS), boutons Charger ici / Effacer, status line, progress.
  - `LidarAppearanceControls.tsx` — opacité, taille points, taille adaptative, shader (base/cliff/winter), filtre de classes (`ClassFilterChips`), photo (mesh), atténuer le fond.
  - `LidarLightingControls.tsx` — `SunDateControl` (date + slider + play), `ShadowControls` (ombres + intensité).
  - `LidarEffectsControls.tsx` — EDL (toggle + intensité/distance/profondeur).
  - `SunDateControl.tsx`, `ShadowControls.tsx`, `OrbitControl.tsx`, `LidarProgress.tsx`, `LidarStatusLine.tsx` — extraits 1:1 depuis LidarCloudPanel (pas de changement de logique).
- `LidarCloudPanel.tsx` refactor en **launcher compact**: CTA héro "Ouvrir le studio LiDAR" (→ `setView('lidar')`) + chargement rapide minimal (rayon + "Charger ici" + ligne statut) + liste "récemment chargés" + aperçu vitrine. Les réglages fins migrent au dock du studio. Pour les "récemment chargés": afficher les 3 dernières entrées de `SavedCloudsPanel` sous forme de liste compacte (nom + date, clic → chargement direct), pas le composant complet.

### Phase 2 — Coquille LidarStudio (le shell dédié)
- Nouveau `src/components/lidar/LidarStudio.tsx`: layout plein écran cinématique sombre, compose `<MapContainer/>` (réutilisé) + chrome flottant translucide:
  - **Top bar** (translucide): titre/branding, CTA "Charger ici", bouton "Quitter le studio" (→ `setView('map')`), slots presets/bookmarks/export/vitrine.
  - **Right dock** (rétractable): sections repliables — Capture, Apparence, Lumière, Effets — composées des briques Phase 1. Plus d'espace, plus lisible que la sidebar 320px.
  - **Quick basemap switch** (ortho/scan25/plan) via `baseLayer` store, ortho par défaut pour le contexte montagne. Implémenté dans `LidarStudio.tsx` comme boutons appelant le setter `baseLayer` du store; `MapContainer.tsx` n'est pas modifié, il réagit déjà au store `baseLayer`.
  - **Auto-orbit** (OrbitControl existant) mis en avant + bouton "Vue propre" (masque tout le chrome pour capture/effet wow), réaffichable.
  - **Extension slots scaffoldés mais vides**: left tool-rail (mesures/annotations/coupe), bottom strip (coupe falaise/timeline). Commentés comme points d'extension.
- Responsive: dock plein écran en drawer sur mobile (réutilise patterns mobiles existants), desktop = dock latéral.

### Phase 3 — Polish "wow"
- Intro caméra: si un nuage est chargé, animer `map.easeTo({ pitch: 55, duration: 1200, easing: t => t*(2-t) })` au montage du studio.
- Mode "Vue propre" (hide chrome) + raccourci clavier.
- Fond ambiance: fond IGN affiché par défaut (décision user) ; s'assure que le toggle hide-basemap reste accessible et fonctionnel pour obtenir une scène quasi-pure.

### Phase 4 — Export d'ambiances + galerie vitrine (Showcase, chargement instantané)
But: permettre d'EXPORTER depuis l'UI une vue composée (géométrie + ambiance + caméra), l'héberger en GitHub Release, et la recharger instantanément via une galerie. Galerie VIDE au départ; l'user peuple ensuite. Vecteur principal de l'effet "wow".

**Dimensionnement (vérifié dans le code):**
- Rayon = demi-côté → rayon 200 m = emprise 400×400 m = 160 000 m². LiDAR HD ~10 pts/m² → ~1,6 M pts à densité max.
- Octets/unité (formats réels): sommet mesh Poisson = 32 B (pos f32×3 + normal f32×3 + couleur u8×4 + roughness f32×1) ; triangle = 12 B (u32×3) ; point nuage = 29 B (pos 12 + normal 12 + couleur 4 + classe 1).
- Poisson depth 11, rayon 200 m, densité max → **~90-110 MB RAM brut** par scène (mesh sol ~84 MB + nuage non-sol ~19 MB).
- Compression meshopt ×5-10 appliquée à ~90-110 MB RAM → taille on-disk attendue **~10-20 MB/scène** (utiliser 20 MB comme borne haute conservatrice pour le texte UX et le dimensionnement des buffers). La compression sert la VITESSE de download (effet instantané), PAS le poids repo.

**Servir depuis GitHub SANS alourdir le repo (décision user: ne PAS commiter de gros .bin):**
- ❌ NE PAS commiter les `.bin` (git versionne l'historique → chaque re-export double le `.git`). ❌ NE PAS utiliser Git LFS (Pages sert le pointeur texte).
- ✅ **GitHub Release assets**: `.bin` attachés à une Release (ex. tag `showcase-v1`), HORS arbre git, servis par `objects.githubusercontent.com` (CDN, CORS `*`, ≤2 GB). `.git` reste léger.
- Garde-fou taille à l'export: avant de déclencher le download, vérifier que la taille estimée du Blob est < 500 MB. Au-delà, afficher un avertissement "Scène très volumineuse (~X MB) — réduire le rayon ou la densité pour un chargement instantané optimal" avec option de continuer ou annuler.
- ✅ **SEUL fichier commité = `public/showcase/index.json`** (~KB): scènes (id, nom, vignette base64/webp légère, params, taille) + URL Release de chaque `.bin`.
- Flux: (1) **export UI** dans le studio → "Exporter cette vue" → download `<id>.bin` + vignette ; (2) `gh release upload showcase-v1 <id>.bin` (manuel) ; (3) ajouter l'entrée + vignette dans `index.json` et commiter ; (4) loader runtime fetch l'URL Release → decode → applique géométrie + ambiance + caméra.

**Compression = meshopt (décision validée):**
- CDN Release sert les octets BRUTS → pas de `Content-Encoding` auto → décompression EN JS.
- `DecompressionStream('gzip')` natif existe (zéro dep) mais médiocre sur float. **meshopt** (quantif + entropie) donne ×5-10; décodeur wasm ~qq KB (vs Draco ~200 KB). **Lazy-load le décodeur uniquement à l'ouverture de la galerie / export.**
- Si le chunk `meshoptimizer` échoue au chargement (`import()` rejeté : erreur réseau, CSP bloquant le wasm, ou échec de fetch du chunk lazy), afficher une erreur modale "Le décodeur de géométrie n'a pas pu être chargé. Vérifiez votre connexion." et désactiver les boutons Exporter et les vignettes de la galerie pour la session.
- Encode meshopt: quantifier positions (int16 relatif au bbox), normales (oct-encoded int8/16), couleurs u8, indices via meshopt index codec.

**Implémentation:**

**Format binaire `.bin` (spécification unique, source de vérité):**
1. Magic bytes (4 B ASCII, ex. `OCSS`).
2. Version u16 (little-endian).
3. Longueur du blob settings u32 + blob settings JSON UTF-8 (liste de champs exacte ci-dessous).
4. Nombre de buffers géométrie u8.
5. Par buffer: type enum u8 + longueur en octets du buffer meshopt-compressé u32 + données.
- Champs du blob settings JSON (géométrie + AMBIANCE + CAMÉRA, décision user): `{ lidarMode, lidarShader, lidarSunDate, lidarShadows, lidarShadowStrength, lidarCloudEdl, lidarCloudEdlStrength, lidarCloudEdlRadius, lidarCloudEdlFarPlane, lidarCloudPointSize, lidarCloudSizeCompensation, lidarCloudOpacity, lidarCloudPhotoOpacity, lidarHideBasemap, classesVisibles }` + caméra `{ center, zoom, pitch, bearing }`. Met en avant des AMBIANCES (heure/ombrage/lumière), pas que des objets 3D.
- **Forward-compat rule**: `decodeShowcaseScene()` doit ignorer silencieusement tout champ inconnu dans le blob settings JSON. Les champs manquants sont remplacés par leur valeur par défaut du store. Le champ version dans le header est lu mais un client plus ancien ne doit pas rejeter un fichier de version supérieure.
- `src/lib/showcaseScene.ts`: `encodeShowcaseScene()` / `decodeShowcaseScene()` / `loadShowcaseScene(id)` implémentent exactement ce format.
- **Export UI** (`src/components/lidar/ShowcaseExport.tsx`): bouton "Exporter cette vue" → prend `lidarShaded`/`lidarMesh` courant + ambiance store + caméra (`map.getCenter/Zoom/Pitch/Bearing`) → `encodeShowcaseScene()` → Blob download `<id>.bin`. Génère AUSSI une vignette (canvas snapshot map → webp data-URL réduite ~KB) à coller dans le manifeste.
- **Loader** `loadShowcaseScene(id)`: `fetch(urlRelease)` → `decodeShowcaseScene()` → applique settings au mapStore (setters existants) → `showLidarCloudSnapshot(data)` → vol caméra. Court-circuite WFS/COPC/Poisson ET restitue l'ambiance. Si le fetch échoue (réseau, CORS, 404), afficher un toast d'erreur non-bloquant "Impossible de charger la scène [nom]" et laisser le studio dans son état courant ; ne pas propager l'exception au renderer.
- **Galerie** (`src/components/lidar/ShowcaseGallery.tsx`): lit `index.json`, vignettes cliquables → vol caméra + chargement instantané + ambiance. VIDE au départ (manifeste avec liste vide). Exposable comme état initial à l'ouverture du studio.
- `tools/showcase/bake.mjs` (OPTIONNEL, secondaire): voie batch headless. L'export UI est la voie principale.
- Réutilise `SavedCloud`/IndexedDB? Non — showcase = read-only servi depuis Release. Decode produit les MÊMES types → rendu identique.

**Dépendances à ajouter:** `meshoptimizer` (encoder côté export UI + decoder côté loader, lazy chunk). Pas de Draco.

## Future extension points (anticipés, hors scope phase 1 sauf indication)
- **Coupe falaise**: réutiliser `CliffBottomPanel` + `CliffSlicePathOverlay` (déjà lazy dans MapContainer) dans le bottom-strip slot. Map-click gating déjà géré par `bottomMode`.
- **Bookmarks / vues cinématiques**: nouveau store field + UI dans top bar slot; sérialise camera (center/zoom/pitch/bearing) + params LiDAR.
- **Mesures 3D**: left tool-rail; nécessite picking dans l'overlay WebGL (nouveau).
- **Export image HD/vidéo/3D**: top bar menu; capture canvas / flyover existant (`flyover.ts`).
- **Annotations**: left tool-rail + nouvelle source GeoJSON sur la map.

## Relevant files
- `src/main.tsx` — rendre `<Root/>`.
- `src/Root.tsx` (NEW) — switch de vue.
- `src/lib/useView.ts` (NEW) — hook routing search-param.
- `src/components/lidar/LidarStudio.tsx` (NEW) — shell dédié.
- `src/components/ui/lidar/*` (NEW) — briques contrôles extraites.
- `src/components/ui/LidarCloudPanel.tsx` — refactor en launcher compact + CTA studio.
- `src/components/map/MapContainer.tsx` — réutilisé tel quel (overlays gates par état store).
- `src/stores/mapStore.ts` — éventuel champ UI studio (clean-capture); minimal. `showLidarCloudSnapshot(data: LidarGeometrySnapshot): void` — fonction dans mapStore qui prend les buffers décodés (mêmes types que `lidarShaded`/`lidarMesh`) et les injecte directement dans le renderer sans repasser par le worker pipeline. Si elle n'existe pas encore, la créer en Phase 4 avant `ShowcaseGallery`. Réutilisée par le loader vitrine.
- `src/lib/showcaseScene.ts` (NEW) — format sérialisation compressé (meshopt) géométrie + ambiance + caméra ; `encodeShowcaseScene()` / `decodeShowcaseScene()` / `loadShowcaseScene(id)`.
- `src/components/lidar/ShowcaseExport.tsx` + `ShowcaseGallery.tsx` (NEW) — bouton "Exporter cette vue" (download .bin + vignette) et galerie lisant `index.json`.
- `tools/showcase/bake.mjs` (NEW, OPTIONNEL/secondaire) — voie batch headless ; l'export UI est la voie principale.
- `public/showcase/index.json` (NEW, SEUL fichier commité, ~KB) — manifeste: scènes + vignette + URL Release de chaque `.bin`. Les `.bin` vivent en GitHub Release assets (hors arbre git). Pas de Git LFS.

## Verification
1. `npm run lint` (type-check + SonarQube) — aucune erreur, complexité ≤ 15.
2. `npm run build` — bundle OK, studio + meshopt en chunks lazy séparés.
3. Manuel: `?view=lidar` ouvre le studio; "Charger ici" rend le nuage 3D; tous les réglages (mode, EDL, soleil, ombres, shader, classes, taille, opacité) agissent comme dans l'onglet; "Quitter" revient à la carte avec nuage conservé.
4. Manuel: launcher compact fonctionne toujours (mêmes briques) + CTA ouvre le studio.
5. Manuel: `#share=` et hash map non cassés; mobile drawer utilisable.
6. Manuel (Phase 4): export → `.bin` + vignette téléchargés ; après upload Release + entrée manifeste, la galerie recharge la scène avec **ambiance + caméra** restituées, sans WFS/COPC. Vérifier que le CDN Release renvoie `Access-Control-Allow-Origin: *` (fetch cross-origin OK).
7. Vérifier que `.git` ne grossit pas: AUCUN `.bin` commité, seul `index.json` (~KB) versionné. Décodeur meshopt en chunk lazy.

## Scope boundaries
- INCLUS: routing, shell studio, réorganisation/extraction de TOUS les réglages existants, entrée/sortie, polish wow (clean-capture, auto-orbit, quick basemap), scaffolding des slots d'extension, format + loader + galerie d'export d'ambiances (Release assets).
- EXCLU (phases futures): implémentation effective de coupe falaise dans le studio, bookmarks, mesures, export image/vidéo, annotations. Le bake batch des scènes est optionnel (hors CI). Architecture prête à les recevoir.
