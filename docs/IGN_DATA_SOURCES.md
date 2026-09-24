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
| WFS BD TOPO® orographie    | `https://data.geopf.fr/wfs/ows`                | GET          | Noms des sommets — **hors ligne**, `tools/build-peaks.mjs` |
| WFS BD CARTO® orographie   | `https://data.geopf.fr/wfs/ows`                | GET          | Cotes des mêmes sommets — **hors ligne** |
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

> ⚠️ **L'application n'appelle plus ce service.** Les étiquettes de sommets du mode
> *Point de vue* lisent un fichier figé, `src/lib/peaksData.json`, produit une fois par
> [tools/build-peaks.mjs](../tools/build-peaks.mjs). Ce qui suit décrit ce que ce
> générateur fait, pas ce que fait l'app à l'exécution.

La couche `detail_orographique` existe dans **les deux** produits, avec le **même**
identifiant `cleabs`. C'est cette jointure qui porte toute la fonctionnalité, parce que
chacun des deux détient exactement une des deux informations nécessaires :

| | BD TOPO® V3 | BD CARTO® V5 |
|---|---|---|
| Objets sur toute la France | **33 001** aux natures retenues, `importance <= '4'` | 6 734 cotés |
| `importance` (notoriété `'1'`…`'6'`) | **oui** | non |
| `cote` (altitude relevée, entier) | **non** | **oui** |

Pourquoi hors ligne : la jointure est chère, sa réponse ne change jamais, et surtout elle
n'est qu'une partie du travail — la BD CARTO® ne couvre qu'un cinquième des sommets, et
aller chercher le reste dans OSM et GeoNames puis contrôler chaque valeur contre le
RGE ALTI® n'est pas payable à chaque déplacement de l'œil.

Deux extractions complètes, **sans `BBOX` du tout** — les deux produits ne contiennent que
la France, le filtre attributaire suffit :

```
GET https://data.geopf.fr/wfs/ows
  ?service=WFS
  &version=2.0.0
  &request=GetFeature
  &typenames=BDTOPO_V3:detail_orographique
  &srsname=EPSG:4326
  &outputFormat=application/json
  &propertyname=cleabs,toponyme,nature,importance,geometrie
  &count=4000&startIndex=…&sortby=cleabs
  &cql_filter=nature IN ('Sommet','Pic','Montagne','Rochers','Crête','Escarpement')
              AND importance <= '4'
```

```
GET https://data.geopf.fr/wfs/ows
  ?…
  &typenames=BDCARTO_V5:detail_orographique
  &propertyname=cleabs,cote
  &cql_filter=cote IS NOT NULL
```

**La pagination WFS 2.0 fonctionne** sur `data.geopf.fr` : `startIndex` avec
`sortby=cleabs` donne des pages disjointes et déterministes. 33 001 objets descendent en
neuf pages d'environ 1 Mo, 1,6 s chacune. `resulttype=hits` renvoie `numberMatched` sans
les données, pratique pour dimensionner.

> ⚠️ **Piège connu** : `bbox` et `cql_filter` sont **mutuellement exclusifs** sur
> `data.geopf.fr` (« bbox and cql_filter both specified but are mutually exclusive »).
> Dès qu'un filtre attributaire est nécessaire, l'emprise doit voyager **dans** le
> `cql_filter`, via l'opérateur `BBOX(...)`.

Demander `propertyname=cleabs,cote` sans la géométrie est délibéré : le WFS répond alors
`"geometry": null` — c'est une table de correspondance, pas une couche.

Ce qu'il faut savoir des couches :

- `nature` est une énumération : `Sommet`, `Pic`, `Montagne`, `Rochers`, `Crête`, `Col`,
  `Escarpement`, `Grotte`, `Vallée`… `Sommet` et `Pic` **sont** des sommets par définition.
  Les quatre autres natures désignent tantôt un point culminant (la Meije et la Grande Sure
  sont des `Montagne`, les Lances de Malissard des `Rochers`), tantôt une zone entière
  (« Massif de la Chartreuse », « les Grandes Rousses ») : **la présence d'une altitude,
  quelle qu'en soit la source**, est exactement ce qui distingue les deux, donc elles ne
  sont retenues que dans ce cas. 7 338 noms de zone sont écartés à ce titre.
