/**
 * Slope-based palette + per-point/per-vertex colorization.
 *
 * Three presets, of two different natures:
 *
 *   'terrain' — the only **albedo**: real diffuse reflectances of a mountain
 *               side (bare rock, alpine turf, firn), with no painted shading
 *               whatsoever. The photorealistic path supplies all the light, so
 *               any brightness variation baked in here would be counted twice.
 *               Three continuous variables drive it: slope, elevation relative
 *               to the snow line, and lithology.
 *   'base'    — warm sand/brown gradient (CloudCompare).
 *   'slope'   — conventional steepness map: green (flat) → yellow → orange →
 *               red → light violet (vertical), the slope-map convention used
 *               for ski touring (CalTopo, Avalanche Canada, IGN).
 *               It doubles as a measuring instrument: it is what showed that
 *               the grassy shoulder of the Dent de Crolles sits at 30-32°, and
 *               therefore that the turf/limestone break was set too low.
 *
 * The last two are NOT albedos: their luminance has no physical meaning. Hence
 * the fragment-side `u_snowPalette` flag, which only lets 'terrain' read a snow
 * ratio back out of the colour's lightness.
 */

export type ShaderPreset = 'base' | 'terrain' | 'slope';

export const SHADER_LABELS: Record<ShaderPreset, string> = {
    base: 'Mono',
    terrain: 'Terrain',
    slope: 'Pente',
};

/**
 * Lithology of the rendered range. Neither a season nor an ambiance: rock only
 * depends on the range, and it was the one gap a continuous setting could not
 * bridge between the former *Été* and *Montagne* presets. Washed Urgonian
 * limestone is twice as light as slate schist, and it BRIGHTENS with slope
 * where crystalline rock and schist darken.
 */
export type RockType = 'limestone' | 'granite' | 'schist';

export const ROCK_LABELS: Record<RockType, string> = {
    limestone: 'Calcaire',
    granite: 'Granite',
    schist: 'Schiste',
};

/** Everything a vertex colour needs, geometry aside. */
export interface PaletteSettings {
    readonly preset: ShaderPreset;
    /** See {@link DEFAULT_SNOW_LINE}. */
    readonly snowLine: number;
    /** See {@link DEFAULT_SNOW_AMOUNT}. */
    readonly snowAmount: number;
    readonly rock: RockType;
}

// ─── BASE palette (original CloudCompare-inspired warm gradient) ──────────────
const BASE_PALETTE: Array<[number, [number, number, number]]> = [
    [0, [230, 220, 200]],
    [20, [205, 175, 130]],
    [35, [170, 120, 75]],
    [55, [120, 75, 45]],
    [80, [70, 45, 30]],
];

