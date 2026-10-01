# Décisions tranchées

Arbitrages rendus par le mainteneur. Ne pas les rouvrir sans un fait nouveau ; les détails
techniques vivent dans le document de chaque sujet.

## Carte et relief

- **Source du relief 3D en `auto`** : MNT IGN si une clé DEM est saisie, Mapterhorn sinon. Le
  basculement vers Mapterhorn par défaut a été essayé puis annulé.
  → `BASEMAPS_AND_HILLSHADE.md`
- **Le LiDAR se dessine toujours au-dessus du terrain**, sans test de profondeur contre lui : le MNT
  IGN est souvent trop haut et ne doit jamais masquer une mesure LiDAR. → `LIDAR_RENDERING.md`
- **Bande des noms de sommets bornée par `bandMinYPx`** : pas un défaut, on relève la caméra.
- **Le générateur de sommets lit le MNT LiDAR HD**, RGE ALTI® seulement là où le LiDAR manque,
  et monte les ancres avec 16 sondes. Pas de table de corrections manuelles par sommet.
  → `IGN_DATA_SOURCES.md`, « Remonter les ancres sur leur sommet »
- **Traits de rappel des sommets verticaux, noms épinglés au-dessus de leur sommet** : le
  glissement latéral avec trait coudé a été essayé et rejeté (illisible).
- **« Point de vue » reste un mode de caméra, pas une troisième vue** : il sert dans les deux vues
  et survit à la bascule. Pendant le mode, une barre en bas au centre de la carte porte ses
  réglages et sa sortie — le haut est où pendent les noms de sommets ; le bouton reste pour
  l'instant dans le groupe caméra.
  → `UI_SHELL_AND_RESPONSIVE.md`
- **Le point de station est le point le plus haut à moins de 50 m du clic**, comme PeakFinder :
  l'œil ne se pose plus sur l'endroit exact cliqué. Un lien de partage, lui, n'est pas recalé.
  → `UI_SHELL_AND_RESPONSIVE.md`
- **En « Point de vue », l'adresse du navigateur porte le point de station et la visée** (`#vp=`),
  sans aucun réglage : copier l'adresse suffit à montrer le point de vue, et un rechargement
  reste dans le mode. Les réglages ne voyagent que par le bouton *Partager*.
  → `SHARE_VIEW.md`
- **L'œil arrive à 10 m au-dessus du sol en « Point de vue »**, pas à 1,70 m : c'est ce qui
  supprime les collisions du maillage MapLibre avec le premier plan. Abaisser le relief dessiné
  sous l'œil a été jugé trop lourd. Les flèches redescendent jusqu'au sol (0 m), pour qui
  veut vraiment la vue au ras du sol.
  → `UI_SHELL_AND_RESPONSIVE.md`
- **PeakFinder est une référence, pas une cible** : une différence de sommets vus ou nommés est
  acceptable dès qu'on sait l'expliquer ou qu'elle est assumée (le classement des noms par
  distance rapportée au rang, par exemple). On ne cherche pas à annuler l'écart pour lui-même.
  → `UI_SHELL_AND_RESPONSIVE.md`
- **Pas de réglage de précision du relief en « Point de vue »** : le maillage reste à +1
  (2–4 px par quad). Un réglage à trois crans a été essayé puis retiré — aucun gain
  visible, textures même un peu moins nettes au cran le plus fin, deux fois plus de tuiles.
  → `UI_SHELL_AND_RESPONSIVE.md`, « Le zoom sous l'œil »
- **Importance des sommets visible, en trois niveaux** (rang 1 ambre, rang 2 gras, les autres
  allégés), avec un interrupteur on/off derrière la flèche de *Sommets*, actif par défaut. Pas
  de niveaux d'intensité.
  → `UI_SHELL_AND_RESPONSIVE.md`, « Noms des sommets »

## Studio LiDAR

- **Les deux vues desktop règlent la carte dans le même accordéon à droite** : l'Itinéraire
  a abandonné sa barre de pilules du bas, qui était le seul autre vocabulaire, et le bas de la
  carte est laissé à la barre du mode *Point de vue*.
- **Sur desktop, le titre de cet accordéon est le sélecteur de vue** (les deux segments
  *Itinéraire* / *Studio LiDAR*, la vue courante en vert — pas un titre « Vue ⇄ » à bascule,
  essayé et rejeté : on veut voir les deux valeurs), comme le « meta mode » de *Terrain
  Viewer*. Le panneau monte jusqu'en haut de l'écran ; replié, il garde cette barre de titre,
  et l'état de repli est commun aux deux vues. Le mobile garde sa pilule.
- **Le *Fond* (fond, ombrage, fusion, courbes) est la seule section commune aux deux vues**, et
  un méta-réglage « Épingler », visuellement à part, la partage entre elles (désactivé par
  défaut ; épingler recopie la vue courante, désépingler ne restaure rien). Les deux
  « Réinitialiser » couvrent tout leur panneau sauf *Avancé*.
- **Le bouton de capture reste le gros rond vert en bas**, hors du panneau de rendu : on ne cadre
  jamais une zone en même temps qu'on règle le rendu de la précédente. Sur desktop il est masqué
  quand le panneau est ouvert.
- **Les modes de caméra restent dans la barre du haut**, pas dans le panneau : ils se changent
  pendant qu'on lit le panneau, et les deux ne se recouvrent pas verticalement.
- **Le Studio mobile garde ses bottom sheets** : divergence assumée avec l'accordéon desktop
  (limitation listée dans `UI_SHELL_AND_RESPONSIVE.md`).
- **« Partager » n'existe que dans la vue Itinéraire** : un lien ne transporte aucun nuage. Les noms
  de sommets restent hors du lien.
- **Reportés** : glisser la zone de capture pour la recentrer, poignée de rotation du cap.

## Rendu

- **Pas de texture de paroi procédurale** (strates/fractures) : essayée, jugée laide. Seulement avec
  une imagerie réelle. → `ROCK_AND_CLIFF_DETAIL.md`
- **Pas de points classe 1 (non classés) dans Poisson**, et pas de modification du tri des classes
  sans accord. → `LIDAR_PIPELINE.md`
- **La frange sombre des surplombs est voulue** : sa hauteur est mesurée depuis le rebord.
- **Lithologie = préréglage ; ligne de neige et enneigement = deux curseurs distincts.**
- **Pas de SSAA** : les utilisateurs sont souvent sur GPU intégré.
- **« Détail à la vue » du drapage** : optionnel, désactivé par défaut.
- **« Nuages récents » = géométrie seule ; « Mes vues » porte l'ambiance.**
- **`POISSON_BASE_MAX_SAMPLE_DEPTH = 9`** est conservé.

## Données

- **GPX** : pas de `<trkseg>` par tronçon, pas d'index en `<extensions>`, recherche d'accroche
  toujours vers l'avant. → `SAVED_ROUTES_AND_GPX.md`
- **`src/lib/peaksData.json` est versionné** et n'est pas régénéré en CI (politique d'usage
  d'Overpass, vérification hors dépôt). → `IGN_DATA_SOURCES.md`
- **`@deck.gl/*` reste dans `package.json`** : la branche `cliff-slice` en dépend.

## Branches

- `cliff-slice` et `ombrage-solaire` sont main + un commit qui réintroduit la fonctionnalité : les
  rebaser sur main.
