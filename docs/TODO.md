# TODO

- [ ] La case **« Noms des sommets »** vit désormais dans la pilule *Panorama* côté carte,
      mais reste un bouton de la barre du haut côté Studio — la barre du bas du Studio est
      bâtie sur `STUDIO_RENDER_SETTINGS`, qui n'a pas de section *Panorama* où la loger.
      Deux emplacements pour un même drapeau : à unifier si le Studio gagne un jour une
      section « lecture du paysage ».

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
      le champ ne peut faire apparaître que des sommets déjà marchés, jamais un sommet
      qu'une portée par rang avait écarté. PeakFinder, lui, va chercher plus loin en
      téléobjectif.

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


