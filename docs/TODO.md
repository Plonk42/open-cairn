# TODO

- [ ] **« Dégradé feuillage » rend la couleur trop foncée.** Le slider `u_vegIntensity`
      (`LidarAppearanceControls.tsx` l. 939) module `gradAmt` dans `points.vert` (l. 315-341) :
      hors essence, `mix(baseCol, vegRamp(a_height, u_vegHeightScale), gradAmt)` — à vérifier
      si `vegRamp`/`vegRampColor` (l. 89-130) assombrit trop le bas du dégradé (tronc) par
      rapport à la teinte de base ; en mode essence le mélange se fait avec
      `speciesHeightShade` (l. 137, 330), possiblement avec le même travers.
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
- [ ] Une cote fausse déplace l'ancre sur le mauvais sommet : Le Grand Manti porte 1850 m
      (Wikipédia dit 1818) et la marche s'est éloignée de 355 m du bon point. Le contrôle
      de sommet ne l'attrape pas : une cote trop haute n'a aucun sol au-dessus d'elle.
      Piste : rejeter le recalage quand la marche a traversé un col.
- [ ] Après le contrôle de sommet, 116 marches déplacées finissent encore à plus de 20 m
      plus loin de leur homonyme dans la référence de `verify-peaks.mjs` que leur toponyme
      (314 plus près). Les examiner au cas par cas avant d'inventer un autre garde.
- [ ] Mont Saint-Eynard et aiguilles de l'Argentière restent sans cote : leur homonyme est
      au-delà de `FAR_NAME_MATCH_M`, ou son sol ne confirme pas sa cote à 20 m près.
