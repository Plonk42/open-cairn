# TODO

Une entrée = une action : un verbe, ce qui la clôt, et un lien vers la section qui porte
les mesures. Constats et essais vivent dans le document du sujet (souvent ses
*Limitations*), les choix tranchés dans `DECISIONS.md`. Une entrée faite ou abandonnée
est retirée.

- [ ] plier/déplier le menu de droite change le cadrage de la carte et donc la redessine : rendre le menu flottant ?
- [ ] **Trancher la couleur du feuillage en photoréaliste** : le curseur « Dégradé
      feuillage » y règle la luminosité (0,218 → 0,072 au défaut ; l'orthophoto lit
      0,097) parce que `baseCol` reste une couleur de carte. Au choix : éclaircir
      `vegRampColorPbr` vers l'orthophoto (≈ ×1,35 en linéaire), ou donner au feuillage une
      couleur de base en réflectance pour que le curseur ne règle plus que le dégradé.
      Mesurer aussi le mode essence. Détails : `ROCK_AND_CLIFF_DETAIL.md` §5.3.
- [ ] Donner au calcul des heures de lever/coucher (`SkyLabelsOverlay`) un MNT propre hors
      du cadre : il lit encore le cache de tuiles, lissé jusqu'à z5 (`SUN_LIGHTING.md`,
      *Limitations*).
- [ ] Écarter les noms de massif que la BD TOPO® range en `Sommet` sans altitude : « Chaîne de
      Belledonne » (rang 2) s'étiquette comme un sommet depuis Chamechaude. 25 noms du fichier
      commencent par « Chaîne » ou « Massif » ; fait quand la règle de `build-peaks.mjs` les
      traite comme les natures de zone (retenus seulement avec une altitude).
- [ ] Caler l'œil sur un sol fin quand le sol sous lui n'est pas dessiné (regard au-dessus
      de l'horizon) : `settleOnGround` ne corrige plus que sur la surface dessinée, et
      l'œil garde alors l'altitude lue au zoom du clic. Piste : une lecture MNT à zoom
      fixe, demandée explicitement. Cf. `UI_SHELL_AND_RESPONSIVE.md`, relecture du sol.
- [ ] **Trancher le mobile de l'Itinéraire** : il garde ses *bottom sheets* alors que le
      desktop est passé à l'accordéon (`RouteSidePanel`). Pour le Studio c'est un choix
      écrit (`DECISIONS.md`), pour l'Itinéraire un état de fait. Soit l'écrire dans
      `DECISIONS.md`, soit donner à l'accordéon un jumeau mobile.
- [ ] **Écrire un garde caméra/terrain hors *Point de vue*** : celui de MapLibre laisse la
      caméra sous le sol en rotation (jusqu'à 12 images sur 60). Un garde qui ne touche
      qu'au zoom a été essayé (`todo/terrain-camera-guard-wip`) et coûte parfois ×3 de
      recul ; reste à écrire le mélange — reculer jusqu'à un plafond, puis relever le
      pitch. Mesures : `UI_SHELL_AND_RESPONSIVE.md`, *Limitations techniques*.
- [ ] **Remettre avancer/reculer dans le bon sens vers 90° de pitch** (Studio) : le glisser
      et la molette de MapLibre s'y inversent, et la montée en 6.11.2 n'y change rien.
      C'est fait quand le glisser vers soi et la molette avant avancent de 85° à 95°. Au
      choix : signaler en amont avec les mesures, ou remplacer `dragPan`/`scrollZoom` au-delà
      de ~88° par un déplacement le long du cap. Mesures : `UI_SHELL_AND_RESPONSIVE.md`,
      *Limitations techniques*.
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
- [ ] Rapprocher les verdicts de visibilité en grand angle de ceux d'un maillage +2 sans
      en payer le coût, en n'affinant que les tuiles qui portent des crêtes masquantes (à
      60° : 181 désaccords avec PeakFinder à +1, 81 à +2). Mesures :
      `UI_SHELL_AND_RESPONSIVE.md`, « Le zoom sous l'œil ».
- [ ] Expliquer les 81 désaccords restants à +2 contre 51 avant la montée en MapLibre
      6.11 : l'essentiel est au Brévent (20 rangs 2 vus à tort entre 40 et 60 km, côté
      Italie où Mapterhorn est plus grossier ?).
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
      22 à ~90 d'un coup, avec un à-coup (~210 ms mesurés à 123 tuiles) pendant que les RTT
      sont refaites.
      Piste : étaler le changement de `meshSize` sur quelques images, ou ne vider
      `_meshCache` que progressivement.
