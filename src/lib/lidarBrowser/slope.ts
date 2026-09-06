/**
 * Slope-based palette + per-point/per-vertex colorization.
 *
 * Four shader presets are supported:
 *   'base'   — warm sand/brown gradient (CloudCompare-style, original)
 *   'cliff'  — summer limestone massif: alpine meadow on gentle ground, a sharp
 *              break into pale limestone on the cliff bands. Like 'montagne'
 *              this is a **pure albedo** in the physical reflectance range
 *              (meadow ρ ≈ 0.20, clean limestone ρ ≈ 0.40), so it is lit once
 *              and only once by the photorealistic path.
 *   'winter' — snow on flat/north-facing areas, brown rock on cliffs,
 *              driven by slope + elevation + cardinal aspect
 *   'montagne' — same slope/altitude/aspect logic as 'winter' but the output is
 *              a **pure albedo**: no baked shading, no aspect darkening, and
 *              reflectances kept in the physical range (snow ~0.9, alpine rock
 *              ~0.2). Meant for the photorealistic render path, which supplies
 *              all the light itself — a preset that pre-darkens north faces
 *              would be lit a second time and read as dirt.
 *   'slope'  — standard steepness map: green (plat) → jaune → orange → rouge
 *              → violet/rose clair (vertical), the conventional gradient used
 *              for avalanche/ski-touring slope-angle shading (CalTopo,
 *              Avalanche Canada, IGN pentes…). Finely graduated in the steep
 *              range (35°+) and capped on a bright violet/pink rather than
 *              fading to near-black, which stays legible on cliffs.
 */

export type ShaderPreset = 'base' | 'cliff' | 'winter' | 'montagne' | 'slope';

// ─── BASE palette (original CloudCompare-inspired warm gradient) ──────────────
const BASE_PALETTE: Array<[number, [number, number, number]]> = [
    [0, [230, 220, 200]],
    [20, [205, 175, 130]],
    [35, [170, 120, 75]],
    [55, [120, 75, 45]],
    [80, [70, 45, 30]],
];

// ─── CLIFF palette — massif calcaire en été (albédo physique) ────────────────
// Réflectances diffuses réelles d'un versant de Chartreuse/Vercors en août,
// exprimées en valeurs d'affichage sRGB (≈ ρ^(1/2.2)). Aucun ombrage n'y est
// cuit : le chemin photoréaliste multiplie ces valeurs par l'irradiance
// ciel + soleil, donc toute variation de luminosité peinte ici serait comptée
// deux fois. Les anciennes valeurs (rocher à 190-200, soit ρ ≈ 0,5) avaient été
// choisies pour rester lisibles sous une ambiante constante de 0,35 ; sous
// l'éclairage physique elles saturent en blanc dès le premier rayon de soleil.
//
//   pelouse alpine sèche  ρ ≈ 0,20   éboulis calcaire   ρ ≈ 0,30
//   calcaire urgonien     ρ ≈ 0,40   paroi ruisselée    ρ ≈ 0,20
//
// SEUIL DE RUPTURE : l'herbe tient bien plus raide qu'on ne le croit. Sur les
// épaulements de la Dent de Crolles la pelouse couvre encore des pentes à
// 35-40° ; le calcaire nu n'apparaît qu'au-delà, sur les barres et les vires.
// La carte de pente du même maillage donne ~30-32° sur tout l'épaulement
// herbeux, donc une rupture placée à 30° repeignait la prairie en rocher.
const CLIFF_PALETTE: Array<[number, [number, number, number]]> = [
    [0, [112, 124, 68]],
    [25, [120, 128, 74]],
    [36, [130, 131, 88]],
    [45, [158, 152, 132]],
    [58, [172, 167, 154]],
    [75, [164, 159, 148]],
    [90, [128, 124, 116]],
];