// ─── Bare rock: real diffuse reflectances, as sRGB values (≈ ρ^(1/2.2)) ──────
// No shading is baked in: the photorealistic path multiplies these values by
// the sky + sun irradiance, so any brightness variation painted here would be
// counted twice. The historical values (rock at 190-200, i.e. ρ ≈ 0.5) had been
// picked to stay readable under a constant 0.35 ambient; under physical
// lighting they blow out to white at the first ray of sun.
//
// Each ramp runs from 0° (benches, scree) to 90° (wall, overhang), and its
// PROFILE is as characteristic as its hue: limestone brightens on the vertical
// bars, washed by runoff and given no time to develop a patina, whereas
// crystalline rock and schist darken as the ferrous patina gives way to fresh
// fracture. Nothing goes below ρ ≈ 0.15: on a mountain no wall is a light trap,
// and a darker value collapses to black as soon as the face turns away from the
// sun (it merely looked "dramatic" under the old flat lighting).
const ROCK_RAMPS: Record<RockType, Array<[number, [number, number, number]]>> = {
    // Urgonian limestone — Chartreuse, Vercors, Dévoluy.
    // scree ρ ≈ 0.30   washed bar ρ ≈ 0.40   runoff-streaked wall ρ ≈ 0.20
    limestone: [
        [0, [166, 160, 141]],
        [30, [160, 154, 136]],
        [58, [172, 167, 154]],
        [75, [164, 159, 148]],
        [90, [128, 124, 116]],
    ],
    // Crystalline — Mont-Blanc, Écrins, Belledonne. Lichen, iron oxidation and
    // sun baking give granite a distinctly warm tan (R:G:B ≈ 1.00 : 0.90 : 0.73,
    // measured on the reference renders); fresh fracture and overhangs never
    // carry that patina and stay an almost neutral, slightly cold grey.
    granite: [
        [0, [162, 146, 118]],
        [25, [148, 133, 106]],
        [55, [116, 106, 90]],
        [90, [88, 84, 80]],
    ],
    // Schist and slate — Queyras, Beaufortain, Maurienne. Dark and cold, and its
    // platy cleavage never produces a light washed face.
    schist: [
        [0, [122, 116, 106]],
        [25, [108, 103, 96]],
        [55, [88, 85, 82]],
        [90, [70, 68, 68]],
    ],
};

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
    slopeDeg: number,
): [number, number, number] {
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

// ─── Firn ──────────────────────────────────────────────────────────────
// ρ ≈ 0.85 fresh, slightly less once packed. That range — rock at ~0.2, snow at
// ~0.85 — is what gives the reference renders their dynamic range.
const SNOW_FRESH: readonly [number, number, number] = [238, 240, 245];
const SNOW_PACKED: readonly [number, number, number] = [214, 217, 223];

/**
 * Alpine turf albedo, between the lush pasture of well-watered benches and the
 * short, burnt sward of the last metres below the firn. The transition is a
 * genuine field variable: the higher one climbs towards the snow line, the
 * shorter the growing season, the sparser the grass and the more soil and
 * stone show through — the albedo gains lightness as it loses its green. Hence
 * the link with the « Ligne de neige » setting: the same climatic limit places
 * the firn and dates the turf.
 *
 * SATURATION: the hemispheric ambient is sky light, hence blue. Added to the
 * sun it lifts the blue channel by about 25 % before tone mapping, which
 * desaturates the highlights further: neutral grass comes out pastel khaki.
 * Blue is therefore scooped out here, but moderately — too much and the meadow
 * turns straw yellow in full sun.
 */
const TURF_LUSH: readonly [number, number, number] = [104, 132, 58];
const TURF_DRY: readonly [number, number, number] = [146, 138, 82];
/**
 * Drop below the snow line over which the turf goes from lush to burnt.
 * Deliberately short: the pasture stays green until very close to its limit,
 * and only in the last belt — skeletal soil, a growing season of a few weeks —
 * does it thin out and let the soil show.
 */
const TURF_DRY_SPAN_M = 700;

/**
 * Elevation (m) of the summer snow line on a south face. Residual August firn
 * in the Northern Alps starts around 2400 m on north aspects and only becomes
 * continuous around 2900 — below that, a summer mountain scene has not a single
 * flake. Adjustable: this is the « Ligne de neige » slider, which also moves the
 * pasture belt and the turf. Its range runs from 0 m to 5000 m, i.e. above Mont
 * Blanc: that is what makes a completely snowless scene reachable whatever the
 * elevation of the range.
 */
export const DEFAULT_SNOW_LINE = 2700;

/**
 * Snowpack depth, in [0,1] — accumulation, where the snow line is temperature.
 * The two are independent in the field: a November cold snap whitens down to
 * the valley floor without plastering anything, a June after a heavy winter
 * leaves nothing below 2200 m but covers everything above. Lowering the line
 * can never mimic either: at 1200 m as at 2700 m the steep walls stay bare and
 * the transition spans the same drop. 0.5 is the value that reproduces the
 * original render.
 */
export const DEFAULT_SNOW_AMOUNT = 0.5;

/** Default limestone range: the Chartreuse is the reference here. */
export const DEFAULT_ROCK: RockType = 'limestone';

export const DEFAULT_PALETTE: PaletteSettings = {
    preset: 'terrain',
    snowLine: DEFAULT_SNOW_LINE,
    snowAmount: DEFAULT_SNOW_AMOUNT,
    rock: DEFAULT_ROCK,
};

/**
 * Slope past which nothing holds any more, from a thin pack to a deep one: a
 * dusting only settles on benches, a thick layer plasters ledges and slabs and
 * only gives up in the overhang. Both bounds deliberately overshoot the
 * plausible — they frame a slider, not a climate — but their midpoint lands on
 * the original 58°.
 */
const SNOW_SLOPE_LIMIT_MIN = 30;
const SNOW_SLOPE_LIMIT_MAX = 86;
/** Width of the purge ramp below that limit. */
const SNOW_SLOPE_FADE_DEG = 26;
/**
 * Drop over which snow becomes continuous above the line. A thin pack lingers
 * as scattered patches over 900 m; a thick one gives a sharp limit.
 */
const SNOW_SPAN_MAX_M = 900;
const SNOW_SPAN_MIN_M = 100;
/** Snow-line offset between a due-north and a due-south face. */
const SNOW_ASPECT_SHIFT_M = 300;
/**
 * Gap between the snow line and the last grass, and height of the ramp leading
 * up to it. Continuous turf stops just below the first firn patches; it thins
 * out well before, hence a wide ramp rather than a threshold.
 */
const TURF_TOP_GAP_M = 100;
const TURF_TOP_FADE_M = 700;

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

/** See {@link TURF_LUSH}: drying with elevation, then with slope. */
function alpineTurf(z: number, slopeDeg: number, snowLine: number): [number, number, number] {
    const altitude = smoothstep01(1 - (snowLine - z) / TURF_DRY_SPAN_M);
    // Thin soil: on a slope the earth is shallower and better drained, so stone
    // shows through. Never enough on its own to burn the grass completely.
    const thin = smoothstep01(slopeDeg / 45) * 0.45;
    return lerp3(TURF_LUSH, TURF_DRY, altitude + thin);
}

/**
 * Mountain side: bare rock, alpine turf wherever slope and elevation let it
 * hold, firn above the snow line. No texture and no shading — the same three
 * inputs as the reference renders: slope, elevation, aspect.
 *
 * Grass holds on far steeper ground than one would think — on the shoulders of
 * the Dent de Crolles the turf still covers 35-40° slopes, and the slope map of
 * the same mesh reads ~30-32° across the whole grassy shoulder: a break set at
 * 30° repainted the meadow as rock, which then came out white.
 *
 * Aspect only shifts the snow, not the turf: a north face does carry its
 * vegetation limit lower, but it is also wetter hence greener, and a single
 * parameter cannot separate the two effects.
 *
 * The turf also ignores `snowAmount`: the pasture follows the climate of the
 * range, not the snowfall of the current winter.
 */
function terrainAlbedo(
    nx: number, ny: number,
    z: number, slopeDeg: number,
    snowLine: number, snowAmount: number, rock: RockType,
): [number, number, number] {
    const bare = interpolatePalette(ROCK_RAMPS[rock], slopeDeg);
    const turf = smoothstep01((45 - slopeDeg) / 9)
        * smoothstep01((snowLine - TURF_TOP_GAP_M - z) / TURF_TOP_FADE_M);
    const ground = turf <= 0 ? bare : lerp3(bare, alpineTurf(z, slopeDeg, snowLine), turf);

    const amount = Math.min(1, Math.max(0, snowAmount));
    const slopeLimit = SNOW_SLOPE_LIMIT_MIN + (SNOW_SLOPE_LIMIT_MAX - SNOW_SLOPE_LIMIT_MIN) * amount;
    const span = SNOW_SPAN_MAX_M + (SNOW_SPAN_MIN_M - SNOW_SPAN_MAX_M) * amount;

    // +1 = due north (shaded, holds snow lower), -1 = due south.
    const northFacing = Math.cos(Math.atan2(nx, ny));
    const retention = smoothstep01((slopeLimit - slopeDeg) / SNOW_SLOPE_FADE_DEG);
    const elevation = smoothstep01((z - (snowLine - northFacing * SNOW_ASPECT_SHIFT_M)) / span);
    const snow = retention * elevation;
    if (snow <= 0.01) return ground.map(Math.round) as [number, number, number];

    // Higher and flatter, the accumulation stays fresh and bright; wind-swept
    // ridges and low firn patches are packed, and duller.
    const freshness = smoothstep01((z - snowLine - span) / 600) * 0.6 + retention * 0.4;
    return lerp3(ground, lerp3(SNOW_PACKED, SNOW_FRESH, freshness), snow)
        .map(Math.round) as [number, number, number];
}

/**
 * Full per-vertex colorizer.
 *
 * `nx, ny, nz` must be a **macro** normal — the terrain orientation at the
 * metre-to-decametre scale, not the per-triangle normal used for lighting.
 * The albedo keys its zoning on the slope angle with transitions only a few
 * degrees wide (grass → rock, snow retention…), while a Poisson vertex normal
 * on a 50 cm lapiaz carries tens of degrees of reconstruction noise: feeding it
 * the lighting normal turns that noise into per-vertex salt-and-pepper. See
 * `macroVertexNormals` in `pipeline.ts`.
 *
 * Rendering no longer calls this function: the palette is evaluated in the
 * vertex shaders (`glsl/lib/palette.glsl`). It remains the **reference** — the
 * only testable version, since the gates do not compile GLSL — and the
 * documentary source for why each constant is what it is. Any palette tweak
 * must be made here *and* in the GLSL port.
 */
export function vertexColor(
    nx: number, ny: number, nz: number,
    z: number,
    palette: PaletteSettings,
): [number, number, number] {
    const len = Math.hypot(nx, ny, nz);
    const nzn = len > 0 ? nz / len : 1;
    const slopeDeg = Math.acos(Math.max(-1, Math.min(1, Math.abs(nzn)))) * (180 / Math.PI);

    if (palette.preset === 'base') return interpolatePalette(BASE_PALETTE, slopeDeg);
    if (palette.preset === 'slope') return interpolatePalette(SLOPE_PALETTE, slopeDeg);
    return terrainAlbedo(nx, ny, z, slopeDeg, palette.snowLine, palette.snowAmount, palette.rock);
}
