# Rocher et falaises : pourquoi c'est lisse, et quoi faire

> Diagnostic posé le 2026-09-03 sur une scène live (Aiguilles Rouges / Chamonix,
> `?view=lidar#16.83/45.934131/6.973543/-29.6/71`), en réponse à : « même en
> profondeur 11, les rochers et les falaises paraissent trop lisses ».

Cette page sert de référence de travail : le diagnostic mesuré, la liste ordonnée
des leviers, et un journal d'avancement en fin de document.

---

## 1. Diagnostic

### 1.1 La profondeur Poisson est déjà au-delà de la donnée

Mesures sur la scène live :

| Paramètre | Valeur |
| --- | --- |
| `depth` | 11 |
| `stride` (extraction) | 2 |
| `groundStride` | 2 |
| `pointWeight` | 12 |
| `samplesPerNode` | 1.5 |
| rayon de capture | 177 m |
| sommets du mesh | 2 087 960 |
| triangles | 4 180 000 |

À la densité native IGN LiDAR HD (~10 pts/m²), un `stride` de 2 sur cette emprise
donne de l'ordre de **300 k points sol en entrée pour 2,1 M sommets en sortie** :
un rapport d'interpolation de ~7:1. La profondeur 11 correspond à des cellules
d'octree de 0,25–0,30 m, contre un espacement d'échantillons d'environ 0,45 m.

**On est donc sous la résolution de la donnée.** Passé ce point, les cellules
supplémentaires ne sont remplies que par l'a priori de régularité du solveur :
augmenter la profondeur ne peut plus ajouter de détail, elle subdivise plus
finement la même bouillie.

### 1.2 Les falaises sont structurellement les moins échantillonnées

Un LiDAR nadir échantillonne une pente à `densité × cos(θ)` :

| Inclinaison | Densité relative |
| --- | --- |
| 0° (plat) | 100 % |
| 60° | 50 % |
| 75° | 26 % |
| 85° | 9 % |

Les parois — celles qui demandent le plus de détail — sont exactement celles qui
en reçoivent le moins. C'est intrinsèque à l'acquisition, pas au solveur.

### 1.3 Quatre étages de lissage supplémentaires s'ajoutent

1. **Lissage des normales après Poisson.**
   [`pipeline.ts`](../src/lib/lidarBrowser/pipeline.ts) applique
   `smoothVertexNormals(indices, normals, NORMAL_SMOOTHING_PASSES)` avec
   `NORMAL_SMOOTHING_PASSES = 2` — deux passes laplaciennes sur les normales
   d'ombrage, *après* la reconstruction.

2. **Normales d'entrée en ACP k-NN à k fixe (12).**
   Une ACP sur les 12 voisins moyenne de part et d'autre de toute arête : l'arrondi
   des angles vifs est inhérent à l'estimateur, avant même que le solveur ne voie
   quoi que ce soit.

3. **Albédo purement fonctionnel, sans variation spatiale.**
   [`slope.ts`](../src/lib/lidarBrowser/slope.ts) `montagneAlbedo()` est une fonction
   continue de (pente, altitude, orientation). Deux points de même pente ont
   rigoureusement la même couleur ⇒ lecture « plastique », et des plaques de neige
   en taches molles parce que le seuil est un `smoothstep` sur l'altitude.

4. **Éclairage diffus seul, ombrage par sommet.**
   [`pbr.glsl`](../src/components/map/lidar-gl/glsl/lib/pbr.glsl) `pbrShade()` est
   lambertien pur : pas de lobe spéculaire. Et `mesh.vert` calcule `v_diff` /
   `v_flatDiff` **par sommet** (Gouraud), donc l'ombrage est interpolé linéairement
   sur des triangles déjà C²-continus.

5. **Le drapage photo est coupé sur les parois.**
   `mesh.frag` calcule `photoFacing = smoothstep(-0.25, 0.05, v_up)` : une face
   verticale a `v_up ≈ 0` et reçoit donc quasiment aucune texture. Les falaises sont
   les seules surfaces sans aucun détail d'albédo.

---

## 2. Leviers, par ordre de rendement

### A — Réglages seuls, sans code

1. **Descendre `stride` à 1** (extraction *et* sol) **avant** de toucher à la
   profondeur. À `depth 11` on affame l'octree ; plus de retours réels est la seule
   chose qui ajoute du vrai détail de paroi.
2. **`samplesPerNode` 1.5 → 1.0** : faire confiance aux échantillons individuels,
   la donnée est propre.

### B — Reconstruction

3. **Supprimer ou rendre adaptatives les 2 passes de lissage des normales.**
   Peu coûteux, effet immédiat.
4. **Estimation de normales robuste / bilatérale** (ajustement de plan avec rejet
   d'aberrants, k adaptatif) au lieu de l'ACP k=12 fixe. C'est la cause n°1 de
   l'arrondi des arêtes dans une chaîne Poisson.
5. **Récupération de détail post-Poisson** : projeter chaque sommet du mesh vers son
   point d'entrée le plus proche le long de la normale (un curseur « Netteté »),
   plus un masque flou (unsharp) laplacien sur le champ de positions. Récupère les
   hautes fréquences moyennées par le solveur sans toucher à la topologie.
   *Meilleur rapport effort/rendu de ce groupe.*
6. **Alimenter les zones raides avec plus de retours** (classe 1 sur les parois — cf.
   la note mémoire sur le revert `41fa9d7` / `685dd9c`).
7. **À terme : dual contouring / extraction d'iso-surface préservant les arêtes.**
   Poisson + marching cubes ne peut littéralement pas représenter une arête vive.

### C — Éclairage (agit sur le nuage déjà chargé, sans recapture)

8. **Mélanger la normale interpolée avec la normale géométrique**
   (`dFdx`/`dFdy` de `v_wpos`) dans `mesh.frag` → annule instantanément l'aspect
   cire C²-continue, donne des facettes. *Prérequis : ombrage par fragment.*
9. **Ajouter un lobe spéculaire GGX** piloté par la rugosité → minéral au lieu
   d'argile.
10. **Préset lumière rasante** (soleil bas) + shadow map plus résolue / ombres de
    contact. C'est la lumière rasante qui sculpte le rocher.
11. **Assombrissement par courbure / cavité** cuit par sommet dans le pipeline —
    complète l'AO écran, survit à tous les niveaux de zoom.

### D — Texture et détail (également live, sans recapture)

12. **Normales de détail procédurales triplanaires** (micro-relief 5–50 cm,
    amplitude modulée par la rugosité, atténuée avec la distance). Sans géométrie,
    et de loin le plus gros levier « ça, c'est du rocher ».
13. **Cassure d'albédo** : bruit fractal en espace monde par-dessus la palette
    `montagne`, et seuil neige/roche piloté par la courbure et le bruit plutôt que
    par une rampe lisse pente/altitude.
14. **Drapage triplanaire** pour que les parois cessent d'être un aplat : garder
    l'ortho sur les surfaces tournées vers le ciel, mélanger une texture de roche
    sur les faces raides là où `photoFacing` tombe à 0.

### Ordre d'attaque retenu

**12 + 8 + 13** (tout côté shader, visible immédiatement sur le nuage chargé),
puis **3 + 5** dans le pipeline, et seulement ensuite revenir sur profondeur/stride.

---

## 3. Journal d'avancement

| Date | Levier | État |
| --- | --- | --- |
| 2026-09-03 | Diagnostic + plan | ✅ ce document |