- `importance` est une **chaîne** `'1'` à `'6'` (notoriété décroissante) ; la comparaison
  CQL doit donc être faite entre chaînes. Open-cairn s'arrête à `'4'` — au-delà, les points
  nommés sont des bosses locales invérifiables à 30 km.
- **La BD TOPO® ne porte aucune altitude**, et l'interroger via un MNT ne marche pas : le
  point du toponyme est placé pour accrocher une étiquette, pas sur le sommet. Relevé
  contre RGE ALTI® 1 m : Chamechaude −9 m, Grand Som −12 m, Mont Saint-Eynard −9 m,
  le Néron −183 m ; prendre le maximum local sur 400 m alentour n'en rattrape aucun.
  L'altitude doit donc venir d'une source qui la **publie** — cote BD CARTO®, OSM ou
  GeoNames — et le MNT ne sert qu'à arbitrer entre elles.
- **Environ un cinquième seulement** des sommets BD TOPO® retenus trouvent une cote
  BD CARTO® (6 734 cotes pour 33 001 objets). C'est ce qui a fait chercher ailleurs — voir
  la section suivante. Les sommets qu'aucune source ne cote sont étiquetés **sans
  altitude** : en randonnée, une altitude fausse est pire que pas d'altitude.
- ⚠️ **Une cote peut être rattachée au mauvais objet.** La valeur, elle, est exacte : le
  problème n'est pas la mesure mais ce à quoi elle est accrochée. La BD CARTO® donne à la
  « Grande Lance de Domène » (`PAIOROGR0000000007454902`, sommet réel 2790 m) la cote
  **2596** — celle de la *Petite* Lance de Domène, que la BD CARTO® généralisée ne contient
  pas. Les deux produits placent pourtant l'objet au bon endroit, où le RGE ALTI® lit
  2768 m, et le RGE ALTI® lit 2569 m au toponyme de la Petite Lance : la valeur 2596
  décrit bien un point réel, situé 700 m plus loin et 170 m plus bas.
- Ce n'est pas une anomalie isolée. Confrontée à un jeu de référence tiers, la cote
  BD CARTO® tombe à moins de 3 m de la référence sur **86,4 %** des 3 105 sommets où les
  deux existent — contre 99,9 % pour OSM et 88 % pour GeoNames. **Une cote sur sept est
  donc contestée**, ce qui a inversé l'ordre de confiance des sources : OSM d'abord.
- Le garde-fou vit désormais **dans le générateur**, contre RGE ALTI® 1 m et non contre le
  terrain affiché à ~10 m, et il est **bilatéral** :
  - une altitude qui passe **plus de 15 m sous le sol de son propre point** ne peut pas
    décrire ce sommet (`MAX_SURVEY_UNDERSHOOT_M`). La marge est large parce qu'un MNT peut
    réellement lire trop haut — névé, pylône que le filtrage terre-nue a laissé sur une
    cime étroite. Mesuré : ces cas-là ne sont justes que dans 73 % des cas contre 96 %
    pour le gros du lot ;
  - une altitude qui dépasse le sol de **plus de 400 m** ne le peut pas davantage
    (`MAX_SURVEY_OVERSHOOT_M`). Ce plafond est volontairement haut : dépasser le sol
    échantillonné est **normal**, le toponyme étant posé bas sur la pente, et la tranche
    150-400 m au-dessus est même la plus fiable du jeu (98 % puis 100 % de justesse).
    Au-delà de 400 m on retombe à 73 % : c'est là que la BD CARTO® accroche 1864 m à
    « Tête Compasses », dont le sol est à 1248 m et qu'OSM donne à 1263 m.

  Une valeur rejetée n'efface plus l'altitude : **la source suivante prend son tour**.
  Comptage France entière : 94 valeurs OSM, 80 BD CARTO® et 20 GeoNames écartées ainsi.
- La géométrie est un point en EPSG:4326, ordre **lng,lat**.
- Couverture **française** plus une mince bande transfrontalière (Mont Miravidi et Becca du
  Lac y sont, le Gran Paradiso non). Aucun sommet italien ou suisse profond n'est nommé.

Volumétrie mesurée de l'extraction complète : 33 001 objets BD TOPO® (neuf pages, ~9 Mo,
~15 s), 6 734 cotes BD CARTO®, 68 519 nœuds OSM, 4 018 entrées GeoNames, 32 777 points
RGE ALTI® (1100 requêtes de 30, six en vol, ~7 min). Sortie : **25 830 sommets, 391 ko
gzippés**.

