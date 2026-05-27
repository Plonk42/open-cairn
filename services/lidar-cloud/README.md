# LiDAR HD point cloud service

Petit serveur Node.js qui découpe et décime des dalles IGN LiDAR HD à la
demande pour les afficher en 3D dans le client.

## Lancer

```sh
node services/lidar-cloud/server.mjs
# ou via le script npm
npm run lidar
```

Variables d'environnement (optionnelles) :

| Variable          | Défaut                  | Description                                    |
| ----------------- | ----------------------- | ---------------------------------------------- |
| `PORT`            | `8788`                  | Port HTTP du service                           |
| `CACHE_DIR`       | `./.cache/lidar-cloud`  | Répertoire de cache des dalles `.laz`          |
| `MAX_RADIUS_M`    | `600`                   | Rayon maximal accepté (m)                      |
| `MAX_TILES`       | `9`                     | Nombre maximal de dalles téléchargées/requête  |
| `CACHE_MAX_BYTES` | `8589934592` (8 Gio)    | Taille max du cache disque (éviction LRU)      |

## API

`GET /api/lidar-cloud?lng={lng}&lat={lat}&radius={m}&stride={n}[&class={2,3,4}]`

Retourne un buffer binaire (`application/octet-stream`) :

```
uint32  magic = 0x4C494441 ("LIDA", big-endian)
uint32  pointCount        (LE)
float64 centerLng         (LE)
float64 centerLat         (LE)
float32[3 * pointCount] positions  // (dx_east_m, dy_north_m, alt_m)
uint8  [pointCount]     classifications
```

Les positions sont exprimées en mètres par rapport au centre demandé, dans le
repère Lambert-93 local (~ aligné est/nord pour des bbox < 1 km, compatible
deck.gl `COORDINATE_SYSTEM.METER_OFFSETS`).

`GET /api/lidar-cloud/health` → `{"ok":true}`.

## Limites connues

- Première requête sur une zone non en cache : 10–60 s (téléchargement IGN
  d'une dalle de 0.5–2 Go). Requêtes suivantes : quelques secondes (décodage
  LAZ + filtrage).
- Le décodage LAZ charge toute la dalle en RAM. Pour les très grosses dalles
  ajustez `NODE_OPTIONS=--max-old-space-size=4096`.
- Les dalles ne couvrent pas encore l'intégralité du territoire français (voir
  [l'état d'avancement IGN](https://macarte.ign.fr/carte/mThSup/diffusionMNxLiDARHD)).