- [ ] **Rendre la courbure terrestre en *Point de vue*** : le terrain MapLibre est plan, et
      un sommet à 31 km est dessiné 67 m trop haut, soit 10 px à 8° (30 px à 100 km) — la
      plus grosse erreur de relief restante, devant le maillage et le MNT. Piste : abaisser
      les tuiles MNT chargées de `d²(1−k)/2R` autour de l'œil (réécrire le `DEMData`, recréer
      sa texture, refaire au changement de lieu), puis faire lire la surface dessinée à la
      marche d'occultation au lieu de lui appliquer la courbure une seconde fois. Mesures :
      `UI_SHELL_AND_RESPONSIVE.md`, « Le zoom sous l'œil » et « Où la pointe se pose ».
- [ ] Demander à MapLibre un réglage de LOD pour les tuiles de rendu du terrain, que la 6.11
      a découplées du `calculateTileZoom` de la source (#8048). Fait quand la copie de
      `TerrainTileManager.update` de `panoramaDetail.ts` peut être retirée. Détails :
      `UI_SHELL_AND_RESPONSIVE.md`, « Le zoom sous l'œil ».
- [ ] Expliquer le coin blanc au pied de l'œil en *Point de vue* (bas du cadre, côté pente,
      depuis Chamechaude cap −20° à 37°) : présent avant et après le déplafonnement du
      zoom. Vérifier s'il s'agit du brouillard par sommet des tuiles voisines de l'œil
      (`eyeNearTile` ne couvre que celle qui le contient) ou d'un drapé vide.
- [ ] Proposer à MapLibre le filtre de `_getTerrainCoordsForRegularTile` (une copie de tuile et
      une matrice par paire fond × terrain avant le test de recouvrement) ; fait quand la copie
      de `panoramaDetail.ts` peut être retirée. Mesures : `UI_SHELL_AND_RESPONSIVE.md`, « Les
      drapés ne cherchent plus que leurs vraies tuiles ».
- [ ] Ne plus dessiner en *Point de vue* les tuiles de terrain entièrement cachées (requêtes
      d'occultation sur leur boîte englobante) : à 1° depuis Chamechaude, 201 tuiles sur 276
      sont derrière un relief plus proche et le GPU intégré plafonne à ~7 images/s (35,6 M de
      triangles). À trancher avant d'écrire (~120 lignes).
- [ ] Ramener le plan de coupe proche du *Point de vue* à 0,5 m quand un nuage LiDAR entoure
      l'œil : déduit du recalage, il ignore la végétation et peut monter à 25 m. Fait quand la
      boîte englobante d'un nuage affiché près de l'œil le plafonne. Cf.
      `UI_SHELL_AND_RESPONSIVE.md`, « Le plan de coupe proche ».
- [ ] Rendu « pur 3D à la PeakFinder » : masquer les couches de fond dans la RTT et ne
      garder que l'ombrage donnerait la lecture géométrique demandée pour presque rien.
      L'alternative — normales par tuile et nuanceur éclairé dédié, comme `LidarWebGLLayer`
      — est nettement plus lourde.
- [ ] Export video via "MediaBunny", voir https://terrain-viewer.iconem.com/
- [ ] Noms des sommets : il restait 51 désaccords avec PeakFinder sur 2 952 sommets (29 que
      nous voyons et pas lui, 22 l'inverse), mesurés sur quatre points de vue seulement,
      tous en Isère et Haute-Savoie — 181 sur 2 992 aujourd'hui au biais terrain +1, plus
      8 sur les 179 sommets de rang 5 (voir l'entrée sur le biais). Les regarder un par un pour les **expliquer** (MNT
      différent ? ancre mal placée ?) — pas pour les annuler : un écart compris ou assumé
      est acceptable. Élargir l'échantillon à un fond de vallée et à un autre massif.
- [ ] Recompter les désaccords PeakFinder avec le rang 3 à 80 km et la portée allongée par
      la focale (voir `UI_SHELL_AND_RESPONSIVE.md`, « À quels sommets on paie un rayon »).
- [ ] Étaler la visée des sommets sur plusieurs images : avec la portée allongée par la
      focale, une passe bloque le fil principal 140 à 160 ms à 8–15° (voir
      `UI_SHELL_AND_RESPONSIVE.md`, « La portée suit la focale ») — un à-coup si l'on reprend
      le geste pendant ce temps. Fermé quand aucune passe ne dépasse ~16 ms par image.
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