- [ ] Rocher de Lorzier (1838 m, nature `Rochers`, importance 2) est écarté faute d'altitude
      dans toutes les sources, alors que PeakFinder le nomme depuis Chamechaude. Vérifier
      combien de sommets notables sont perdus par cette règle.
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
- [ ] Noms des sommets : il reste 51 désaccords avec PeakFinder sur 2 952 sommets (29 que
      nous voyons et pas lui, 22 l'inverse), mesurés sur quatre points de vue seulement,
      tous en Isère et Haute-Savoie. Les regarder un par un pour les **expliquer** (MNT
      différent ? ancre mal placée ?) — pas pour les annuler : un écart compris ou assumé
      est acceptable. Élargir l'échantillon à un fond de vallée et à un autre massif.
- [ ] Ancres posées derrière leur vrai sommet : vus depuis la Croix de Belledonne, Chamechaude
      et le Brévent, la Grande Roche, Pointe Centrale Nord, Pic de la Grande Valloire, Tête
      Pelouse, Dôme de Polset et Pic de la Loze ont leur ancre 200 m à 1 km *au-delà* du point
      le plus haut du MNT, 6 à 57 m plus bas que lui (Tête Pelouse : 57 m, au-dessus du seuil
      de 40 m de la montée guidée, qui a donc calé). C'est ce qui empêche de chercher le col
      d'une crête distincte sous la ligne de visée (`peakSightings.ts`, `SUMMIT_DIP_M`). Deux
      pistes : mieux remonter les ancres dans `build-peaks.mjs`, ou poser la pointe du trait au
      point le plus haut de la zone du sommet à l'affichage.
- [ ] Le sol abaissé de 20 m sur 1 km autour de l'œil (`SINK_DEPTH_M`) n'a été validé que
      contre PeakFinder, qui fait la même chose — et mesuré avec l'œil à 1,70 m. L'œil étant
      désormais à 10 m, remesurer son effet ; s'il n'apporte plus rien, le retirer. Le
      vérifier aussi contre une référence indépendante : des rayons tirés hors ligne sur le
      RGE ALTI® à pleine résolution, pour quelques centaines de sommets.
- [ ] La durée annoncée par le curseur Qualité (`FETCH_POINTS_PER_S` dans `lidarQuality.ts`)
      a été calée quand dalles et nœuds étaient retenus sur le carré du cercle circonscrit :
      depuis qu'ils le sont sur le rectangle, une capture télécharge 35 à 56 % d'octets en
      moins, et la part « téléchargement » de la durée est probablement surestimée. Recaler
      sur quelques captures chronométrées, idéalement sur les octets plutôt que les points.
- [ ] **Le curseur Qualité aligne la profondeur Poisson sur la densité toutes classes**
      (`spacingM` ← pyramide COPC), alors que le solveur ne reçoit que le sol. Mesuré
      (`tools/lidar-density/analyze.mjs`, 200 × 200 m) : prairie du Vercors 98,8 % de sol,
      forêt de Chartreuse (5.77 / 45.29) **9,3 %** — 48 pt/m² en tout, 4,5 au sol,
      espacement 0,14 m annoncé contre 0,47 m réel, soit ~1,7 niveau d'octree de trop en
      forêt. La sonde de pyramide aggrave le biais : une forêt y paraît *plus* dense.
      Le worker plafonne désormais la profondeur sur le sol reçu (`groundDepthCap`), mais
      l'**aperçu** du curseur (détail, sommets, durée) reste optimiste sous forêt. Piste :
      décoder un nœud par dalle dans la sonde pour y lire la fraction sol.
- [ ] **La densité sol du palier est inerte aux résolutions grossières.**
      `adaptiveDecimateGround` travaille en cellules absolues de 1,5 m et traite comme
      « relief » toute cellule de moins de 6 points : simulé sur une pente parfaitement
      lisse, un pas 8 garde 100 % des points à 0,6 pt/m² sol, 75 % à 1,5 et 45 % à 2,3
      (12 % au-delà de 4,5). Les paliers 3,4 m et 1,7 m, qui affichent sol 2 ou 8, ne
      déciment donc rien, et leur estimation de sommets (`points × 1,75 / groundStride`) est
      fausse d'autant. **Exprimer la cellule en espacements ne suffit pas sur le terrain
      réel** : essayé (cellule = max(1,5 m, √22,5 × espacement), soit 22,5 points par
      cellule comme au calage) sur le sol IGN de 6.04216 / 45.24039 (400 × 400 m, niveaux
      COPC tronqués pour imiter la résolution), un pas 8 garde 100 → 94 % à 0,44 pt/m²,
      90 → 86 % à 1,8, et même 65 → 75 % à 6,7 (cellule 1,8 m). C'est `residualTol`, en
      mètres absolus (0,3 m), qui retient tout : la courbure d'un vrai versant sur une
      cellule élargie le dépasse. Mettre aussi la tolérance à l'échelle de la cellule
      (0,3 × cellule / 1,5) décime vraiment : 54 % à 0,44 pt/m², 61 % à 1,8 — mais c'est
      changer ce que la décimation juge « relief », à arbitrer sur des maillages Poisson
      réels. Même à pleine densité (34 pt/m² sol), ce pas 8 garde encore **76 %** du sol :
      la loi `1 / groundStride` de l'estimation est loin du compte partout, pas seulement
      aux résolutions grossières.
- [ ] **La maille annoncée (`octreeCellM` de `lidarQuality.ts`) ignore le `--scale 1.1`** de
      PoissonRecon : la cellule réelle est 10 % plus large que l'annonce. Laissé tel quel
      parce que la cohérence profondeur/densité (et `groundDepthCap`) est calée sur le
      balayage de 25 captures dans cette convention ; corriger l'un sans re-balayer décalerait
      les paliers d'un cran à la limite d'arrondi. (L'orientation du rectangle, elle, ne
      compte plus : le solveur tourne dans son repère.)
- [ ] Sous la profondeur cohérente le nombre de sommets suit l'octree, pas les points
      (constat du balayage cité dans `lidarQuality.ts`), mais l'estimation du palier reste
      une loi en points. Et l'aide du curseur « Profondeur octree » (« 8 = rapide… 12 = fin »)
      donne des profondeurs absolues, alors que leur sens dépend de la taille de zone.
- [ ] **En mode Points (et Delaunay), le curseur Qualité affiche des grandeurs Poisson** :
      « détail » = maille d'octree, « sommets » = maillage Poisson, et `tierIndexOf` compare
      profondeur et densité sol que ces modes ignorent. Seule sa résolution y sert. La
      « Densité » (`lidarCloudStride`, 1 point sur N gardé après décodage) n'entre pas dans
      l'estimation, et son défaut 10 n'est pas un cran de `STRIDE_STOPS` : l'étiquette lit
      « 1/10 », le curseur est posé sur 1/8.