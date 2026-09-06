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
   [`slope.ts`](../src/lib/lidarBrowser/slope.ts) `terrainAlbedo()` (alors
   `montagneAlbedo()`, voir §5.7) est une fonction
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
    de terrain, et seuil neige/roche piloté par la courbure et le bruit plutôt que
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
| 2026-09-03 | **Résolution apparente** — « on voit beaucoup de gros pixels ». Diagnostic mené, cause identifiée (quantification 2×2 par les dérivées écran). Voir §4. | 🔍 diagnostiqué |
| 2026-09-04 | **§4.3-1** — gradient analytique du bruit de valeur (`mrValueNoiseD`, forme trilinéaire développée `k0..k7`) : le micro-relief perturbe désormais la normale **par pixel** au lieu de par quad 2×2. `mrValueNoise` reste exposé en enveloppe fine pour `rockAlbedo.glsl`, le gradient inutilisé étant éliminé à la compilation. | ✅ |
| 2026-09-04 | **§4.3-2** — fondu d'octaves anticipé, `0.25λ → 0.9λ` devient `0.5λ → 1.4λ` (`MR_FADE_LO` / `MR_FADE_HI`) : l'octave qui battait à la fréquence de Nyquist est éteinte avant d'y arriver. | ✅ |
| 2026-09-04 | **§4.3-3** — SSAA ×2 du FBO LiDAR, seul remède au facettage (`u_facet`), intrinsèquement lié à `dFdx`. | ⏸️ non retenu pour l'instant : ×4 fragments sur `mesh.frag` alors que beaucoup d'utilisateurs sont sur iGPU. À rouvrir après mesure par passe (§4.4). |
| 2026-09-06 | **§5** — palette *Été* cassée (moucheté partout) : la couleur de sommet était calculée sur la normale par triangle. Découplée sur une normale **macro** (24 passes Jacobi isotropes ≈ 2,5 m de rayon), l'indice de rugosité retiré de l'albédo, palette recalibrée en réflectance physique et garde `u_snowPalette` sur le re-seuillage de névé. | ✅ |
| 2026-09-06 | **§5.2** — rupture herbe/calcaire de la palette *Été* reculée de 30° à 36-45°, palette *Montagne* étendue vers le bas (neige 2700-3200 m, alpage jusqu'à 2600 m), herbe resaturée dans les deux. | ✅ |
| 2026-09-06 | **§5.3** — rampe végétale en réflectance physique sur le chemin photoréaliste (`vegRampColorPbr`, sélectionnée par `u_pbr`). | ✅ |
| 2026-09-06 | **§5.5** — pelouse unique à *Été* et *Montagne* (`alpineTurf`), un peu moins jaune, et **ligne de neige réglable** (curseur *Ligne de neige*, section Shader, défaut 2700 m) qui pilote à la fois les névés, la ceinture d'alpage et le dessèchement de l'herbe. | ✅ |
| 2026-09-06 | **§5.7** — les cinq presets fondus en trois : *Été* + *Montagne* → **Terrain**, *Hiver* supprimé (c'est *Terrain* à ligne de neige basse). La lithologie devient un réglage à part (*Roche* : calcaire / granite / schiste). Fenêtre de luminance de `rockAlbedo.glsl` remontée à 0,76-0,86, le calcaire à 0,674 y était lu comme de la neige. | ✅ |

---

## 4. Résolution apparente : les « gros pixels »

Signalé le 2026-09-03 sur la vue `#18.18/45.934127/6.973118/-29.6/71`. Diagnostic
ci-dessous ; **correctifs 1 et 2 appliqués le 2026-09-04**, le 3 (SSAA) reste ouvert.
Repris ici pour ne pas avoir à refaire l'enquête.

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

Les deux effets qui portent tout le détail rocheux dérivaient leur normale des
**dérivées écran** :

- le facettage, `mesh.frag` : `cross(dFdx(v_wpos), dFdy(v_wpos))` — toujours le cas ;
- le micro-relief (bump de Mikkelsen), `microRelief.glsl` : `hx = dFdx(h)`, `hy = dFdy(h)` — **corrigé**, voir §4.3-1.

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

1. ✅ **Gradient analytique du micro-relief.** Le bruit de valeur est dérivable en
   forme close, et les 8 hash des coins sont *déjà* calculés : la dérivée ne coûte
   que quelques `mix` de plus. On obtient un gradient **par pixel** au lieu de par
   quad, pour ~+20 % sur `mesh.frag` au lieu de ×4. Meilleur levier, et il
   supprime la cause principale.

   Appliqué : `mrValueNoiseD(p, out grad)` développe la forme trilinéaire en
   `k0..k7` — algébriquement identique aux `mix` imbriqués, donc le rendu de
   `rockAlbedo.glsl` est inchangé — et `mrHeight` accumule le gradient octave par
   octave (`grad += (amp·w/λ)·g`). `microReliefNormal` projette ensuite ce gradient
   3D sur la surface (`∇h − n(n·∇h)`), ce qui est exactement ce que reconstruisait
   l'ancienne base duale `(r1, r2, det)`, mais par pixel. Seule `pixelM` reste une
   dérivée d'écran : grandeur basse fréquence, sa quantification par quad est sans
   effet visible. Pas de sortie anticipée sur `amount <= 0` : un branchement
   divergent contenant `dFdx` rendrait les dérivées indéfinies, et à amplitude
   nulle la fonction retourne déjà `normalize(n)`.
2. ✅ **Fondu d'octaves anticipé** (`0.5λ → 1.4λ`) : deux constantes, coût nul,
   élimine l'octave qui bat à Nyquist. `raFbm` (`rockAlbedo.glsl`) garde son fondu
   `0.25λ → 0.9λ` : à λ = 22 m et 6,5 m, très au-dessus de l'empreinte pixel, il ne
   contribue pas au repliement.
3. ⏸️ **SSAA ×2 du FBO LiDAR**, si 1+2 ne suffisent pas. Le FBO est privé et déjà
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

---

## 5. Palettes : moucheté, seuils et réflectance

Signalé le 2026-09-06 : « le shader *Été* est tout cassé suite à nos travaux
(artefact de partout) », et « le shader *Montagne* n'a été travaillé que pour les
hautes altitudes ». Référence de travail : une photo aérienne oblique de la Dent
de Crolles (2062 m) — barre calcaire claire, large épaulement de pelouse
jaune-vert, résineux sombres épars, pas un flocon de neige.

### 5.1 Le moucheté venait de la normale, pas des effets

L'intuition naturelle accusait le micro-relief ou la patine. Faux : à
*Micro-relief* 0 et *Patine* 0 le moucheté restait. La preuve décisive vient du
preset **Pente**, qui affiche des pentes de 50-70° (magenta) sur un plateau
quasi plat : la normale **par sommet** porte des dizaines de degrés de bruit
angulaire, amplifié par `sharpenMeshPositions`, par les normales robustes IRLS
et par un lissage sensible aux arêtes qui *préserve* délibérément les
désaccords > 35°. Les transitions de palette ne font que quelques degrés de
large : le bruit devenait du poivre-et-sel. Le défaut touchait **tous** les
presets, pas seulement *Été*.

Correctif : la couleur est calculée sur une normale **macro** dédiée
(`macroVertexNormals`, 24 passes de moyenne un-anneau isotrope, soit un rayon de
diffusion ≈ `espacement × √passes` ≈ 2,5 m), encodée en `Uint8Array` et
transportée jusqu'au recoloriage live et à la sérialisation des scènes.
L'éclairage garde la normale géométrique fine : seul le **zonage d'albédo** est
découplé. Corollaire général — *un albédo zoné ne doit jamais lire la normale
d'éclairage*.

Deux causes secondaires supprimées au passage :

- l'indice de rugosité (`coherence`) assombrissait l'albédo du preset *Été* ;
  cette métrique étant elle-même bruitée, elle produisait du moucheté sombre. Le
  cue est retiré de bout en bout ;
- le re-seuillage de bord de névé de `rockAlbedo.glsl` s'appuie sur un
  `smoothstep(0.55, 0.80, lum)` *(depuis relevé à 0,76-0,86, voir §5.7)*. La
  luminance du calcaire ensoleillé tombe en
  plein dedans : les barres se faisaient re-découper en plaques. D'où
  `u_snowPalette`, à 1 seulement sur les palettes qui peignent effectivement de
  la neige (aujourd'hui le seul preset *Terrain*). **Un masque indexé sur la
  luminance mé-classe silencieusement toute palette dont la plage de clarté
  diffère de celle pour laquelle il a été réglé.**

### 5.2 Seuils : l'herbe tient plus raide qu'on ne le croit

Une fois le moucheté parti, la scène est ressortie **blanchie, sans vert**. Le
preset *Pente* sert alors une seconde fois, comme instrument de mesure :
l'épaulement herbeux entier est à **30-32°**, or la palette basculait déjà vers
le calcaire à 30°. La prairie était donc peinte en rocher — et un calcaire de
ρ ≈ 0,31 rendu sous l'éclairement de la scène (≈ 1,8) ressort à ~213 en valeur
d'affichage, c'est-à-dire quasi blanc. La palette était juste, le **seuil** ne
l'était pas.

Sur les épaulements calcaires, la pelouse couvre encore des pentes à **35-40°** ;
la roche nue n'apparaît qu'au-dessus, sur les barres et les vires. Rupture
reculée à 36-45°.

La palette *Montagne* souffrait du symptôme jumeau, en altitude : ligne de neige
à 2000-2600 m et alpage plafonné à 2100 m, calibrés pour du haut massif. Un
sommet de Chartreuse à 2062 m ressortait en rocher enneigé. Neige remontée à
2700-3200 m (± 300 m selon l'orientation) et ceinture d'alpage jusqu'à 2600 m
avec un fondu de 700 m : *Montagne* est désormais valable dès ~1500 m. Ces
altitudes sont depuis **réglables** — voir §5.5.

Enfin, **la saturation**. L'ambiante hémisphérique est une lumière de ciel, donc
bleue : additionnée au soleil elle remonte le canal bleu d'environ 25 % avant le
tone mapping, qui désature encore les hautes lumières. Une herbe d'albédo neutre
ressort en kaki pastel. On creuse le bleu de l'albédo pour compenser — la
pelouse rendue retrouve le jaune-vert franc de la photo.

### 5.3 La végétation aussi doit être une réflectance

À ces altitudes la végétation occupe une grande part de l'image, et elle passe
par le **même** `pbrShade` que la roche. Or `vegRampColor` est une palette de
*carte* : elle encode déjà une lecture (cime lumineuse, sous-bois sombre) et
culmine sur un jaune-vert de luminance 0,87. Traitée comme un albédo et
multipliée par l'éclairement solaire, elle donnait des confettis vert acide.

Un couvert résineux est au contraire l'une des surfaces les plus sombres du
visible — ρ ≈ 0,03 rouge, 0,05-0,08 vert, 0,03 bleu, les aiguilles piégeant la
lumière par diffusion multiple dans le houppier. C'est exactement ce que montre
la photo : des arbres presque noirs détachés sur la pelouse claire. D'où
`vegRampColorPbr`, même structure verticale mais dans la bonne plage de
réflectance, sélectionnée par `u_pbr`. La palette de carte est inchangée hors
photoréalisme.

### 5.5 Une seule limite climatique pour la neige et pour l'herbe

Restait un reproche : « l'herbe est un poil trop jaune ». Le creusement du bleu
de §5.2 était allé un cran trop loin. Mais le corriger a rouvert une question de
fond : *à quelle altitude* l'herbe est-elle censée jaunir ?

Les deux palettes qui peignent de la pelouse répondaient séparément — *Été*
avec une rampe de pente seule, *Montagne* avec une couleur d'alpage constante
sous un plafond en dur. Or sur le terrain la même limite gouverne les deux
phénomènes : là où la neige tient tard, la saison de végétation est courte et le
sol squelettique, la pelouse se clairseme et laisse voir la terre ; 800 m plus
bas, elle est grasse. **La ligne des neiges d'été et la limite de l'alpage sont
la même limite climatique.**

D'où un modèle de pelouse unique, `alpineTurf(z, pente, ligneDeNeige)`, partagé
par les deux presets, et un seul réglage : le curseur *Ligne de neige*
(1200-3600 m, défaut 2700). Il déplace ensemble les névés de *Montagne*, la
ceinture d'alpage, l'enneigement d'*Hiver* (à 1700 m en dessous) et le
dessèchement de l'herbe. Le dessèchement est confiné aux **700 derniers mètres**
sous la ligne : abaisser le curseur sous le relief affiché suffit à passer la
scène du vert au paillé, ce qui en fait aussi le réglage d'ambiance « fin d'été »
que la palette n'offrait pas.

Deux conséquences de mise en œuvre :

- `snowLine` est un **paramètre requis** de `vertexColor` / `colorsFromNormals` /
  `recolorMeshVertices`, pas un paramètre optionnel avec défaut : c'est le
  compilateur qui garantit qu'aucun site d'appel n'ignore silencieusement le
  réglage de l'utilisateur. *(Ces paramètres sont depuis regroupés dans un objet
  `PaletteSettings`, toujours requis — voir §5.7.)*
- Le recoloriage est **CPU**, sur le thread principal (~0,45 s pour 1,5 M
  sommets). Le curseur affiche donc sa valeur immédiatement mais ne déclenche le
  repeint qu'après 150 ms de stabilité, comme les curseurs forêt. Le réglage
  n'est **pas** un paramètre de capture : il rejoue à chaud, il appartient à
  l'ambiance de scène.

### 5.6 Piège de méthode : les portes ne compilent pas le GLSL

`npx tsc -b`, `npm run lint:test`, `npm run test:run` et `npm run build`
ignorent totalement le contenu des shaders — `vite-plugin-glsl` ne fait qu'un
`#include` textuel. Une erreur GLSL ne se voit qu'à l'exécution, sous la forme
d'un `Shader compile: ERROR: 0:NNN` en console, et fait planter
`LidarWebGLLayer._initGL` dans `onAdd`, donc tout `<LidarCloudOverlay>`. **Après
toute édition de shader : recharger la page et lire la console.** Un rechargement
complet est obligatoire, le HMR ne reconstruit jamais les instances de couche.

### 5.7 Cinq presets pour deux natures de palette

Le sélecteur *Shader* proposait *Mono*, *Falaise*, *Hiver*, *Montagne*, *Pente*.
Cinq entrées, mais **deux natures** seulement :

- des **palettes de carte** — *Mono* et *Pente* encodent une lecture (« où est
  le raide ? »), pas une matière. Elles n'ont rien à faire dans une fusion ;
- des **albédos physiques** — *Falaise*, *Hiver* et *Montagne* essaient toutes
  les trois de peindre la même montagne à des saisons différentes.

Or §5.5 avait déjà fait l'essentiel du travail : *Falaise* et *Montagne*
partageaient `alpineTurf` et se calaient sur la même ligne de neige. Leur seul
vrai écart restant était la **rampe de roche** — un calcaire urgonien clair
contre un cristallin sombre. D'où la fusion : un unique preset **Terrain**
(`terrainAlbedo`), et la lithologie sortie en réglage propre.

**Pourquoi la roche est un preset et pas un curseur.** Le critère retenu : *un
curseur se justifie quand il correspond à une grandeur qui varie réellement sur
le terrain et que l'utilisateur sait nommer ; un preset se justifie quand il
encode une calibration qu'il ne peut pas deviner.* La lithologie n'est ni une
saison ni une ambiance — elle ne dépend que du massif — et surtout ce n'est pas
une teinte qu'on multiplierait : le calcaire **s'éclaircit** avec la pente (les
barres verticales sont lavées par le ruissellement, ρ passe de 0,65 à 0,67 avant
de chuter sur les vires ombreuses) là où le granite et le schiste
**s'assombrissent** (la patine claire cède la place à la cassure fraîche). Seule
une rampe complète exprime ça, d'où `ROCK_RAMPS: Record<RockType, …>`.

**Pourquoi *Hiver* est supprimé et non fusionné.** Il cuisait un assombrissement
d'orientation dans l'albédo (précisément l'erreur corrigée en §5.1), travaillait
par seuils durs, et sa neige `[252, 253, 255]` vaut ρ ≈ 0,97 — une réflectance
qui n'existe pas, même sur de la poudreuse fraîche. *Terrain* avec une ligne de
neige basse **est** l'hiver, en mieux : bord de névé dentelé par le bruit,
rétention modulée par la pente, décalage nord/sud de 300 m.

**Ce que la fusion a coûté en GLSL.** Le re-seuillage de bord de névé de
`rockAlbedo.glsl` était réglé sur la plage de clarté de l'ancienne palette
*Montagne*. Le calcaire de *Terrain* plafonne à 172/255 = **0,674** de
luminance : il tombait en plein dans le `smoothstep(0.55, 0.80, …)` et se faisait
traiter comme de la neige. Fenêtre remontée à **`RA_SNOW_LO = 0.76` /
`RA_SNOW_HI = 0.86`**, juste au-dessus de la roche la plus claire que la palette
sache produire et juste en dessous de la neige tassée (0,85). Le bruit de la
fenêtre est en outre éteint aux deux bornes (`× 4t(1-t)`), sinon un tirage
extrême suffisait à pousser `tn` à 0,29 sur du rocher sans le moindre névé. Les
mêmes bornes sont répliquées dans `mesh.frag` (`rockness`) — **à garder en
phase**.

`u_snowPalette` **reste** nécessaire : le jaune `[255, 235, 59]` de la palette
*Pente* a une luminance de 0,83 et serait lu comme de la neige.

**Mise en œuvre.** Les trois réglages voyagent dans un objet
`PaletteSettings { preset, snowLine, rock }`, toujours requis. Avec un troisième
axe et des réglages de saison explicitement remis à plus tard, l'objet évite de
re-câbler tous les sites d'appel à chaque ajout, sans rien perdre de la garantie
du compilateur.

**Compromis assumé.** Choisir *Été* garantissait l'absence de neige ; désormais
un curseur mal placé peut enneiger une scène de Chartreuse en août. Le risque est
faible avec le défaut à 2700 m, et c'est le prix de la continuité saisonnière.

**Effet de bord connu.** `TURF_TOP_FADE_M` (700 m) et `TURF_DRY_SPAN_M` (700 m)
se recouvrent : une pelouse n'atteint donc jamais son jaune sec par la seule
altitude — près de la ligne de neige elle cède au rocher avant. Laissé tel quel,
allonger `TURF_DRY_SPAN_M` reviendrait à défaire le dé-jaunissement validé en
§5.5.

**Une piste.** La lithologie pourrait à terme être *lue* au lieu d'être choisie,
sur le WFS BRGM 1/50 000, exactement comme BD Forêt fournit déjà l'essence.