##### Les autres sources d'altitude

Le Charmant Som n'a pas de cote BD CARTO® alors qu'il culmine à 1867 m, ce qui a fait
chercher ailleurs. Deux sources extérieures sont **retenues**, trois pistes internes ne le
sont pas.

**Retenues** — interrogées par `tools/build-peaks.mjs`, jamais par l'app :

| Source | Accès | Volume France | Justesse* |
|---|---|---|---|
| **OpenStreetMap** `natural=peak\|volcano` avec `ele` | Overpass API, POST `data=` | 68 519 nœuds | **99,9 %** (n = 9 219) |
| **GeoNames** classe `T`, codes `PK`/`MT`/`PKS` | `download.geonames.org/export/dump/FR.zip` | 4 018 entrées | 88 % (n = 1 952) |

\* part des valeurs à moins de 3 m d'un jeu de référence tiers. C'est la mesure qui a fixé
l'ordre des sources ; elle a été faite avec un appariement serré à 150 m, plus étroit que
celui qu'utilise le générateur.

- OSM donne **1867** au Charmant Som, confirmé indépendamment par `GEODESIE:data_geod` :
  borne granit gravée IGN 1949, `cp1_coord3` = 1867,1 m NGF-IGN69 à ±50 cm. Il donne
  **2790** à la Grande Lance de Domène, là où la cote dit 2596.
- ⚠️ Les 99,9 % d'OSM sont **partiellement circulaires** : le jeu de référence s'appuie
  lui-même sur OSM. Le chiffre qui ne souffre pas de ce biais est le 86,4 % de la
  BD CARTO®, qui ne partage aucune source avec la référence.
- Contre-épreuve indépendante d'OSM : les altitudes d'infobox de fr.wikipedia, via
  Wikidata (`P2044`), sur la Chartreuse et Belledonne, avec un script jetable (non
  conservé : deux massifs, c'est trop peu pour un outil — voir `TODO.md` pour une version
  nationale). À la première mesure, **45 des 47** sommets que les
  deux jeux cotent étaient à moins de 3 m, la Chartreuse à 25/25 exacts. Les deux écarts (Les
  Perrons 2521 contre 2537, Brame-Farine 1210 contre 1230) sont des **points secondaires
  de crête** que la BD TOPO® nomme comme le sommet entier : le RGE ALTI® interrogé à la
  coordonnée de Wikipédia y lit 2535,2 et 1222,7, donc c'est bien notre ancre qui est à
  côté, pas la cote qui est fausse. Relancé le 24/09/2026 : **46 sur 51**, avec trois nouveaux
  écarts en Chartreuse — le Grand Manti (1850 contre 1818, sol 1812,6), le roc de Gleisin
  (1460 contre 1434, sol 1431,0 à 6 m de notre point) et le mont Outheran (1686 contre
  1676, sol 1673,0).
- ⚠️ **Overpass refuse une requête sans `User-Agent`** (HTTP 406). Sa politique d'usage
  autorise ce genre d'extraction *ponctuelle* ; un usage récurrent, ou déclenché par les
  visiteurs d'un site, devrait passer par les extraits Geofabrik et `osmium`.
- L'appariement se fait par **nom normalisé + proximité**, aucune de ces sources n'ayant de
  `cleabs`. Le rayon est de **600 m**, et ce chiffre a demandé deux mesures. Prise seule,
  la distance accable les appariements lointains : au-delà de 600 m, 45 % seulement
  tombent juste — à cette distance, « Altenberg » est une autre colline alsacienne du même
  nom. Mais cette mesure précède le plafond de surhauteur, qui est ce qui écarte réellement
  les mauvais. Rayon balayé **avec** le garde-fou en place, la justesse et la couverture
  montent **ensemble** jusqu'à 600 m (97,6 → 98,0 % à moins de 3 m, 50 → 52 % de sommets
  cotés, queue au-delà de 100 m de 12 à 9 cas) puis ne bougent plus. Resserrer, en revanche,
  **dégrade** : à 50 m on tombe à 96,74 % à moins de 3 m, et la queue au-delà de 100 m ne
  bouge pas (9 à 12 quel que soit le rayon). Ces gros écarts ne sont donc pas causés par la
  distance, et un rayon serré ne les vise pas — il ne jette que des appariements corrects,
  parce que la BD TOPO® ancre *couramment* le nom d'une crête loin de son point haut.
