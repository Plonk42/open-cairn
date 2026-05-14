# open-crete

3D web map with **multiply-blended** LiDAR HD hillshade over IGN SCAN 25.

This repository implements the technical solution analyzed in [ANALYSIS.md](ANALYSIS.md):
a static web app (Vite + React + TypeScript + Tailwind + Zustand + MapLibre GL JS)
deployed on GitHub Pages, using a custom WebGL layer to compose the IGN
`IGNF_LIDAR-HD_MNS_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW` raster with the
`GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN25TOUR` base layer using a true `multiply`
blend mode (not just opacity), while keeping the 3D terrain enabled.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## License

AGPL-3.0 (TBD).
