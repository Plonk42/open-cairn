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
| Tuiles vectorielles        | `https://data.geopf.fr/tms/1.0.0/PLAN.IGN`     | GET tuile    | Surcouche de toponymes du Plan IGN HD   |
| Polices vectorielles       | `https://data.geopf.fr/annexes/ressources/vectorTiles/fonts` | GET | `glyphs` du style MapLibre (tous les libellés) |
| Sprite vectoriel           | `https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/sprite/PlanIgn` | GET | Pictogrammes des toponymes |
| Navigation                 | `https://data.geopf.fr/navigation/itineraire`  | GET          | Calcul itinéraire piéton (bdtopo-osrm)  |
| Altimétrie                 | `https://data.geopf.fr/altimetrie/1.0/.../elevationLine.json` | POST | Profil altimétrique                    |
| Géocodage — completion     | `https://data.geopf.fr/geocodage/completion`   | GET          | Autocomplétion adresse / POI            |
| Géocodage — search         | `https://data.geopf.fr/geocodage/search`       | GET          | Recherche full text                     |
| WFS dalles LiDAR HD        | `https://data.geopf.fr/wfs/ows`                | GET          | Découverte des tuiles COPC LAZ couvrant un bbox |
| WFS BD TOPO® orographie    | `https://data.geopf.fr/wfs/ows`                | GET          | Noms des sommets visibles depuis un point de vue |
| WFS BD CARTO® orographie   | `https://data.geopf.fr/wfs/ows`                | GET          | Cotes (altitudes relevées) des mêmes sommets |
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

#### WFS orographie — BD TOPO® **et** BD CARTO®

Alimente les étiquettes de sommets du mode *Point de vue*
([src/lib/peaks.ts](../src/lib/peaks.ts), voir `docs/UI_SHELL_AND_RESPONSIVE.md`).

La couche `detail_orographique` existe dans **les deux** produits, avec le **même**
identifiant `cleabs`. C'est cette jointure qui porte toute la fonctionnalité, parce que
chacun des deux détient exactement une des deux informations nécessaires :

| | BD TOPO® V3 | BD CARTO® V5 |
|---|---|---|
| Densité (boîte de 60 km, Chartreuse/Vercors) | ~790 objets à `importance <= '4'` | ~130 objets cotés |
| `importance` (notoriété `'1'`…`'6'`) | **oui** | non |
| `cote` (altitude relevée, entier) | **non** | **oui** |

Deux requêtes, tirées en parallèle sur la même emprise :

```
GET https://data.geopf.fr/wfs/ows
  ?service=WFS
  &version=2.0.0
  &request=GetFeature
  &typenames=BDTOPO_V3:detail_orographique
  &srsname=EPSG:4326
  &outputFormat=application/json
  &propertyname=cleabs,toponyme,nature,importance,geometrie
  &count=4000
  &cql_filter=nature IN ('Sommet','Pic','Montagne','Rochers','Crête','Escarpement')
              AND importance <= '4'
              AND BBOX(geometrie,minLng,minLat,maxLng,maxLat,'EPSG:4326')
```

```
GET https://data.geopf.fr/wfs/ows
  ?…
  &typenames=BDCARTO_V5:detail_orographique
  &propertyname=cleabs,cote
  &cql_filter=cote IS NOT NULL
              AND BBOX(geometrie,minLng,minLat,maxLng,maxLat,'EPSG:4326')
```

> ⚠️ **Piège connu** : `bbox` et `cql_filter` sont **mutuellement exclusifs** sur
> `data.geopf.fr` (« bbox and cql_filter both specified but are mutually exclusive »).
> Dès qu'un filtre attributaire est nécessaire, l'emprise doit voyager **dans** le
> `cql_filter`, via l'opérateur `BBOX(...)`.

Demander `propertyname=cleabs,cote` sans la géométrie est délibéré : le WFS répond alors
`"geometry": null`, et la seconde requête ne pèse que ~17 kB — c'est une table de
correspondance, pas une couche.

Ce qu'il faut savoir des couches :

- `nature` est une énumération : `Sommet`, `Pic`, `Montagne`, `Rochers`, `Crête`, `Col`,
  `Escarpement`, `Grotte`, `Vallée`… `Sommet` et `Pic` **sont** des sommets par définition.
  Les quatre autres natures désignent tantôt un point culminant (la Meije et la Grande Sure
  sont des `Montagne`, les Lances de Malissard des `Rochers`), tantôt une zone entière
  (« Massif de la Chartreuse », « les Grandes Rousses ») : **la présence d'une cote** est
  exactement ce qui distingue les deux, donc elles ne sont retenues que dans ce cas.
- `importance` est une **chaîne** `'1'` à `'6'` (notoriété décroissante) ; la comparaison
  CQL doit donc être faite entre chaînes. Open-cairn s'arrête à `'4'` — au-delà, les points
  nommés sont des bosses locales invérifiables à 30 km.
- **La BD TOPO® ne porte aucune altitude**, et l'interroger via un MNT ne marche pas : le
  point du toponyme est placé pour accrocher une étiquette, pas sur le sommet. Relevé
  contre RGE ALTI® 1 m : Chamechaude −9 m, Grand Som −12 m, Mont Saint-Eynard −9 m,
  le Néron −183 m ; prendre le maximum local sur 400 m alentour n'en rattrape aucun.
  La `cote` BD CARTO®, elle, est juste au mètre (Chamechaude 2082, Dent de Crolles 2062,
  Grand Som 2026, Grande Sure 1920). C'est elle ou rien.
