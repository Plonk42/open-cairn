# Survol 3D (Flyover)

## Pour les utilisateurs

Le bouton **Survol** dans le panneau d'itinéraire lance une animation de la caméra
le long du tracé, en vue 3D inclinée, comme un drone.

- **Vitesse** ajustée automatiquement : un trajet trop court est ralenti (min ~15 s),
  un trajet trop long est accéléré (max ~90 s). Le départ et l'arrivée sont **progressifs**
  (accélération puis décélération sur les 12 % de chaque extrémité).
- **Trajectoire lissée** : la caméra ne suit pas la polyligne GPX mais une copie lissée
  de celle-ci, ce qui supprime les à-coups de direction à chaque sommet du tracé.
- **Tout s'adapte à la vitesse réelle** : plus le survol est rapide, plus le cap est
  anticipé loin et lissé large, et plus la caméra prend de hauteur — de sorte que le
  paysage défile toujours à la même allure à l'écran. Un 50 km survolé en 90 s file à
  620 m/s : à cette vitesse, suivre les lacets un par un serait illisible.
- **Le repère de progression reste à l'écran** : la caméra suit le tracé d'assez près
  pour que le point orange ne sorte pas du cadre dans les épingles.
- **Altitude** : la caméra suit le profil altimétrique de l'itinéraire, lissé.
- **Pitch** de 70° (regard incliné vers l'horizon).

Cliquez à nouveau pour interrompre. Tout autre interaction (déplacement de la carte,
clic sur un autre bouton) interrompra également l'animation visuellement, mais ne
**libère pas proprement** le contrôleur (cf. limitations).

### Limitations connues

- Pas de **AbortSignal** : interrompre brutalement (changement de page, etc.) ne
  notifie pas le contrôleur.
- La durée maximale (90 s) est le vrai réglage de confort sur un long tracé, et elle
  n'est **pas exposée dans l'UI**.
- Tracés très courts (< 2 points) : survol silencieusement ignoré.
- Le lissage de trajectoire **coupe les lacets** : c'est voulu pour la caméra, mais le
  survol ne passe donc pas exactement sur le tracé affiché, et d'autant moins qu'il est
  rapide.

---

## Pour les développeurs

### Fichier

[src/lib/flyover.ts](../src/lib/flyover.ts) — classe `FlyoverController`.

### API

```ts
const ctrl = new FlyoverController();
ctrl.start(map, routeCoordinates, {
  profile,                                  // requis : le profil altimétrique du store
  onProgress: (distanceMeters) => { ... },
});
ctrl.stop();
```

`profile` est **requis** : c'est lui qui donne l'altitude de la caméra (voir plus bas).

### Paramètres par défaut

```ts
{
  pitch: 70,
  speed: 25,                       // m/s — la vitesse de croisière visée
  minDurationMs: 15000,
  maxDurationMs: 90000,
}
```

Le zoom n'est plus un paramètre : il est **déduit de la vitesse**.

Constantes internes (non exposées) :

```ts
LOOK_AHEAD_SECONDS = 2             // centre caméra
BEARING_LOOK_AHEAD_SECONDS = 5     // point de cap
HEADING_SMOOTH_SECONDS = 5         // lissage du chemin qui sert au cap
CENTER_SMOOTH_SECONDS = 1.2        // lissage du chemin que la caméra suit
PATH_SMOOTH_PASSES = 2
VISIBLE_SECONDS = 14               // largeur de terrain gardée à l'écran -> zoom
PATH_STEP_METERS = 20              // pas de rééchantillonnage du chemin
CAMERA_CLEARANCE_METERS = 200
EASE_EDGE = 0.12                   // part du survol passée en rampe de vitesse
MAX_AHEAD_SHARE = 0.4              // plafond d'anticipation, pour les tracés courts
MIN_ZOOM = 11.5 / MAX_ZOOM = 15
```

### Le principe : des secondes, pas des mètres

Sur un itinéraire long, ce n'est **pas** `speed` qui fixe l'allure, c'est
`maxDurationMs`. Un 49 km bouclé en 90 s file à **620 m/s**, soit 25 fois la vitesse
nominale ; un 2 km reste à 25 m/s. Un rayon de lissage ou une distance d'anticipation
exprimés en mètres et réglés à une extrémité de cette plage sont absurdes à l'autre :
1200 m d'anticipation de cap valent 48 s de vol à 25 m/s et 2 s à 620 m/s.

Toutes les distances de la caméra sont donc exprimées en **secondes de vol** et
multipliées par la vitesse de croisière effective, calculée une fois au décollage :

```ts
const durationMs = clamp((total / speed) * 1000 / (1 - EASE_EDGE), minDurationMs, maxDurationMs);
const cruiseSpeed = total / ((durationMs / 1000) * (1 - EASE_EDGE));
```

Conséquence utile : lisser la trajectoire sur *N* secondes borne le taux de rotation à
environ `1/N` rad/s **quelle que soit la vitesse** — or le tremblement, c'est
précisément la vitesse angulaire. Mesuré sur un 49 km réel (Vercors, lacets), à
60 fps : cap médian **2,5 °/s**, p99 **21,7 °/s** (contre 18,9 et 152,9 avec les
constantes métriques précédentes).

### Zoom

```ts
metersPerPixel = vitesseDuCheminLissé * VISIBLE_SECONDS / canvasWidthPx;
```

borné à `[11.5, 15]`. Le cadre garde donc ~14 s de vol devant lui, ce qui rend le
déplacement **en pixels** par frame à peu près constant quelle que soit la vitesse.

⚠️ La vitesse utilisée ici est celle de la **caméra**, pas celle du coureur. Le chemin
lissé coupe les lacets : sur un très long tracé sinueux il peut être moitié plus court
que l'itinéraire, donc la caméra n'avance qu'à la moitié de `cruiseSpeed` alors que le
zoom, lui, était calculé pour la vitesse nominale — le survol paraît **deux fois trop
lent, et d'autant plus que le tracé est long**. `pathSpeed()` mesure donc la longueur du
chemin réellement parcouru. Mesuré sur des tracés synthétiques de 85 à 353 km de
sinuosité croissante : **74 à 76 px/s** dans tous les cas (contre 21 px/s avant sur un
85 km réel). Seuls les tracés courts descendent plus bas, parce que `MAX_ZOOM` les
empêche de s'approcher davantage.

### Chemin de vol

La polyligne d'un itinéraire n'est que **C0** : sa direction saute à chaque sommet, et
une caméra qui la suit sursaute avec elle. `smoothPath()` en construit donc une copie
lissée, une seule fois avant le décollage :

1. rééchantillonnage à pas d'abscisse curviligne constant (20 m) ;
2. deux passes de **moyenne glissante** (fenêtre symétrique qui rétrécit aux extrémités,
   pour que départ et arrivée restent exactement sur le tracé).

Deux passes de moyenne approchent une gaussienne, et le filtre étant symétrique il
n'introduit **aucun retard** — contrairement à un lissage par lerp, qui faisait
« élastique » derrière le tracé.

**Deux chemins, deux fenêtres.** Le cap a besoin d'un lissage large (5 s) pour rester
calme ; le centre de la caméra, non : à 1000 m/s une fenêtre de 5 s vaut 5 km de part et
d'autre, et le chemin lissé passe alors à des kilomètres du tracé dans les lacets —
**le point orange sort du bas de l'écran** (mesuré : 11 % du survol hors cadre). Le
chemin du centre n'est donc lissé que sur 1,2 s. Après correction, sur toute une gamme
de sinuosités : **0 %** hors cadre, le marqueur reste dans le tiers central.

### Une seule abscisse : celle de l'itinéraire réel

Les chemins lissés ont leur propre longueur d'arc, plus courte. Les indexer par
**elle** est un piège : la caméra et le marqueur ne décrivent alors plus le même point
de l'itinéraire, et la caméra avance moins vite que la distance rapportée. Toutes les
séries (positions lissées, cap, altitudes) sont donc échantillonnées à pas constant et
indexées par la distance sur l'**itinéraire réel** : l'échantillon `i` correspond à
`i × step` mètres de tracé, et `onProgress` renvoie exactement la distance qui a servi à
placer la caméra.

### Boucle principale

Tout ce que lit la caméra est une fonction lisse de l'abscisse curviligne, et
l'abscisse est une fonction lisse du temps écoulé. Il n'y a donc **aucun filtre par
frame** dans la boucle : rien n'y dépend du framerate, et le survol est reproductible.

```mermaid
flowchart TD
    Start[start&#40;&#41;] --> Speed[durée puis<br/>cruiseSpeed]
    Speed --> Smooth[smoothPath&#40;&#41; × 2<br/>centre 1,2 s / cap 5 s]
    Smooth --> Zoom[zoomForSpeed&#40;pathSpeed&#41;]
    Smooth --> Alt[buildAltitudeProfile&#40;&#41;<br/>profil lissé, précalculé]
    Alt --> RAF[requestAnimationFrame loop]
    Zoom --> RAF
    RAF --> T[p = elapsedMs / durationMs]
    T --> Ease[d = easedDistanceFraction&#40;p&#41;<br/>* longueur de l'itinéraire]
    Ease --> Apply[map.jumpTo&#40;{ center, bearing,<br/>pitch, zoom, elevation }&#41;]
    Apply --> Cb[onProgress&#40;d&#41;<br/>à chaque frame]
    Cb --> Done{p >= 1?}
    Done -->|non| RAF
    Done -->|oui| End[onEnd&#40;&#41;]
```

### Calcul du cap

```ts
function bearing(p1, p2) {
  const φ1 = lat1 * π/180;
  const φ2 = lat2 * π/180;
  const Δλ = (lng2 - lng1) * π/180;
  const y = sin(Δλ) * cos(φ2);
  const x = cos(φ1) * sin(φ2) - sin(φ1) * cos(φ2) * cos(Δλ);
  return atan2(y, x) * 180/π;
}
```

Le cap est la direction entre le point courant et un point situé 5 s plus loin, **sur le
chemin lissé sur 5 s**. Comme le lissage a supprimé tout ce qui est plus court que 5 s de
vol, la corde ne peut pas se replier sur elle-même : c'est ce qui rend le calcul bien
conditionné dans les épingles, là où une corde de longueur fixe se refermait et faisait
pivoter la caméra de plusieurs centaines de degrés par seconde.

### Anticipation décroissante

Le centre de la caméra vise `d + lookAhead`, et le cap une corde qui démarre à `d`.
Près de l'arrivée ces points dépassent la fin du tracé. Les **borner** au dernier point
(`min(d + lookAhead, total)`) fige la caméra pendant que le marqueur, lui, continue de
ramper : mesuré, la caméra restait **immobile 3 s** avant la fin — elle avait l'air de
s'arrêter net. C'est aussi ce qui réduirait la corde de cap à zéro (`atan2(0, 0) = 0`,
caméra plein nord).

L'anticipation décroît donc linéairement sur toute la longueur, ce qui la rend nulle
pile à l'arrivée :

```ts
center  = chemin[d * (1 - lookAhead / total) + lookAhead]
capDe   = chemin[d * (1 - headingAhead / total)]
```

La pente vaut 0,975 sur un long tracé : invisible en vol, et la caméra se pose sur la
fin en même temps que le marqueur, en décélérant. `MAX_AHEAD_SHARE` plafonne les deux
anticipations à 40 % du tracé, sans quoi un tracé très court rendrait la pente négative.

### Durée

```ts
const naturalDuration = (totalDistance / speed) * 1000 / (1 - EASE_EDGE);
const durationMs = clamp(naturalDuration, minDurationMs, maxDurationMs);
```

La division par la part de croisière compense les rampes : sans elle, la vitesse au milieu
du survol dépasse `speed` de 14 %.

La distance parcourue n'est pas linéaire en temps : `easedDistanceFraction()` intègre un
profil de vitesse trapézoïdal à rampes en smoothstep, de sorte que la **vitesse** (et pas
seulement la position) est continue au décollage et à l'atterrissage.

### Altitude de la caméra

**`jumpTo()` remet `transform.elevation` à 0.** Vérifié sur MapLibre 5 : un
`map.jumpTo({ center, zoom, pitch, bearing })` écrase l'altitude du centre. Faire suivre
d'un `setCenterElevation()` laisse donc la caméra à l'altitude 0 — c'est-à-dire sous la
montagne — pendant le reste de la frame, avec les événements `move` et la correction
interne de MapLibre qui s'exécutent dans cet état. L'altitude est donc passée **dans le
même `jumpTo`**, en une seule écriture caméra par frame.

**L'altitude vient du profil de l'itinéraire, pas du MNT.** La version précédente
prenait le `max` du terrain sur un corridor devant la caméra, à chaque frame : un
opérateur non lisse dont l'argmax saute, qu'il fallait ensuite pourchasser avec un
amortisseur. Le profil altimétrique de l'itinéraire (`route.profile`, déjà chargé pour le
graphe) est disponible **en entier dès le décollage** : il est donc échantillonné une
fois le long de l'itinéraire, lissé sur la fenêtre large (celle du cap), et simplement
interpolé pendant le vol. Zéro requête `queryTerrainElevation` par frame, zéro
amortisseur, continuité par construction. `CAMERA_CLEARANCE_METERS` compense le fait
que le lissage rabote les sommets.

