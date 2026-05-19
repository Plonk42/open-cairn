# Idées de features différenciantes

## 1. Simulation ensoleillement / ombres portées

Calculer en temps réel quelles zones sont au soleil ou à l'ombre à une heure donnée, à partir du MNS LiDAR HD. Un slider "heure du jour" avec animation.

- **Cas d'usage** : planifier une rando pour éviter la chaleur, trouver le soleil en hiver, photo (golden hour), ski de rando (stabilité neige face nord/sud)
- **Faisabilité** : raycasting sur les tuiles DEM déjà chargées, rendu en overlay coloré semi-transparent. Le LiDAR MNS inclut arbres/bâtiments → ombres réalistes même en forêt.
- **Effet wahou** : voir l'ombre du relief balayer la vallée en accéléré
- **Différenciation** : aucune app carto grand public ne le fait ; le LiDAR HD 1m rend le résultat bluffant (ombres des arbres, des falaises…)

## 2. Coloration par angle de pente (slope shading)

Overlay coloré par degré de pente calculé depuis le DEM LiDAR : vert < 30°, jaune 30-35°, orange 35-40°, rouge > 40° (échelle Munter).

- **Cas d'usage** : évaluation du risque avalanche, choix d'itinéraire hors-sentier, repérage de passages raides
- **Faisabilité** : gradient calculé par différences finies sur les tuiles DEM, rendu dans le même pipeline canvas que le composite. La résolution LiDAR HD (1m) donne un résultat largement supérieur à ce qui existe (Fatmap utilise un DEM à 30m).
- **Effet wahou** : voir les couloirs d'avalanche apparaître sur la carte avec une précision métrique

## 3. Survol 3D cinématique le long de l'itinéraire

Animer la caméra le long du tracé comme un drone FPV : la carte bascule en vue immersive, suit le relief, regarde vers l'avant avec un léger angle. Bouton "survoler mon itinéraire".

- **Cas d'usage** : visualiser le parcours avant de partir, partager un aperçu animé, repérer les passages clés
- **Faisabilité** : MapLibre `map.flyTo` / `easeTo` chaînés le long du profil avec interpolation pitch/bearing. Le terrain 3D + LiDAR multiply donne un rendu très cinématique.
- **Effet wahou** : immédiat et partageable (capture vidéo ou URL animée)
- **Implémentation** : le plus rapide des trois à coder

## Priorité suggérée

1. **Ensoleillement** → vrai différenciateur unique
2. **Pentes** → complémentaire, même pipeline DEM
3. **Survol 3D** → effet immédiat, rapide à implémenter
