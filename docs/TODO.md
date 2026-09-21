# TODO

- [ ] Monter l'œil en *Point de vue* est **clavier seulement** (flèches haut/bas) : sur
      téléphone on reste cloué à 1,70 m, c'est-à-dire précisément au cadrage que le relief
      proche bouche le plus souvent. Il manque un jumeau tactile — glissement à deux doigts
      vertical dans `MobileToolbar`, ou petit couple de boutons ▲/▼ dans la feuille du mode.

- [ ] La caméra traverse le relief en rotation hors *Point de vue*, et ce n'est pas une
      désactivation de notre part : `_elevateCameraIfInsideTerrain` (maplibre-gl 5.11) est
      bien la méthode d'origine partout ailleurs. Mais ce garde vise `camAlt == ground`,
      **marge nulle**, et n'y arrive même pas : itéré quatre fois il est un **point fixe à
      −0,29 m** (même pitch 77,22°, même zoom 16,486, caméra déplacée de 0 m). Il ne teste
      qu'un échantillon bilinéaire sous la caméra — jamais le terrain *entre* l'œil et le
      centre, jamais le maillage de triangles réellement dessiné, qui le dépasse de plusieurs
      mètres sur un versant. Mesuré sur un tour complet à z16,5 / pitch 80 : **12 images sur
      60 sous le sol**, et le pitch oscille 77,2° ↔ 64,5° parce que le garde réécrit *pitch et
      zoom* au lieu de reculer la caméra. Piste : remplacer le garde par le nôtre (on sait
      déjà le faire, cf. `setTerrainCameraCollision`), avec une marge réelle, un maximum sur
      quelques sondes autour de l'œil, et une correction qui ne touche qu'au zoom pour ne pas
      manger le cadrage demandé.
- [ ] En *Point de vue* le bas de l'écran se remplit de rayures verticales — les jupes des
      tuiles de terrain de MapLibre, vues de l'intérieur du versant à incidence rasante.
      L'œil est pourtant bien au-dessus du sol (1,70 m garanti désormais) ; c'est le relief
      des 20 m alentour qui le dépasse (mesuré : +8,44 m à 20 m sur un versant des Aiguilles
      Rouges). Deux pistes : monter l'œil à ~15 m, ou accrocher le clic au **point haut local**
      dans un rayon de quelques centaines de mètres, comme PeakFinder — le sol tombe alors
      immédiatement et le problème disparaît sans tricher sur la hauteur.
- [ ] Les noms de sommets ancrés près du bord droit sont coupés : le texte part vers la
      droite depuis son ancre et rien ne mesure sa longueur. PeakFinder les coupe aussi,
      mais on pourrait les faire courir vers la gauche dans la marge droite — au prix de
      l'invariant « toutes les étiquettes sont des bandes parallèles » dont dépend le
      désencombrement.
- [ ] Le champ de vision ne dicte encore que le *placement*, pas la *visée* : resserrer
      le champ ne peut faire apparaître que des sommets déjà marchés. La portée des rangs 1
      et 2 est montée à 150/100 km, ce qui remplit le budget (831 candidats sur 900 depuis
      Belledonne) ; aller plus loin demande de ne plus marcher tout le cercle mais le seul
      secteur regardé. Chiffré : une table `[0, 200, 150, 60, 20]` donne 1 322 candidats sur
      360° — hors budget — mais **210** dans un secteur de 37°. Prix à payer : un cap et un
      champ dans `observerKey`, un filtre d'azimut dans `selectCandidates`, et une nouvelle
      marche à chaque arrêt de rotation, là où tourner la tête est gratuit aujourd'hui.

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
- [ ] Champ de vision : PeakFinder cadre à 110° d'horizontale, nous à 70°. Voir si un champ
      plus large est souhaitable en *Point de vue*, ou au moins atteignable au pincement.
- [ ] Le test d'occultation est plus strict que celui de PeakFinder à courte distance :
      `SELF_CLEARANCE` est une *fraction* de la distance (60 m à 4 km, 900 m à 60 km) là où
      PeakFinder pardonne un obstacle à moins de 1 400 m fixes du sommet visé.
- [ ] `tools/check-wikidata2.mjs` n'est pas versionné. Contrairement à `verify-peaks.mjs`, il
      ne dépend d'aucune donnée hors dépôt et pourrait tourner en CI. À nettoyer (`.sort` en
      expression, gabarit imbriqué) avant de le committer.
- [ ] Régler `terrainSkirtLength: 'none'` sur la création de la carte : le dépôt est passé à
      MapLibre GL JS v6 (l'option existe depuis cette version, dans `MapOptions`), mais le
      réglage n'a pas été ajouté à `MapContainer.tsx` dans le cadre de cette montée de version.
      Les jupes de terrain restent au réglage `"auto"` par défaut de MapLibre.
- [ ] `@deck.gl/core`, `@deck.gl/layers` et `@deck.gl/mapbox` sont toujours déclarés dans
      `package.json` alors qu'aucun fichier de `src/` ne les importe depuis l'extraction de
      la « Coupe de falaise » (`CliffSlicePathOverlay` était leur seul consommateur). Ne pas
      les retirer sans arbitrage : la branche `cliff-slice` en a besoin.
- [ ] `panoramaDetail.ts` s'accroche \u00e0 des champs priv\u00e9s de MapLibre \u2014 `rttSize` (assign\u00e9\n      uniquement dans le constructeur de `RenderToTexture`, donc `qualityFactor` seul ne\n      suffit pas), `_meshCache`, `_renderableTilesKeys`. Une mont\u00e9e de version peut les\n      renommer sans bruit : il n'y a aucun test qui l'attraperait, le mode continuerait\n      simplement \u00e0 rendre en qualit\u00e9 par d\u00e9faut. Piste : une assertion de d\u00e9veloppement au\n      moment du patch.\n- [ ] Entrer en *Point de vue* \u00e0 focale serr\u00e9e fait passer le parc de tuiles de maillage de\n      22 \u00e0 123 d'un coup, avec un \u00e0-coup de ~210 ms pendant que les RTT sont refaites.\n      Piste : \u00e9taler le changement de `meshSize` sur quelques images, ou ne vider\n      `_meshCache` que progressivement.\n- [ ] Rendu \u00ab pur 3D \u00e0 la PeakFinder \u00bb : masquer les couches de fond dans la RTT et ne\n      garder que l'ombrage donnerait la lecture g\u00e9om\u00e9trique demand\u00e9e pour presque rien.\n      L'alternative \u2014 normales par tuile et nuanceur \u00e9clair\u00e9 d\u00e9di\u00e9, comme `LidarWebGLLayer`\n      \u2014 est nettement plus lourde.\n- [ ] Export video via "MediaBunny", voir https://terrain-viewer.iconem.com/