- Au-delà de 600 m, un appariement n'est plus accepté sur sa seule distance mais sur
  **preuve** : `FAR_NAME_MATCH_M` = **1500 m**, à condition que le RGE ALTI® *sous le nœud
  lui-même* lise la cote qu'il publie à `NODE_GROUND_TOLERANCE_M` = **20 m** près. Cette
  bande est **bimodale**, et c'est ce qui rend le test possible : écart médian 6,7 m mais
  p90 à 339 m — la moitié des candidats se tient à quelques mètres de sa propre cote (le
  toponyme est simplement mal posé), l'autre désigne une montagne différente. Tenu contre
  les appariements de moins de 100 m, réputés bons, ce test en garde 88 % ; il admet ici
  **107 candidats sur 184**. Élargir bêtement le rayon à 800 m n'en aurait rapporté que 37,
  sans preuve et avec un gros écart de plus.
- Un nœud ainsi admis **donne aussi l'ancre** : sa position est mesurée, donc elle vaut mieux
  que tout ce que la marche en montée pourrait trouver.
- Licence OSM : **ODbL 1.0**. Un rendu à l'écran est une *Produced Work* — attribution
  suffisante ; un extrait redistribué est une *Derivative Database* et doit rester ODbL.
  `src/lib/peaksData.json` en contient, donc l'attribution OSM est due.

**Écartées** :

| Source | Ce qu'elle donne au Charmant Som | Verdict |
|---|---|---|
| `ELEVATION.CONTOUR.LINE:courbe` (courbes de niveau, attribut `altitude`) | plus haute courbe 1855 m | une borne inférieure, pas une altitude |
| RGE ALTI® 1 m au toponyme | 1863,46 m, et c'est bien le maximum local à 800 m | le MNT lit sous la valeur publiée ; sert de **contrôle**, pas de source |
| `GEODESIE:data_geod` (repères géodésiques) | borne en granit, `cp1_coord3` = **1867,1 m**, précision < 50 cm, à 11 m du toponyme | juste ici, mais inexploitable en général |

Le RGE ALTI® mérite une précision : il **est** utilisé par le générateur, mais jamais
comme source d'altitude — comme **juge** de celles qu'on lui propose, et comme **arpenteur**
pour replacer le point. Le toponyme est posé pour accrocher une étiquette sur une carte, pas
sur le sommet : relevé contre RGE ALTI® 1 m, Chamechaude est à −9 m, le Grand Som à −12 m,
le Mont Saint-Eynard à −9 m, le Néron à −183 m. Il ne peut donc pas *fournir* une altitude,
seulement en *réfuter* une.

#### Remonter les ancres sur leur sommet

« Rocher de Chalves » est ancré **619 m au sud** de sa cime, sur un sol à 1689 m alors que
son étiquette affiche 1845 m : le trait de rappel du panorama désignait une épaule. PeakFinder
évite ça en calant chaque POI sur le nœud de MNT le plus haut du voisinage
(`lookupHighestElevation`). `tools/build-peaks.mjs` fait de même, avec un avantage : **la cote
publie la cible**, donc la marche sait où s'arrêter au lieu d'errer vers un voisin plus haut.
Quand un appariement lointain a déjà prouvé sa position, elle est prise telle quelle et la
marche n'a pas lieu — une position mesurée vaut mieux qu'une position cherchée.

- **Qui est recalé** : tout sommet dont la cote dépasse de plus de `ANCHOR_DRIFT_M` = **40 m**
  le sol lu sous son toponyme, et dont l'ancre n'est pas déjà connue par un appariement
  lointain prouvé. Ce critère en désigne **1 301** ; aucun nom n'est écrit en dur.
- **Comment** : 8 sondes à 250 m, on saute sur la plus haute, on réduit le pas quand aucune ne
  monte, on s'arrête à 5 m de la cote. Les sondes sont **arrondies à 6 décimales** — en pleine
  précision, un lot fait une URL que le service refuse en HTTP 414.
- **Deux garde-fous**. Passé `MAX_ANCHOR_MOVE_M` = **2 km**, le déplacement est abandonné.
  Et une marche qui **cale à plus de 40 m sous sa cible** a trouvé un ressaut, pas une cime :
  elle garde aussi l'ancienne ancre. Le Néron a montré pourquoi — sur une crête étroite, la
  montée guidée converge vers le maximum local le plus proche, et elle avait fini à 1178,8 m
  pour une cible de 1298, en s'éloignant du sommet (743 m contre 618 au départ). **225**
  marches sont ainsi abandonnées, **1 076** aboutissent.
