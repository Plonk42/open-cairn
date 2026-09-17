#!/usr/bin/env node
/**
 * Regenerates `src/lib/ignToponymLayers.json` from the official IGN vector-tile
 * style.
 *
 * The Géoplateforme publishes several ready-made styles for the `PLAN.IGN`
 * vector tileset; `toponymes.json` is the one Cartes IGN drapes over the
 * textless rasters. It carries 235 layers: the road/building geometry AND the
 * 117 `symbol` layers that draw the toponyms. We keep ONLY the symbol layers —
 * the geometry is already painted by the Plan IGN HD raster underneath, and
 * over-printing it would ruin the look.
 *
 * The extracted layers are rebound to our own source id and namespaced so they
 * cannot collide with the app's own layers.
 *
 * Usage: node tools/fetch-ign-toponyms.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STYLE_URL = 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/toponymes.json';
const SOURCE_ID = 'ign-toponyms';
const ID_PREFIX = 'ign-toponym-';
const OUT = fileURLToPath(new URL('../src/lib/ignToponymLayers.json', import.meta.url));

const response = await fetch(STYLE_URL);
if (!response.ok) throw new Error(`${STYLE_URL} → HTTP ${response.status}`);
const style = await response.json();

const layers = style.layers
    .filter((layer) => layer.type === 'symbol')
    .map(({ id, type, 'source-layer': sourceLayer, minzoom, maxzoom, filter, layout, paint }) => {
        // `visibility: visible` is the default; dropping it keeps the file lean.
        const { visibility, ...rest } = layout ?? {};
        return {
            id: ID_PREFIX + id,
            type,
            source: SOURCE_ID,
            'source-layer': sourceLayer,
            ...(minzoom === undefined ? {} : { minzoom }),
            ...(maxzoom === undefined ? {} : { maxzoom }),
            ...(filter === undefined ? {} : { filter }),
            layout: rest,
            ...(paint === undefined ? {} : { paint }),
        };
    });

writeFileSync(OUT, JSON.stringify(layers, null, 4) + '\n');
console.log(`${layers.length} symbol layers → ${OUT}`);