// ─── SLOPE palette (standard steepness-map gradient) ─────────────────────────
// Matches the conventional avalanche/ski-touring slope-angle shading scale:
// green (safe, flat) → yellow → orange → red (avalanche-prone 30-45°) →
// magenta/violet on cliffs, ending on a bright violet/pink rather than
// darkening to near-black, so the steepest faces stay readable. Extra stops
// are packed into the 35-90° range for finer granularity on cliffs.
// Inspired by outdoor apps (CalTopo, Avalanche Canada, Gaia GPS, IGN cartes
// de pente).
const SLOPE_PALETTE: Array<[number, [number, number, number]]> = [
    [0, [34, 139, 58]],
    [10, [80, 162, 55]],
    [20, [145, 190, 55]],
    [27, [205, 206, 60]],
    [30, [255, 235, 59]],
    [33, [255, 202, 40]],
    [36, [255, 160, 0]],
    [39, [255, 110, 30]],
    [42, [244, 67, 54]],
    [45, [211, 47, 47]],
    [48, [198, 40, 70]],
    [51, [173, 20, 110]],
    [55, [162, 25, 140]],
    [60, [156, 39, 176]],
    [65, [173, 60, 202]],
    [70, [199, 90, 220]],
    [80, [224, 130, 235]],
    [90, [236, 160, 240]],
];

function interpolatePalette(
    palette: Array<[number, [number, number, number]]>,
    slopeRad: number,
): [number, number, number] {
    const slopeDeg = slopeRad * (180 / Math.PI);
    if (slopeDeg <= palette[0][0]) return palette[0][1];
    for (let i = 1; i < palette.length; i++) {
        const [degHi, colHi] = palette[i];
        if (slopeDeg <= degHi) {
            const [degLo, colLo] = palette[i - 1];
            const t = (slopeDeg - degLo) / (degHi - degLo);
            return [
                Math.round(colLo[0] + (colHi[0] - colLo[0]) * t),
                Math.round(colLo[1] + (colHi[1] - colLo[1]) * t),
                Math.round(colLo[2] + (colHi[2] - colLo[2]) * t),
            ];
        }
    }
    return palette.at(-1)![1];
}

export function slopeColor(slopeRad: number): [number, number, number] {
    return interpolatePalette(CLIFF_PALETTE, slopeRad);
}

// ─── MONTAGNE albedo (photorealistic path) ───────────────────────────────────
// Diffuse reflectances of real alpine surfaces, expressed as sRGB display
// values. Nothing here is shading: the render multiplies these by the sky +
// sun irradiance, so any brightness variation baked in would be counted twice.
// Rock sits around ρ ≈ 0.2 and snow around ρ ≈ 0.85, which is what gives the
// reference renders their range — a palette that puts rock at 0.55 (as the
// legacy presets do, to stay legible under a flat 0.35 ambient) cannot.
const MTN_SNOW_FRESH: readonly [number, number, number] = [238, 240, 245];
const MTN_SNOW_PACKED: readonly [number, number, number] = [214, 217, 223];
// Sunlit alpine granite is not grey: lichen, iron staining and sun-baked
// surfaces give it a distinctly warm tan (R:G:B ≈ 1.00 : 0.90 : 0.73, sampled
// off the reference renders). Freshly broken and overhanging rock never gets
// that patina and stays a near-neutral, slightly cool grey — so the ramp
// warms as it lightens and cools as it darkens.
const MTN_SCREE: readonly [number, number, number] = [162, 146, 118];
const MTN_SLAB: readonly [number, number, number] = [148, 133, 106];
const MTN_ROCK: readonly [number, number, number] = [116, 106, 90];
// Even a shaded, freshly broken granite wall keeps a reflectance around 0.15;
// nothing on a mountain is a light trap. Pushing this darker used to read as
// "dramatic", but under the physical lighting path it collapses to black as
// soon as the face turns away from the sun.
const MTN_ROCK_STEEP: readonly [number, number, number] = [88, 84, 80];
// Pelouse alpine d'été : ρ ≈ 0,20, franchement jaune-vert. C'est la couleur
// dominante d'un versant entre 1500 et 2300 m dès que la pente le permet, et
// c'est elle qui manquait au preset — conçu sur des scènes de 3000 m et plus,
// il ne voyait que du rocher et de la neige.
const MTN_TURF: readonly [number, number, number] = [116, 126, 72];

