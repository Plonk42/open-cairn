# Sources de données IGN

Open-cairn n'utilise **que** les services publics de la
[Géoplateforme IGN](https://geoservices.ign.fr/) (`data.geopf.fr`). Aucune donnée n'est
hébergée par le projet ; toutes les requêtes partent du navigateur de l'utilisateur.

## Pour les utilisateurs

La quasi-totalité des données est en accès libre, sans inscription. Quelques couches
(SCAN 25, Plan IGN HD, MNT haute résolution interpolé linéaire) demandent une clé d'API que
vous pouvez saisir dans **Réglages → Clés API IGN**. La demande de clé se fait
gratuitement sur [geoservices.ign.fr](https://geoservices.ign.fr/services-geoplateforme).

Toutes les données restent la **propriété de l'IGN** ; leur usage est régi par les
[conditions de la Géoplateforme](https://geoservices.ign.fr/cgu-licences).

## Pour les développeurs

### Tableau récapitulatif

| Service                    | Endpoint                                        | Méthode      | Usage open-cairn                       |
|---------------------------|-------------------------------------------------|--------------|----------------------------------------|
| WMTS public                | `https://data.geopf.fr/wmts`                   | GET tuile    | Plan IGN, Ortho, CoSIA, OSM, LiDAR HD ombrage |
| WMTS privé (clé)           | `https://data.geopf.fr/private/wmts`           | GET tuile    | SCAN 25, Plan IGN HD               |
| WMS-r privé (clé)          | `https://data.geopf.fr/private/wms-r`          | GetMap       | DEM TerrainRGB haute résolution         |
| Navigation                 | `https://data.geopf.fr/navigation/itineraire`  | GET          | Calcul itinéraire piéton (bdtopo-osrm)  |
| Altimétrie                 | `https://data.geopf.fr/altimetrie/1.0/.../elevationLine.json` | POST | Profil altimétrique                    |
| Géocodage — completion     | `https://data.geopf.fr/geocodage/completion`   | GET          | Autocomplétion adresse / POI            |
| Géocodage — search         | `https://data.geopf.fr/geocodage/search`       | GET          | Recherche full text                     |
| WFS dalles LiDAR HD        | `https://data.geopf.fr/wfs/ows`                | GET          | Découverte des tuiles COPC LAZ couvrant un bbox |
| Stockage COPC LAZ          | URLs publiques retournées par le WFS            | GET (Range)  | Téléchargement par byte-range des nœuds octree |

### Détails par service

#### WMTS

URL builder : `ignWmtsUrl(layerId, format, isPrivate, apiKey?)` dans
[src/lib/ign.ts](../src/lib/ign.ts).

Le format est `image/png` pour la plupart des couches sauf `image/jpeg` pour les ortho-photos.
Les plages de zoom (`minZoom`, `maxZoom`) sont définies par couche dans le même fichier.

La couche `cosia` pointe sur `IGNF_COSIA_2021-2023` et non sur le millésime 2024-2026 :
ce dernier est déployé département par département et renvoie des tuiles entièrement
transparentes sur une partie des Alpes. Zooms servis : 6 à 18 (z19 renvoie 404).

CoSIA a **deux** usages dans l'app :

1. fond de carte à part entière (sélecteur *Fond*) ;
2. source d'un attribut du rendu LiDAR — la classe d'occupation du sol est cuite
   par sommet à la capture (`src/lib/lidarBrowser/cosia.ts`, voir
   `docs/LIDAR_PIPELINE.md`) pour arbitrer sol nu / pelouse / forêt dans la palette
   `terrain`.

La table des couleurs → classes a dû être relevée **empiriquement** (histogrammes
sur douze sites témoins) : `GetLegendGraphic` répond `OperationNotSupported` sur
`data.geopf.fr/wms-r` pour cette couche. Les treize entrées et leur site témoin
sont documentés dans `COSIA_CLASSES`.

#### Navigation

```
GET https://data.geopf.fr/navigation/itineraire
  ?resource=bdtopo-osrm
  &profile=pedestrian
  &optimization=shortest
  &start=lng,lat
  &end=lng,lat
  &getSteps=false
  &timeUnit=second
```

Réponse : GeoJSON `LineString` + `distance` (m) + `duration` (s).

#### Altimétrie

`POST https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevationLine.json`

Body :

```json
{ "lon": "x|y|z", "lat": "x|y|z", "sampling": 200, "resource": "ign_rge_alti_wld" }
```

**Limite** : 1500 coordonnées par requête. Open-cairn découpe automatiquement les longues
routes et fusionne les profils (cf. [elevation.ts](../src/lib/elevation.ts)).

#### Géocodage

Sans clé, deux endpoints :

```
GET /geocodage/completion?text=Q&maximumResponses=8&type=PositionOfInterest,StreetAddress
GET /geocodage/search?q=Q&limit=N&index=address,poi
```

#### WFS LiDAR HD

```
GET https://data.geopf.fr/wfs/ows
  ?service=WFS
  &version=2.0.0
  &request=GetFeature
  &typenames=IGNF_LIDAR-HD_METADONNEE:metadata
  &srsname=EPSG:4326
  &bbox=minLng,minLat,maxLng,maxLat,EPSG:4326
  &count=8
```

> ⚠️ **Piège connu** : malgré `srsname=EPSG:4326`, l'axe-order du paramètre `bbox` est
> **lng,lat** (et non lat,lng comme l'EPSG le voudrait). Voir [wfs.ts](../src/lib/lidarBrowser/wfs.ts).

Réponse : GeoJSON dont chaque feature porte, dans la propriété `url_npl`, l'URL de la
dalle COPC LAZ (typiquement 500 MB à 2 GB) hébergée sur le CDN IGN. Les propriétés
voisines `url_mnt` / `url_mns` / `url_mnh` sont des rasters WMS, pas des nuages de points.

#### COPC LAZ

Format **Cloud Optimized Point Cloud** (COPC) basé sur LAZ 1.4. La librairie
[`copc.js`](https://www.npmjs.com/package/copc) lit l'en-tête + l'octree (VLR + EVLR),
puis on fait des **HTTP-Range requests** sur les nœuds qui intersectent la bbox demandée.
Cela évite de télécharger 1 GB pour rendre 100 m².

Le décodeur LAZ proprement dit est [`laz-perf`](https://www.npmjs.com/package/laz-perf)
en WebAssembly.

### Limites de débit

L'IGN rate-limite les requêtes byte-range agressives :

- HTTP **429 Too Many Requests** au-delà de quelques requêtes parallèles, et
  connexion coupée (`Failed to fetch` côté navigateur) quand le service sature
- Open-cairn limite à **4 requêtes byte-range concurrentes** et à **8 par
  seconde**, globalement et non par dalle (sémaphore et fenêtre glissante dans
  [rateLimiter.ts](../src/lib/lidarBrowser/rateLimiter.ts))
- Reprise exponentielle sur les deux cas : 1 s / 2 s / 4 s / 8 s, jusqu'à
  5 tentatives ([rangeGetter.ts](../src/lib/lidarBrowser/rangeGetter.ts))

### Conditions d'utilisation et attribution

- **Attribution** : afficher au minimum « © IGN » dans tout produit dérivé.
- **Pas d'usage commercial** sans souscription IGN appropriée pour les couches privées.
- **Volume raisonnable** : la Géoplateforme est conçue pour un usage applicatif normal,
  pas pour le scraping massif. Open-cairn cache agressivement côté client (HTTP cache
  pour les tuiles, IndexedDB pour les nuages LiDAR) pour éviter de retaper l'API.
