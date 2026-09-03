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
   quoi que ce soit. *(Corrigé par le levier 4 — voir le journal §3.)*

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

<!-- Le levier 6 (densifier les parois avec des retours non classés) a été écarté :
     tous les points sol utiles sont déjà là, et réintroduire de la classe 1 fait
     rentrer du bruit. Les numéros suivants ne sont pas décalés, le journal §3 et
     la mémoire projet y renvoient. -->

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

### Ordre d'attaque retenu

**12 + 8 + 13** (tout côté shader, visible immédiatement sur le nuage chargé),
puis **3 + 5** dans le pipeline, et seulement ensuite revenir sur profondeur/stride.

---

## 3. Journal d'avancement

| Date | Levier | État |
| --- | --- | --- |
| 2026-09-03 | Diagnostic + plan | ✅ ce document |
| 2026-09-03 | **8** — ombrage du maillage par fragment + mélange vers la normale géométrique (curseur *Facettes*, section Shader, défaut 60 %) | ✅ |
| 2026-09-03 | **12** — micro-relief procédural en espace monde, bump à la Mikkelsen, 3 octaves atténuées selon l'empreinte pixel, masqué hors rocher (curseur *Micro-relief*, section Shader, défaut 100 %) | ✅ |
| 2026-09-03 | **13** — cassure d'albédo : patine fractale 2 octaves (valeur + dérive chaud/froid) et re-seuillage bruité du bord de névé (curseur *Patine*, section Shader, défaut 100 %) | ✅ |
| 2026-09-03 | **3** — lissage des normales rendu sensible aux arêtes : voisins pondérés par leur accord (rejet au-delà de 35°), repli isotrope dans les zones réellement déchiquetées. Toujours 2 passes, mais elles n'érodent plus les arêtes. Nécessite une recapture. | ✅ |
| 2026-09-03 | **5** — masque flou sur les positions post-Poisson, déplacement plafonné à 30 % de l'arête moyenne locale (curseur *Netteté*, panneau Capture, défaut 50 %). Nécessite une recapture. | ✅ (moitié « unsharp » ; le recalage sur le point d'entrée le plus proche reste à faire) |
| 2026-09-03 | **9** — lobe spéculaire GGX (Smith corrélé en hauteur, Fresnel de Schlick), rugosité et F0 interpolés roche↔neige, élargissement anti-scintillement de Kaplanyan sur la variance de normale (curseur *Spéculaire*, section Shader, défaut 50 %). Chemin photoréaliste uniquement. Un lobe diélectrique exact étant quasi invisible (~3 % en valeur d'affichage), le curseur pilote un gain artistique ×6. | ✅ |
| 2026-09-03 | **10** — résolution de la shadow map exposée (Basse/Moyenne/Haute = 1024/2048/4096, section Ombres, défaut Moyenne). La carte couvrant toute l'emprise du nuage, 1024 texels sur 250 m noyaient les ombres de contact. | ✅ (moitié « ombres nettes » ; le preset de lumière rasante reste à faire) |
| 2026-09-03 | **14** — drapage triplanaire / texture de roche sur les parois | ❌ abandonné : faute de source photo oblique, l'implémentation se réduisait à des strates procédurales, dont le rendu ne ressemblait pas à du rocher. Retiré des pistes. |
| 2026-09-03 | **6** — densifier les parois avec des retours supplémentaires | ❌ abandonné : tous les points sol utiles sont déjà exploités, et aller chercher de la classe 1 (non classée) ferait rentrer du bruit dans la reconstruction pour un gain incertain. Retiré des pistes. |
| 2026-09-03 | **4** — ajustement de plan robuste pour les normales d'entrée du solveur : passes repondérées (`exp(-r²/2σ²)`) ancrées sur le point requête, σ dérivé des résidus eux-mêmes et resserré passe après passe, garde de planéité contre les voisinages effondrés en ligne (curseur *Arêtes*, panneau Capture, défaut 60 %). L'ACP à k fixe rendait la bissectrice des deux facettes de chaque rupture de pente : l'arête était arrondie avant même que Poisson ne voie la donnée. Le voisinage k-PPV faisant ~1 m à la densité LiDAR HD, l'arête récupérée est une vraie arête métrique — pas du facettage au triangle près comme le curseur *Facettes*. Nécessite une recapture. | ✅ |
| 2026-09-03 | **Résolution apparente** — « on voit beaucoup de gros pixels ». Diagnostic mené, cause identifiée (quantification 2×2 par les dérivées écran), correctifs non implémentés. Voir §4. | 🔍 diagnostiqué, à faire |

---

## 4. Résolution apparente : les « gros pixels »

Signalé le 2026-09-03 sur la vue `#18.18/45.934127/6.973118/-29.6/71`. **Diagnostic
terminé, aucun correctif appliqué.** Repris ici pour ne pas avoir à refaire l'enquête.

### 4.1 Pistes écartées, avec la mesure qui les écarte

| Piste | Verdict |
| --- | --- |
| FBO sous-dimensionné | ❌ `LidarWebGLLayer.render()` le dimensionne sur `canvas.width/height`, donc en pixels device. Correct. |
| Orthophoto drapée trop grossière | ❌ `lidarCloudPhotoOpacity = 0`, et **zéro requête `ORTHOPHOTOS`** observée via `performance.getEntriesByType('resource')`. La couleur est 100 % procédurale. |
| Maillage trop grossier | ❌ Poisson profondeur 11 sur 250 m ⇒ triangles ~0,17 m, sous-pixel à cette échelle. |
| Shadow map | ❌ 4096² sur 250 m ⇒ ~6 cm/texel. |

À noter tout de même pour plus tard : `fetchDrapeMosaic` plafonne à
`MAX_TILES_PER_SIDE = 6`, ce qui force z18 (~0,42 m/texel) sur une capture de 250 m
alors que l'ortho IGN monte à z19. Sans effet ici puisque le drapage est éteint,
mais ce sera le facteur limitant dès qu'on le rallumera.

### 4.2 Cause réelle : l'ombrage du rocher est quantifié par blocs de 2×2 pixels

Les deux effets qui portent tout le détail rocheux dérivent leur normale des
**dérivées écran** :

- le facettage, `mesh.frag` : `cross(dFdx(v_wpos), dFdy(v_wpos))` ;
- le micro-relief (bump de Mikkelsen), `microRelief.glsl` : `hx = dFdx(h)`, `hy = dFdy(h)`.

Or `dFdx`/`dFdy` sont des différences finies **sur le quad 2×2** du GPU : les quatre
fragments reçoivent la même valeur. Toute la perturbation de normale — et avec elle
le diffus, le spéculaire et l'AO — est donc constante sur chaque bloc de 2×2 pixels.
Le relief rocheux est rendu, par construction, à la moitié de la résolution linéaire
de l'écran. C'est algorithmique, pas matériel : vrai sur tous les GPU.

Deux facteurs aggravants :

- **`devicePixelRatio = 1`** (canvas mesuré à 1040×797) : un seul échantillon par
  pixel, aucun MSAA. Réglage d'affichage, pas de carte graphique.
- À z18.18 / lat 45,9, un pixel ≈ 0,37 m au centre (moins au premier plan avec le
  pitch à 71°). La 1ʳᵉ octave du micro-relief est à λ = 1,6 m ≈ 4 px, et la **2ᵉ à
  0,67 m ≈ 2 px, pile à la limite de Nyquist**, encore à moitié active : le fondu
  `0.25λ → 0.9λ` la coupe trop tard.

Le bruit lui-même est hors de cause : `mrValueNoise` interpole en Hermite
(`u = f²(3−2f)`), son gradient est continu aux parois de cellule.

### 4.3 Correctifs, par rapport qualité/prix

1. **Gradient analytique du micro-relief.** Le bruit de valeur est dérivable en
   forme close, et les 8 hash des coins sont *déjà* calculés : la dérivée ne coûte
   que quelques `mix` de plus. On obtient un gradient **par pixel** au lieu de par
   quad, pour ~+20 % sur `mesh.frag` au lieu de ×4. Meilleur levier, et il
   supprime la cause principale.
2. **Fondu d'octaves anticipé** (`0.5λ → 1.4λ`) : deux constantes, coût nul,
   élimine l'octave qui bat à Nyquist.
3. **SSAA ×2 du FBO LiDAR**, si 1+2 ne suffisent pas. Le FBO est privé et déjà
   composité par un quad plein écran, et `_texColor` est en `LINEAR` : un rendu en
   2w×2h redescendu au composite donne exactement une moyenne box 4 taps. Le quad
   de dérivées devient alors 1 pixel de sortie. Seule solution pour le facettage
   (intrinsèquement lié à `dFdx`) et l'aliasing des arêtes de triangles.

Baisser `lidarRockFacet` atténuerait le symptôme mais sacrifierait les arêtes
franches gagnées au levier 4 — non retenu.

### 4.4 Ce que coûterait le SSAA ×2

La géométrie est dessinée **4 fois par image**, et le SSAA n'en concerne qu'une :

| Passe | Résolution | Shader |
| --- | --- | --- |
| Shadow map | 4096² = 16,8 M frag | trivial |
| FBO principal | 829 k frag | **`mesh.frag`, lourd** |
| `_exportDepthToMapLibre` | 829 k frag | profondeur seule |
| `_writeSharedDepth` | 829 k frag | profondeur seule |

Bonne nouvelle pour l'implémentation : `_exportDepthToMapLibre` et
`_writeSharedDepth` fixent déjà eux-mêmes `gl.viewport(0, 0, canvas.width,
canvas.height)`, ils sont donc immunisés d'office. Points de vigilance : restaurer
le viewport pour le composite, et remettre à l'échelle `u_radius` / `u_aoRadius` de
l'EDL qui sont exprimés en texels.

- `mesh.frag` : 829 k → **3,3 M fragments** (×4).
- VRAM du FBO : ~13 Mo → ~53 Mo (la shadow map 4096² en pèse déjà ~67 Mo).
- **Coût géométrique inchangé** : ~17 M triangles/image (4,3 M × 4 passes), qui est
  probablement déjà le vrai goulot.

`EXT_disjoint_timer_query_webgl2` est disponible : mesurer par passe avant de
trancher, plutôt que d'extrapoler.

### 4.5 Piège d'environnement : la T1200 n'était pas utilisée

Toutes les mesures ci-dessus ont été prises **sur l'iGPU**. La machine a deux GPU :

| | Intel UHD TGL-H GT1 (utilisé) | NVIDIA T1200 (au repos) |
| --- | --- | --- |
| Unités | 32 EU ≈ 256 lanes | 1024 cœurs CUDA (TU117) |
| FP32 | ~0,7 TFLOPS | ~2,9 TFLOPS |
| Mémoire | DDR4 partagée avec le CPU | 4 Go GDDR6 dédiés |

Sous **Wayland**, Ozone sélectionne l'iGPU, et la voie EGL NVIDIA part en boucle de
crash (`eglCreateImage failed with 0x00003004` → `Restarting GPU process`). Recette
vérifiée — `nvidia-smi` montrait alors le `chrome --type=gpu-process` occupant
61 Mio sur la T1200 :

```bash
__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia \
  google-chrome --ozone-platform=x11 --use-angle=gl
```

XWayland est obligatoire ; sous Wayland natif ça ne tient pas. Pour que le
navigateur piloté depuis VS Code en bénéficie, relancer **VS Code** avec ces
variables : les enfants héritent de l'environnement.

⚠️ Deux conséquences. D'abord, toute mesure « avant » est à refaire une fois
basculé. Ensuite, ça ne change **rien au diagnostic** — la quantification 2×2 est
algorithmique et `devicePixelRatio` est un réglage d'affichage : une T1200 dessine
exactement la même image en blocs, simplement plus vite. Et les utilisateurs
d'open-cairn seront souvent sur iGPU, ce qui reste une raison de préférer le
gradient analytique (~+20 %) au SSAA (×4) quand les deux donnent le même résultat.