/**
 * Limite des neiges sur une face plein sud, en été ; les faces nord la tiennent
 * `MTN_ASPECT_SHIFT` plus bas. Les névés résiduels d'août dans les Alpes
 * commencent vers 2400 m en exposition nord et ne deviennent continus que
 * vers 2900 — en dessous, une scène de montagne en été n'a pas un flocon.
 */
const MTN_SNOW_LOW = 2700;
const MTN_SNOW_HIGH = 3200;
const MTN_ASPECT_SHIFT = 300;
/**
 * Altitude où la pelouse alpine cède définitivement la place à la roche nue, et
 * hauteur de la rampe qui l'y mène. La pelouse continue monte jusque vers
 * 2600 m dans les Alpes du Nord ; elle se clairseme dès ~1900, d'où une rampe
 * large plutôt qu'un seuil.
 */
const MTN_TURF_TOP = 2600;
const MTN_TURF_FADE_M = 700;

function lerp3(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    t: number,
): [number, number, number] {
    const k = Math.min(1, Math.max(0, t));
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const smoothstep01 = (x: number): number => {
    const t = Math.min(1, Math.max(0, x));
    return t * t * (3 - 2 * t);
};

/** Bare-ground reflectance: scree on benches, slabs, then dark broken faces. */
function montagneGround(slopeDeg: number, z: number): [number, number, number] {
    let rock: [number, number, number];
    if (slopeDeg <= 25) rock = lerp3(MTN_SCREE, MTN_SLAB, slopeDeg / 25);
    else if (slopeDeg <= 55) rock = lerp3(MTN_SLAB, MTN_ROCK, (slopeDeg - 25) / 30);
    else rock = lerp3(MTN_ROCK, MTN_ROCK_STEEP, (slopeDeg - 55) / 30);
    // Pelouse alpine : partout où la pente laisse la terre tenir, sous la
    // limite de végétation. L'herbe s'accroche bien au-delà des 32° qu'on lui
    // accordait — une épaule herbeuse de 35° est la règle dans les Alpes, pas
    // l'exception — et ne lâche vraiment que vers 40°.
    const turf = smoothstep01((MTN_TURF_TOP - z) / MTN_TURF_FADE_M) * smoothstep01((40 - slopeDeg) / 14);
    return lerp3(rock, MTN_TURF, turf);
}

/**
 * Texture-free alpine albedo: snow versus rock from slope, altitude and
 * orientation only — the same three inputs the reference renders use.
 *
 * Unlike {@link vertexColor}'s 'winter' branch this bakes **no** lighting: no
 * north-face darkening, no blue lift in the shadows. Those belong to the
 * lighting model, which the photorealistic path applies afterwards.
 */
function montagneAlbedo(
    nx: number, ny: number,
    z: number, slopeDeg: number,
): [number, number, number] {
    const ground = montagneGround(slopeDeg, z);
    // +1 = due north (shaded, holds snow lower), -1 = due south.
    const northFacing = Math.cos(Math.atan2(nx, ny));
    const shift = northFacing * MTN_ASPECT_SHIFT;

    // Snow sheds progressively above 32° and never sticks past 58°.
    const retention = smoothstep01((58 - slopeDeg) / 26);
    const elevation = smoothstep01((z - (MTN_SNOW_LOW - shift)) / (MTN_SNOW_HIGH - MTN_SNOW_LOW));
    const snow = retention * elevation;
    if (snow <= 0.01) return ground.map(Math.round) as [number, number, number];

    // Higher and flatter accumulations stay fresh and bright; wind-scoured
    // ridges and lower patches are packed, slightly darker snow.
    const freshness = smoothstep01((z - MTN_SNOW_HIGH) / 600) * 0.6 + retention * 0.4;
    const snowColor = lerp3(MTN_SNOW_PACKED, MTN_SNOW_FRESH, freshness);
    return lerp3(ground, snowColor, snow).map(Math.round) as [number, number, number];
}

/**
 * Full per-vertex colorizer.
 *
 * `nx, ny, nz` must be a **macro** normal — the terrain orientation at the
 * metre-to-decametre scale, not the per-triangle normal used for lighting.
 * Every preset here keys its albedo zoning on the slope angle, often with
 * transitions only a few degrees wide (grass → rock, snow retention…), while a
 * Poisson vertex normal on a 50 cm lapiaz carries tens of degrees of
 * reconstruction noise: feeding it the lighting normal turns that noise into
 * per-vertex salt-and-pepper. See `macroVertexNormals` in `pipeline.ts`.
 */
export function vertexColor(
    nx: number, ny: number, nz: number,
    z: number,
    preset: ShaderPreset,
): [number, number, number] {
    const len = Math.hypot(nx, ny, nz);
    const nzn = len > 0 ? nz / len : 1;
    const slope = Math.acos(Math.max(-1, Math.min(1, Math.abs(nzn))));

    if (preset === 'base') {
        return interpolatePalette(BASE_PALETTE, slope);
    }

    if (preset === 'slope') {
        return interpolatePalette(SLOPE_PALETTE, slope);
    }

    if (preset === 'cliff') {
        return interpolatePalette(CLIFF_PALETTE, slope);
    }

    if (preset === 'montagne') {
        return montagneAlbedo(nx, ny, z, slope * (180 / Math.PI));
    }

    return winterColor(nx, ny, z, slope * (180 / Math.PI));
}

/**
 * Alpine winter render — sharp contrast: near-white snow on anything not too
 * steep above the snow line, warm tan/brown rock on cliffs and crests. Keeps a
 * mild aspect darkening baked into the colour, which is why it is *not* the
 * preset to use with the photorealistic lighting (see 'montagne').
 */
function winterColor(
    nx: number, ny: number,
    z: number, slopeDeg: number,
): [number, number, number] {
    // Aspect: atan2(nx, ny) horizontal-plane bearing; +Y is north in L93.
    // northFacing in [-1, +1] : +1 pure north, -1 pure south.
    const aspect = Math.atan2(nx, ny);
    const northFacing = Math.cos(aspect);

    // ── Bare-rock palette (warm tan → grey-brown → dark cliff)
    // Lighter and warmer than before so rock outcrops "pop" against snow.
    const groundColor = (): [number, number, number] => {
        const SCREE: [number, number, number] = [168, 148, 118];  // light scree / grass-rock
        const ROCK: [number, number, number] = [142, 118, 92];   // warm brown rock
        const CLIFF: [number, number, number] = [86, 70, 56];     // shadowed cliff
        if (slopeDeg <= 30) {
            const t = slopeDeg / 30;
            return [
                Math.round(SCREE[0] + (ROCK[0] - SCREE[0]) * t),
                Math.round(SCREE[1] + (ROCK[1] - SCREE[1]) * t),
                Math.round(SCREE[2] + (ROCK[2] - SCREE[2]) * t),
            ];
        }
        const t = Math.min(1, (slopeDeg - 30) / 50);
        return [
            Math.round(ROCK[0] + (CLIFF[0] - ROCK[0]) * t),
            Math.round(ROCK[1] + (CLIFF[1] - ROCK[1]) * t),
            Math.round(ROCK[2] + (CLIFF[2] - ROCK[2]) * t),
        ];
    };

    const [gr, gg, gb] = groundColor();

    // Hard floor: nothing below 1000 m gets snow
    if (z < 1000) return [gr, gg, gb];

    // ── Snow accumulation factors ────────────────────────────────────────────
    // Aspect-shifted snow line: north faces gain snow ~250 m earlier.
    const aspectShift = northFacing * 250; // metres
    const snowLow = 1000 - aspectShift;
    const snowHigh = 2000 - aspectShift;

    // Slope retention: full snow up to 30°, gone by 55°. Sharper than before.
    let snowSlope: number;
    if (slopeDeg <= 30) snowSlope = 1;
    else if (slopeDeg >= 55) snowSlope = 0;
    else {
        const s = 1 - (slopeDeg - 30) / 25;
        snowSlope = s * s; // ease so steep slopes shed faster
    }

    // Elevation factor: smoothstep then sharpen (gamma) → near-binary look
    const eRaw = Math.min(1, Math.max(0, (z - snowLow) / (snowHigh - snowLow)));
    const eSmooth = eRaw * eRaw * (3 - 2 * eRaw);
    // Sharpen with a contrast curve centered at 0.5
    const snowElev = Math.pow(eSmooth, 0.6);

    let snowAmount = snowElev * snowSlope;

    // Above 2000 m, force full snow wherever slope allows
    if (z >= 2000) snowAmount = snowSlope;

    // Hard threshold: anything > 0.7 jumps to 1 (clean snow areas),
    // < 0.15 drops to 0 (clean rock areas). Mid-range stays smooth.
    if (snowAmount > 0.7) snowAmount = 1;
    else if (snowAmount < 0.15) snowAmount = 0;
    else snowAmount = (snowAmount - 0.15) / 0.55;

    if (snowAmount === 0) return [gr, gg, gb];

    // ── Snow color ──────────────────────────────────────────────────────────
    // Bright near-white snow. Subtle shading only on truly south-facing AND
    // steep snow surfaces (slope > 20°) to evoke shadow without muddying.
    const SNOW_BRIGHT: [number, number, number] = [252, 253, 255];
    let snowR = SNOW_BRIGHT[0], snowG = SNOW_BRIGHT[1], snowB = SNOW_BRIGHT[2];

    // Aspect/slope shading: north faces darker (shadowed in northern hemisphere
    // winter when sun is south-low). Keep effect mild so snow stays white.
    const shadeFactor = Math.max(0, northFacing) * Math.min(1, slopeDeg / 25);
    if (shadeFactor > 0) {
        const k = 1 - shadeFactor * 0.1; // up to 10 % darkening
        snowR = Math.round(snowR * k);
        snowG = Math.round(snowG * k);
        snowB = Math.round((snowB + 4) * k); // tiny blue lift in shadow
    }

    if (snowAmount === 1) return [snowR, snowG, snowB];

    // Smooth blend at the snow/rock boundary
    return [
        Math.round(gr + (snowR - gr) * snowAmount),
        Math.round(gg + (snowG - gg) * snowAmount),
        Math.round(gb + (snowB - gb) * snowAmount),
    ];
    // ── end WINTER ────────────────────────────────────────────────────────────
}

/**
 * Recompute RGBA colors for a mesh given its stored per-vertex data.
 *
 * `macroNormals` is the decametre-scale orientation field (Uint8, 3 per vertex,
 * `v * 127.5 + 127.5`) built at reconstruction time; it — not the lighting
 * normal — is what the palette must see. Meshes built before it existed
 * (Delaunay/Mixed) fall back to the lighting normal.
 */
export function recolorMeshVertices(
    normals: Float32Array,
    positions: Float32Array,
    macroNormals: Uint8Array | undefined,
    preset: ShaderPreset,
): Uint8Array {
    const n = normals.length / 3;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nx = macroNormals ? macroNormals[i * 3] / 127.5 - 1 : normals[i * 3];
        const ny = macroNormals ? macroNormals[i * 3 + 1] / 127.5 - 1 : normals[i * 3 + 1];
        const nz = macroNormals ? macroNormals[i * 3 + 2] / 127.5 - 1 : normals[i * 3 + 2];
        const z = positions[i * 3 + 2];
        const [cr, cg, cb] = vertexColor(nx, ny, nz, z, preset);
        colors[i * 4] = cr;
        colors[i * 4 + 1] = cg;
        colors[i * 4 + 2] = cb;
        colors[i * 4 + 3] = 255;
    }
    return colors;
}

/**
 * Per-point RGBA from a normals buffer (for shaded-cloud mode).
 * Elevation is taken from the positions buffer when available.
 */
export function colorsFromNormals(
    normals: Float32Array,
    preset: ShaderPreset = 'cliff',
    positions?: Float32Array,
): Uint8Array {
    const n = normals.length / 3;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        const z = positions ? positions[i * 3 + 2] : 0;
        const [r, g, b] = vertexColor(nx, ny, nz, z, preset);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 255;
    }
    return colors;
}
