# TODO

- [ ] **L'estimation de taille de téléchargement LiDAR est très en dessous du réel** :
      annoncé « Qualité détail 20 cm ≈ 73 Mo téléchargés · ≈ 21 min 35 · 21,2 M sommets »,
      constaté en cours de capture « 0/4 dalles · 91,2 / 250,0 Mo » — plus de 3× l'estimation,
      avant même la fin. `estimateCapture` (`src/lib/lidarResolution.ts`) et son usage dans
      `LidarCaptureControls.tsx` (l. 239-264, 384-413) et `lidarQuality.ts` s'appuient sur une
      densité de points par pyramide de résolution (`ESTIMATED_PYRAMID` / `VERCORS_PYRAMID`) qui
      ne reflète apparemment pas le volume réel téléchargé par dalle COPC — à mesurer sur des
      captures réelles multi-dalles et recaler la loi (ou le facteur bytes/point).
- [ ] **« Dégradé feuillage » rend la couleur trop foncée.** Le slider `u_vegIntensity`
      (`LidarAppearanceControls.tsx` l. 939) module `gradAmt` dans `points.vert` (l. 315-341) :
      hors essence, `mix(baseCol, vegRamp(a_height, u_vegHeightScale), gradAmt)` — à vérifier
      si `vegRamp`/`vegRampColor` (l. 89-130) assombrit trop le bas du dégradé (tronc) par
      rapport à la teinte de base ; en mode essence le mélange se fait avec
      `speciesHeightShade` (l. 137, 330), possiblement avec le même travers.
- [ ] **« Ombrage par normale » (végétation) à vérifier : l'effet semble s'estomper à 50 %**,
      avec un rendu à 50 % proche à la fois de 0 % et de 100 %. Slider `u_vegNormalShade`
      (`LidarAppearanceControls.tsx` l. 992-996) → `points.frag` l. 74-86 : `vegNorm`,
      `flatMod = mix(1.0, v_flatDiff, vegNorm)` et `flatVeg = max(u_flatLight, 1.0 - u_vegNormalShade)`
      se combinent de façon non monotone ou non perceptuellement linéaire — à tracer/mesurer
      sur un feuillage fixe aux trois valeurs (0, 50, 100 %).
- [ ] Les heures de lever/coucher du soleil et de la lune (`SkyLabelsOverlay`) marchent
      encore l'horizon avec `demSampler`, donc sur le cache de tuiles : hors du cadre,
      MapLibre répond depuis un ancêtre jusqu'à z5 (mesuré 396 m trop bas en médiane pour
      les sommets). Un azimut de lever hors champ peut donc lire une crête lissée. Les
      noms de sommets ne lisent plus que les tuiles dessinées (`renderedGroundSampler`) ;
      pour le ciel, dont les croisements sont souvent hors champ, il faudrait un MNT propre.
- [ ] `settleOnGround` (`ViewpointController`) lit le sol sous l'œil par
      `queryTerrainElevation`, qui retombe sur la même lecture du cache quand l'œil est
      sous le cadre — non vérifié si la hauteur d'œil s'en trouve faussée.
- [ ] **L'Itinéraire mobile garde ses *bottom sheets*** alors que le desktop est passé à
      l'accordéon (`RouteSidePanel`). Pour le Studio, la divergence est tranchée
      (`DECISIONS.md` : il garde ses feuilles) ; pour l'Itinéraire, c'est l'état de fait,
      pas encore un choix écrit.
