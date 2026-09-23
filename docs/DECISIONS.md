# Décisions tranchées

Arbitrages rendus par le mainteneur. Ne pas les rouvrir sans un fait nouveau ; les détails
techniques vivent dans le document de chaque sujet.

## Carte et relief

- **Source du relief 3D en `auto`** : MNT IGN si une clé DEM est saisie, Mapterhorn sinon. Le
  basculement vers Mapterhorn par défaut a été essayé puis annulé.
  → `BASEMAPS_AND_HILLSHADE.md`
- **Le LiDAR se dessine toujours au-dessus du terrain**, sans test de profondeur contre lui : le MNT
  IGN est souvent trop haut et ne doit jamais masquer une mesure LiDAR. → `LIDAR_RENDERING.md`
- **Bande des noms de sommets bornée par `BAND_MIN_Y_PX`** : pas un défaut, on relève la caméra.

## Studio LiDAR

- **Le bouton de capture reste le gros rond vert en bas**, hors du panneau de rendu : on ne cadre
  jamais une zone en même temps qu'on règle le rendu de la précédente. Sur desktop il est masqué
  quand le panneau est ouvert.
- **Les modes de caméra restent dans la barre du haut**, pas dans le panneau : ils se changent
  pendant qu'on lit le panneau, et les deux ne se recouvrent pas verticalement.
- **Le Studio mobile garde ses bottom sheets** (divergence avec le panneau desktop, notée dans
  `TODO.md`).
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
