# TODO

Une entrée = une action : un verbe, ce qui la clôt, et un lien vers la section qui porte
les mesures. Constats et essais vivent dans le document du sujet (souvent ses
*Limitations*), les choix tranchés dans `DECISIONS.md`. Une entrée faite ou abandonnée
est retirée.

- [ ] **Trancher la couleur du feuillage en photoréaliste** : le curseur « Dégradé
      feuillage » y règle la luminosité (0,218 → 0,072 au défaut ; l'orthophoto lit
      0,097) parce que `baseCol` reste une couleur de carte. Au choix : éclaircir
      `vegRampColorPbr` vers l'orthophoto (≈ ×1,35 en linéaire), ou donner au feuillage une
      couleur de base en réflectance pour que le curseur ne règle plus que le dégradé.
      Mesurer aussi le mode essence. Détails : `ROCK_AND_CLIFF_DETAIL.md` §5.3.
- [ ] Donner au calcul des heures de lever/coucher (`SkyLabelsOverlay`) un MNT propre hors
      du cadre : il lit encore le cache de tuiles, lissé jusqu'à z5 (`SUN_LIGHTING.md`,
      *Limitations*).
- [ ] Vérifier si `settleOnGround` (`ViewpointController`) fausse la hauteur d'œil : il lit
      le sol par `queryTerrainElevation`, qui retombe sur le cache de tuiles quand l'œil
      est sous le cadre.
- [ ] **Trancher le mobile de l'Itinéraire** : il garde ses *bottom sheets* alors que le
      desktop est passé à l'accordéon (`RouteSidePanel`). Pour le Studio c'est un choix
      écrit (`DECISIONS.md`), pour l'Itinéraire un état de fait. Soit l'écrire dans
      `DECISIONS.md`, soit donner à l'accordéon un jumeau mobile.
- [ ] **Écrire un garde caméra/terrain hors *Point de vue*** : celui de MapLibre laisse la
      caméra sous le sol en rotation (jusqu'à 12 images sur 60). Un garde qui ne touche
      qu'au zoom a été essayé (`todo/terrain-camera-guard-wip`) et coûte parfois ×3 de
      recul ; reste à écrire le mélange — reculer jusqu'à un plafond, puis relever le
      pitch. Mesures : `UI_SHELL_AND_RESPONSIVE.md`, *Limitations techniques*.
- [ ] Recaler le point de station sur un MNT assez fin : il lit `queryTerrainElevation` au
      zoom du clic, et depuis une vue d'ensemble (z12–13) le « point haut » est souvent
      juste le bord amont du disque. Pistes : sonder au zoom du MNT le plus fin chargé, ou
      élargir le rayon quand le maximum tombe sur le bord.
- [ ] Rejeter le recalage d'ancre de `build-peaks.mjs` quand la marche a traversé un col :
      une cote fausse l'emmène sur le mauvais sommet (Le Grand Manti, 355 m), et le
      contrôle de sommet ne l'attrape pas — une cote trop haute n'a aucun sol au-dessus
      d'elle. Cf. `IGN_DATA_SOURCES.md`, « Remonter les ancres sur leur sommet ».
- [ ] Après le contrôle de sommet, 116 marches déplacées finissent encore à plus de 20 m
      plus loin de leur homonyme dans la référence de `verify-peaks.mjs` que leur toponyme
      (314 plus près). Les examiner au cas par cas avant d'inventer un autre garde.
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
- [ ] Rendre l'aperçu du curseur Qualité (détail, sommets, durée) juste sous forêt : il
      dimensionne sur la densité toutes classes (`spacingM` ← pyramide COPC) alors que le
      solveur ne reçoit que le sol (9,3 % sous la Chartreuse). Piste : décoder un nœud par
      dalle dans la sonde pour y lire la fraction sol. Mesures : `LIDAR_PIPELINE.md`,
      « Le curseur Qualité ».
- [ ] Arbitrer, sur des maillages Poisson réels, une tolérance de `adaptiveDecimateGround` à
      l'échelle de la cellule (0,3 × cellule / 1,5) : aujourd'hui la densité sol du palier
      ne décime presque rien aux résolutions grossières, et agrandir la cellule seule ne
      suffit pas. Mesures et essai : `LIDAR_PIPELINE.md`, *Limitations techniques*.
- [ ] Refaire l'estimation de sommets du palier (`points × 1,75 / groundStride`) en loi
      d'octree, après l'arbitrage précédent qui change ce que la décimation garde
      (`LIDAR_PIPELINE.md`, *Limitations techniques*).
- [ ] **En mode Points (et Delaunay), le curseur Qualité affiche des grandeurs Poisson** :
      « détail » = maille d'octree, « sommets » = maillage Poisson, et `tierIndexOf` compare
      profondeur et densité sol que ces modes ignorent. Seule sa résolution y sert. La
      « Densité » (`lidarCloudStride`, 1 point sur N gardé après décodage) n'entre pas dans
      l'estimation. À trancher avant d'écrire : sur une grande zone, plusieurs paliers ne
      diffèrent que par la densité sol et deviendraient des crans identiques en mode Points,
      et aucune durée n'est calée pour les normales k-PPV ni pour Delaunay.