- [ ] La caméra traverse le relief en rotation hors *Point de vue*, et ce n'est pas une
      désactivation de notre part : `Camera._elevateCameraIfInsideTerrain` est bien la
      méthode d'origine partout ailleurs. Mais ce garde vise `camAlt == ground`,
      **marge nulle**, et n'y arrive même pas : itéré quatre fois il est un **point fixe à
      −0,29 m** (même pitch 77,22°, même zoom 16,486, caméra déplacée de 0 m). Il ne teste
      qu'un échantillon bilinéaire sous la caméra — jamais le terrain *entre* l'œil et le
      centre, jamais le maillage de triangles réellement dessiné, qui le dépasse de plusieurs
      mètres sur un versant. Mesuré sur un tour complet à z16,5 / pitch 80 : **12 images sur
      60 sous le sol** en 5.11, **3 sur 60** en 6.10 (au-dessus de Saint-Martin-le-Vinoux,
      5.7735 / 45.2525, pitch 71° ↔ 78,8°) parce que le garde réécrit *pitch et zoom* au
      lieu de reculer la caméra. **Essayé** (branche `todo/terrain-camera-guard-wip`) : un
      garde à nous qui ne touche qu'au zoom, recule l'œil le long de sa visée jusqu'à
      dépasser de la profondeur du plan proche (7,6 m à z16,5) le plus haut de cinq sondes.
      Le pitch tient à 80° et plus aucune image n'est sous le sol, mais au même endroit
      il faut reculer **×3,02 (z16,5 → z14,9)** : le versant derrière l'œil monte plus
      vite que la ligne de visée (10°), et seule la crête au-delà le dégage. Le zoom
      corrigé est ensuite figé à chaque `moveend`, comme l'était le pitch. À trancher :
      ne toucher qu'au zoom coûte parfois bien plus de cadrage que le pitch réécrit ; un
      mélange (reculer jusqu'à un plafond, puis relever) reste à écrire.
- [ ] Le recalage du point de station au point haut à 50 m lit `queryTerrainElevation` au
      zoom du clic : depuis une vue d'ensemble (z12–13), le MNT est grossier et le « point
      haut » est souvent juste le bord amont du disque. Sur un long versant, le disque ne
      contient de toute façon aucun sommet (mesuré : +34 m sur une pente à 60 %, le sol
      remplit encore le cadre). Pistes : sonder au zoom du MNT le plus fin chargé, ou
      élargir le rayon quand le maximum tombe sur le bord.
- [ ] Le recalage peut franchir une barre : au pied de Chamechaude il monte de 117 m pour
      50 m. Voulu pour un panorama, mais surprenant si l'on visait le pied de la falaise.
- [ ] Le champ de vision ne dicte encore que le *placement*, pas la *visée* : resserrer
      le champ ne peut faire apparaître que des sommets déjà marchés. La portée des rangs 1
      et 2 est montée à 150/100 km, ce qui remplit le budget (831 candidats sur 900 depuis
      Belledonne) ; aller plus loin demande de ne plus marcher tout le cercle mais le seul
      secteur regardé. Chiffré : une table `[0, 200, 150, 60, 20]` donne 1 322 candidats sur
      360° — hors budget — mais **210** dans un secteur de 37°. La marche ne paie déjà plus
      que les sommets sur tuiles dessinées, à chaque arrêt de la caméra où elles changent ; reste à
      filtrer par azimut dans `selectCandidates` *avant* le plafond de 900, qui coupe
      aujourd'hui le cercle entier.
- [ ] Une cote fausse déplace l'ancre sur le mauvais sommet : Le Grand Manti porte 1850 m
      (Wikipédia dit 1818) et la marche s'est éloignée de 355 m du bon point. Rejeter le
      recalage quand le sol d'arrivée dépasse la cote, ou quand la marche a traversé un col.
- [ ] La montée guidée converge vers le maximum local le plus proche : 225 marches calent
      à plus de 40 m sous leur cible et gardent leur ancre d'origine. Sur une crête étroite
      elle peut même s'éloigner du sommet. Piste : élargir le rayon de départ au lieu de le
      réduire quand aucune sonde ne monte, ou sonder deux couronnes.
- [ ] Mont Saint-Eynard et aiguilles de l'Argentière restent sans cote : leur homonyme est
      au-delà de `FAR_NAME_MATCH_M`, ou son sol ne confirme pas sa cote à 20 m près.
- [ ] La signature de cache ne capture que des constantes et des données, pas le code : avoir
      changé la *forme* de la valeur de `farmatches` sans toucher à la signature a fait relire
      un cache incompatible en silence, et perdu 71 cotes sans aucune erreur. Un numéro de
      forme est présent dans la signature de `farmatches`, mais rien ne l'impose ailleurs.
- [ ] Rocher de Lorzier (1838 m, nature `Rochers`, importance 2) est écarté faute d'altitude
      dans toutes les sources, alors que PeakFinder le nomme depuis Chamechaude. Vérifier
      combien de sommets notables sont perdus par cette règle.
- [ ] Le test d'occultation est plus strict que celui de PeakFinder à courte distance :
      `SELF_CLEARANCE` est une *fraction* de la distance (60 m à 4 km, 900 m à 60 km) là où
      PeakFinder pardonne un obstacle à moins de 1 400 m fixes du sommet visé.
- [ ] La contre-épreuve Wikidata (cote contre `P2044`, arbitrée par le RGE ALTI® à la
      coordonnée de Wikidata) voit deux cotes fausses que le garde de `build-peaks.mjs`
      laisse passer : le roc de Gleisin porte 1460 m là où Wikipédia dit 1434 et le
      RGE ALTI® lit 1431,0 à 6 m de notre point ; le mont Outheran 1686 contre 1676 (sol
      1673,0). Toutes deux sont *au-dessus* du sol, dans la marge de
      `MAX_SURVEY_OVERSHOOT_M` (400 m) : trouver quelle source les fournit, et si un
      sommet dont l'ancre est déjà au point haut devrait être tenu plus serré.
- [ ] Faire de cette contre-épreuve Wikidata une validation **nationale**. Faite une fois
      sur la Chartreuse et Belledonne (51 sommets sur ~25 800, script non conservé), c'est
      le seul contrôle qui ne dépende pas d'OSM — la référence de `verify-peaks.mjs` s'appuie
      dessus — ni d'une donnée hors dépôt. Le principe : requêtes SPARQL `wikibase:box`
      (`wdt:P31/wdt:P279* wd:Q8502`, `wdt:P2044`) sur un découpage de la France (le service
      coupe à 60 s par requête), appariement par nom normalisé à moins de 2,5 km, sol
      RGE ALTI® par lots de **30** points (au-delà de 31 le service rastérise la boîte,
      cf. `ALTI_BATCH`), et un rapport par tranches d'écart comme `verify-peaks.mjs`.
      Wikidata n'est pas tout à fait indépendant (`P2044` est parfois recopié d'OSM ou de
      l'IGN) : c'est le sol à sa coordonnée qui tranche.
- [ ] `@deck.gl/core`, `@deck.gl/layers` et `@deck.gl/mapbox` sont toujours déclarés dans
      `package.json` alors qu'aucun fichier de `src/` ne les importe depuis l'extraction de
      la « Coupe de falaise » (`CliffSlicePathOverlay` était leur seul consommateur). Ne pas
      les retirer sans arbitrage : la branche `cliff-slice` en a besoin.
- [ ] Entrer en *Point de vue* à focale serrée fait passer le parc de tuiles de maillage de
      22 à 123 d'un coup, avec un à-coup de ~210 ms pendant que les RTT sont refaites.
      Piste : étaler le changement de `meshSize` sur quelques images, ou ne vider
      `_meshCache` que progressivement.
- [ ] Rendu « pur 3D à la PeakFinder » : masquer les couches de fond dans la RTT et ne
      garder que l'ombrage donnerait la lecture géométrique demandée pour presque rien.
      L'alternative — normales par tuile et nuanceur éclairé dédié, comme `LidarWebGLLayer`
      — est nettement plus lourde.
- [ ] Export video via "MediaBunny", voir https://terrain-viewer.iconem.com/