- **Résultat** : Rocher de Chalves atterrit à 625 m de son toponyme, sur un sol à 1842,9 m pour
  une cote de 1845 — à 6 m du nœud OSM « Rochers de Chalves », que la marche n'a jamais
  consulté. Les altitudes ne se dégradent pas (98,0 % à moins de 3 m) et l'appariement à la
  référence s'améliore (10 158 → **10 210** exacts).
- ⚠️ **Une cote fausse déplace l'ancre sur le mauvais sommet.** Le Grand Manti porte 1850 m
  là où Wikipédia dit 1818 : la marche a poursuivi cette cible et s'est éloignée de 355 m du
  bon point. C'est borné par les 2 km, mais réel.
- Le cercle vicieux des sommets sans cote — la cote manque *parce que* l'ancre est loin, et
  l'ancre reste loin *parce que* la cote manque — est rompu par l'appariement lointain
  prouvé, qui donne les deux d'un coup. Le Néron passe de « sans altitude » à **1298 m ancrés
  à 0 m du sommet**, le mont Rachais à 1046 m (+1013 m) et le mont Outheran à 1686 m
  (+1019 m). La contre-épreuve Wikipédia passe de **5 sommets sans cote à 2**.

Service d'altimétrie, tel qu'appelé par le générateur :

```
GET https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json
  ?lon=5.76417|5.78806|…&lat=45.32501|45.28781|…
  &resource=ign_rge_alti_wld&delimiter=|&zonly=true
```

⚠️ **GET uniquement** : le service répond **500** à un POST form-encodé, et **414** au-delà
d'environ 250 points dans l'URL. En POST JSON il accepte 5000 points, mais ça ne sert à rien
ici — voir le piège ci-dessous.

⚠️ **Au-delà de 31 points, le service cesse de lire le MNT point par point.** Il rastérise
la boîte englobante de la requête, à une résolution qui suit cette boîte, **sans le dire** :
pas d'erreur, pas d'avertissement, juste des valeurs lissées. Mesuré sur le Néron, dont le
sol vaut 1297,17 m :

| étendue du lot | ≤ 30 points | ≥ 32 points |
|---|---|---|
| 0,1° (~11 km) | 1297,17 | 1297,17 |
| 0,25° (~28 km) | 1297,17 | 1294,71 |
| 1° (~111 km) | 1297,17 | 1278,27 |
| 2° (~222 km) | 1297,17 | 1240,99 |

Le seuil en nombre de points est net entre **30 et 32**, et au-delà la valeur ne dépend plus
que de l'étendue. Le générateur envoyait 200 toponymes éparpillés sur toute la France par
requête : **13,3 % des sols étaient faux de plus de 10 m, jusqu'à 175 m**, et les Pyrénées
étaient intactes uniquement parce que leurs toponymes tombaient dans un lot déjà groupé.

Deux parades, une seule tenable. **Trier spatialement** pour garder des boîtes sous 0,1° a
été mesuré *pire* : les sommets sont trop épars, une boîte de 0,1° en contient quatre, soit
5951 requêtes. Des **lots de 30 sans tri** en font 1100 et sont exacts quelle que soit
l'étendue. Le coût n'est pas le volume mais la latence — 1100 requêtes en série à 2,7 s font
49 minutes — donc `ALTI_CONCURRENCY` en garde **6** en vol : la reconstruction retombe à
2 min 30.

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

Six points de couverture contre une jointure sans identifiant et une classe d'erreurs de
2 à 19 m : la base géodésique reste hors du périmètre. Le coût de la requête, lui, n'est
plus un argument depuis que tout se passe hors ligne — c'est la **nature** de la donnée
qui l'écarte, pas son poids. Elle reste le meilleur **témoin indépendant** disponible
pour contrôler une valeur au cas par cas.

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
- **OpenStreetMap** : `src/lib/peaksData.json` contient des altitudes issues d'OSM, donc
  **ODbL 1.0** s'applique — attribution « © les contributeurs OpenStreetMap », mention de
  la licence, et partage à l'identique si le fichier est redistribué comme base de
  données. Un simple affichage à l'écran reste une *Produced Work* : l'attribution suffit.
- **GeoNames** : CC BY 4.0, attribution due de la même façon.