- **Environ un tiers seulement** des sommets BD TOPO® trouvent une cote (35 % des `Sommet`,
  42 % des `Pic`). Les autres sont étiquetés **sans altitude** : en randonnée, une altitude
  fausse est pire que pas d'altitude.
- ⚠️ **Une cote peut être rattachée au mauvais objet.** La valeur, elle, est exacte : le
  problème n'est pas la mesure mais ce à quoi elle est accrochée. La BD CARTO® donne à la
  « Grande Lance de Domène » (`PAIOROGR0000000007454902`, sommet réel 2790 m) la cote
  **2596** — celle de la *Petite* Lance de Domène, que la BD CARTO® généralisée ne contient
  pas. Les deux produits placent pourtant l'objet au bon endroit, où le RGE ALTI® lit
  2768 m, et le RGE ALTI® lit 2569 m au toponyme de la Petite Lance : la valeur 2596
  décrit bien un point réel, situé 700 m plus loin et 170 m plus bas.
- Confrontées au terrain sur la boîte de 60 km, **6 cotes sur 179 passent sous le sol de
  leur propre point** : de 155, 23, 23 et 20 m sur quatre sommets, puis de 10 et 9,7 m sur
  deux autres, puis jamais plus de 1,7 m. `sightPeaks` coupe à **15 m**
  (`MAX_SURVEY_UNDERSHOOT_M`) et le nom s'affiche alors nu. La marge est large parce qu'un
  MNT peut réellement lire trop haut — névé au moment de la prise de vue, pylône que le
  filtrage terre-nue a laissé sur une cime étroite (Mont du Chat et Dôme des Petites
  Rousses, les deux cas à 10 m, sont précisément de ce genre) — alors qu'aucune erreur de
  MNT n'explique 20 m sur du rocher dégagé. ⚠️ **Seul le cas de la Grande Lance est prouvé**
  comme un mauvais rattachement ; pour les trois autres on constate l'incohérence sans
  savoir laquelle des deux sources a tort, et c'est pourquoi on n'affiche rien plutôt que
  de corriger quoi que ce soit.
- La géométrie est un point en EPSG:4326, ordre **lng,lat**.
- Couverture **française** plus une mince bande transfrontalière (Mont Miravidi et Becca du
  Lac y sont, le Gran Paradiso non). Aucun sommet italien ou suisse profond n'est nommé.

Volumétrie mesurée : une boîte de ±80 km autour de Chamonix renvoie 1655 sommets à
`importance <= '4'` ; une boîte de 60 km sur la Chartreuse, ~790 objets (206 kB) côté
BD TOPO® et 131 cotes (17 kB) côté BD CARTO®.

##### Les autres pistes d'altitude, et pourquoi elles sont écartées

Le Charmant Som n'a pas de cote BD CARTO® alors qu'il culmine à 1867 m, ce qui a fait
chercher ailleurs. Aucune des trois pistes suivantes n'est retenue :

| Source | Ce qu'elle donne au Charmant Som | Verdict |
|---|---|---|
| `ELEVATION.CONTOUR.LINE:courbe` (courbes de niveau, attribut `altitude`) | plus haute courbe 1855 m | une borne inférieure, pas une altitude |
| RGE ALTI® 1 m au toponyme | 1863,46 m, et c'est bien le maximum local à 800 m | le MNT terrain lit 3,5 m sous la valeur publiée |
| `GEODESIE:data_geod` (repères géodésiques) | borne en granit gravée IGN (1949), `cp1_coord3` = **1867,1 m** NGF-IGN69, précision < 50 cm, à 11 m du toponyme | juste ici, mais inexploitable en général |

La base géodésique mérite le détail, parce qu'elle a l'air d'être la solution :

- `cp1_coord3` est l'altitude **du repère**, pas du sol. Sur la boîte de 60 km, 55 sommets
  ont à la fois une cote et un repère à moins de 20 m : écart médian 0,45 m, mais 10 sur 55
  au-delà de 1 m et 3 au-delà de 3 m, parce que le repère est parfois une croix sommitale
  (Pointe d'Arcalod 2219,50 contre 2217), un calvaire (Grand Som 2033,43 contre 2026), une
  terrasse de bâtiment (Mont du Chat 1500,90 contre 1482) ou un boulon de pylône de téléski.
  Filtrer sur le texte libre `type` (`Rocher`, `Borne`…) ramène les écarts > 3 m à 1 sur 49,
  mais c'est une expression régulière sur un libellé français : elle cassera en silence.
- La jointure se ferait **par proximité**, la base géodésique n'ayant pas de `cleabs`.
- Coût : 1874 points et 350 kB sur la boîte de 60 km avec `domaine <> 'nivf'` — sans ce
  filtre, les repères de nivellement le long des routes saturent la réponse à 5000 objets
  et 15 Mo. C'est plus lourd que la requête BD TOPO® elle-même.
- Gain : +48 sommets cotés sur 794, soit 179 → 227 (22,5 % → 28,6 %).

Six points de couverture contre une troisième requête plus lourde que les deux autres, une
jointure sans identifiant et une classe d'erreurs de 2 à 19 m : la base géodésique reste
hors du périmètre.

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