Si le profil est vide (appel IGN échoué), l'altitude retombe sur une constante lue au
point de départ : dégradé, mais jamais tremblant. Sans terrain 3D, elle vaut 0, comme
MapLibre l'attend.

### Coût côté React

`onProgress` alimente `setHoverDistance` dans le store — appelé à **chaque frame**. Deux
choses le rendaient ruineux, toutes deux corrigées hors de ce fichier :

- l'abonnement au `routeStore` dans [MapContainer.tsx](../src/components/map/MapContainer.tsx)
  réécrivait les **six** sources GeoJSON à chaque changement du store, donc re-tuilait
  toute la trace (des milliers de sommets, deux fois : ligne + tirets de snapping) et les
  53 marqueurs juste pour déplacer un point. Il ne met plus à jour que les sources dont
  la donnée a réellement changé (comparaison de références avec `prevState`) ;
- `waypointMarkers` et `dashedRanges` étaient reconstruits à chaque rendu de
  [RoutePanel.tsx](../src/components/ui/RoutePanel.tsx) ; `dashedRanges` étant dans les
  dépendances de l'effet qui **construit** le graphe, chaque mise à jour du curseur
  détruisait et reconstruisait l'instance Chart.js. Les deux sont désormais `useMemo`.

C'est ce qui donnait l'impression que le point orange « sautait d'étape en étape » : il
n'était pas seulement throttlé, il était bloqué derrière ce travail.

### Améliorations possibles

- **Exposer la durée dans l'UI** : c'est le seul vrai arbitrage restant sur un long
  tracé (90 s pour 50 km = 620 m/s), et il n'appartient pas au code.
- **Pitch dynamique** : pitch plus haut sur tronçon raide ascendant, plus bas sur
  descente, pour simuler un drone qui suit le profil.
- **AbortSignal natif** au lieu d'un drapeau interne `aborted`.
- **Enregistrement vidéo** (`MediaRecorder`) : nécessiterait de piloter la boucle sur un
  pas de temps fixe plutôt que sur l'horloge, pour que la vidéo ne dépende pas du
  framerate réel.
- **Boucle** en fin de parcours.
