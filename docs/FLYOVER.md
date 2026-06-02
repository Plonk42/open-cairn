# Survol 3D (Flyover)

## Pour les utilisateurs

Le bouton **Survol** dans le panneau d'itinéraire lance une animation de la caméra
le long du tracé, en vue 3D inclinée, comme un drone.

- **Vitesse** ajustée automatiquement : un trajet trop court est ralenti (min ~8 s),
  un trajet trop long est accéléré (max ~30 s).
- **Cap** anticipé sur ~1200 m, ce qui lisse les virages serrés et évite la nausée.
- **Pitch** de 70° (regard incliné vers l'horizon).
- **Zoom** fixé à 14.5.

Cliquez à nouveau pour interrompre. Tout autre interaction (déplacement de la carte,
clic sur un autre bouton) interrompra également l'animation visuellement, mais ne
**libère pas proprement** le contrôleur (cf. limitations).

### Limitations connues

- L'altitude de la caméra est **fixée à +250 m au-dessus du niveau de la mer**, pas
  au-dessus du terrain. En haute montagne, la caméra peut donc passer **sous** le sol.
- Pas de **AbortSignal** : interrompre brutalement (changement de page, etc.) ne
  notifie pas le contrôleur.
- **Pitch non lissé** vers le look-ahead : sur un virage serré couplé à un fort
  changement d'altitude, la caméra peut « clipper ».
- Tracés très courts (< 2 points) : survol silencieusement ignoré.

---

## Pour les développeurs

### Fichier

[src/lib/flyover.ts](../src/lib/flyover.ts) — classe `FlyoverController`.

### API

```ts
const ctrl = new FlyoverController(map, routeCoordinates);
ctrl.start({ onProgress: (distanceMeters) => { ... } });
ctrl.stop();
```

### Paramètres par défaut

```ts
{
  pitch: 70,
  zoom: 14.5,
  speed: 80,                       // m/s
  minDurationMs: 8000,
  maxDurationMs: 30000,
  lookAheadMeters: 300,            // centre caméra
  bearingLookAheadMeters: 1200,    // heading
  cameraHeightAboveTerrain: 250,
  positionSmooth: 0.15,            // lerp factor par frame
  bearingSmooth: 0.05,
  elevationSmooth: 0.08,
}
```

### Boucle principale

```mermaid
flowchart TD
    Start[start&#40;&#41;] --> Index[Indexer la polyline<br/>par distance cumulée]
    Index --> RAF[requestAnimationFrame loop]
    RAF --> T[t = elapsedMs / durationMs]
    T --> Pos[positionTarget = polyline&#91;t * totalDistance&#93;]
    T --> Look[lookAheadTarget = polyline&#91;tPos + 300m&#93;]
    T --> Bear[bearingTarget = bearing&#40;<br/>polyline&#91;tPos+lookAhead&#93;,<br/>polyline&#91;tPos+1200m&#93;&#41;]
    Pos --> Lerp[Lerp courant ↔ target<br/>via smooth factors]
    Look --> Lerp
    Bear --> Lerp
    Lerp --> Apply[map.jumpTo&#40;{ center, bearing, pitch, zoom }&#41;]
    Apply --> Cb[onProgress&#40;currentDistance&#41;]
    Cb --> Done{t >= 1?}
    Done -->|non| RAF
    Done -->|oui| End[stop&#40;&#41;]
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

Le cap target est calculé entre le **point de regard** (+300 m) et un **point de cap**
(+1200 m), pas entre la position et le regard. Cela donne un cap plus « anticipatif »
qui lisse les zig-zags fins.

### Durée

```ts
const naturalDuration = (totalDistance / speed) * 1000;
const durationMs = clamp(naturalDuration, minDurationMs, maxDurationMs);
```

### Lissage

Pour chaque frame, on lerp les valeurs courantes vers leur target :

```ts
current.center = lerp(current.center, target.center, positionSmooth);
current.bearing = lerpAngle(current.bearing, target.bearing, bearingSmooth);
current.elevation = lerp(current.elevation, target.elevation, elevationSmooth);
```

Le `lerpAngle` gère le wrap −180/180.

### Améliorations possibles

- **Camera height above terrain** : interroger `map.queryTerrainElevation()` au point
  de regard et ajouter le delta.
- **Pitch dynamique** : pitch plus haut sur tronçon raide ascendant, plus bas sur
  descente, pour simuler un drone qui suit le profil.
- **AbortSignal natif** au lieu d'un drapeau interne `running`.
- **Easing temporel** sur `t` (ease-in/out) pour démarrage et fin moins brusques.
