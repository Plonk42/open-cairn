/**
 * Slope-based palette + per-point/per-vertex colorization.
 *
 * Trois presets, de deux natures différentes :
 *
 *   'terrain' — le seul **albédo** : réflectances diffuses réelles d'un versant
 *               (roche nue, pelouse alpine, névé), sans le moindre ombrage
 *               peint. Le chemin photoréaliste fournit toute la lumière, donc
 *               toute variation de luminosité cuite ici serait comptée deux
 *               fois. Trois variables continues le pilotent : la pente,
 *               l'altitude relative à la ligne de neige, et la lithologie.
 *   'base'    — dégradé chaud sable/brun (CloudCompare).
 *   'slope'   — carte de pente conventionnelle : vert (plat) → jaune → orange
 *               → rouge → violet clair (vertical), la convention des cartes de
 *               pente pour le ski de rando (CalTopo, Avalanche Canada, IGN).
 *               Sert aussi d'instrument de mesure : c'est lui qui a montré que
 *               l'épaulement herbeux de la Dent de Crolles est à 30-32°, donc
 *               que la rupture vers le calcaire était placée trop bas.
 *
 * Les deux dernières ne sont PAS des albédos : leur luminance n'a aucun sens
 * physique. D'où le drapeau `u_snowPalette` côté fragment, qui n'autorise que
 * 'terrain' à relire un taux de neige dans la clarté de la couleur.
 */

export type ShaderPreset = 'base' | 'terrain' | 'slope';

/**
 * Lithologie du massif rendu. Ni une saison ni une ambiance : la roche ne
 * dépend que du massif, et c'est le seul écart qu'un réglage continu ne pouvait
 * pas combler entre les anciens presets *Été* et *Montagne*. Un calcaire
 * urgonien lavé est deux fois plus clair qu'un schiste ardoisier, et il
 * s'éclaircit avec la pente là où le cristallin et le schiste s'assombrissent.
 */
export type RockType = 'limestone' | 'granite' | 'schist';

/** Tout ce dont une couleur de sommet a besoin, hors géométrie. */
export interface PaletteSettings {
    readonly preset: ShaderPreset;
    /** Voir {@link DEFAULT_SNOW_LINE}. */
    readonly snowLine: number;
    /** Voir {@link DEFAULT_SNOW_AMOUNT}. */
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

// ─── Roche nue : réflectances diffuses réelles, en valeurs sRGB (≈ ρ^(1/2.2)) ─
// Aucun ombrage n'y est cuit : le chemin photoréaliste multiplie ces valeurs
// par l'irradiance ciel + soleil, donc toute variation de luminosité peinte ici
// serait comptée deux fois. Les valeurs historiques (rocher à 190-200, soit
// ρ ≈ 0,5) avaient été choisies pour rester lisibles sous une ambiante
// constante de 0,35 ; sous l'éclairage physique elles saturent en blanc dès le
// premier rayon de soleil.
//
// Chaque rampe court de 0° (replats, éboulis) à 90° (paroi, surplomb), et son
// PROFIL est aussi caractéristique que sa teinte : le calcaire s'éclaircit sur
// les barres verticales, lavées par le ruissellement et qui n'ont pas le temps
// de se patiner, là où le cristallin et le schiste s'assombrissent à mesure que
// la patine ferrugineuse laisse place à la cassure fraîche. Rien n'y descend
// sous ρ ≈ 0,15 : sur une montagne aucune paroi n'est un piège à lumière, et
// une valeur plus sombre s'effondre en noir dès que la face se détourne du
// soleil (elle passait pour « dramatique » sous l'ancien éclairage plat).
const ROCK_RAMPS: Record<RockType, Array<[number, [number, number, number]]>> = {
    // Calcaire urgonien — Chartreuse, Vercors, Dévoluy.
    // éboulis ρ ≈ 0,30   barre lavée ρ ≈ 0,40   paroi ruisselée ρ ≈ 0,20
    limestone: [
        [0, [166, 160, 141]],
        [30, [160, 154, 136]],
        [58, [172, 167, 154]],
        [75, [164, 159, 148]],
        [90, [128, 124, 116]],
    ],
    // Cristallin — Mont-Blanc, Écrins, Belledonne. Le lichen, l'oxydation du fer
    // et la cuisson au soleil donnent au granite un tan franchement chaud
    // (R:G:B ≈ 1,00 : 0,90 : 0,73, relevé sur les rendus de référence) ; la
    // cassure fraîche et les surplombs n'ont jamais cette patine et restent
    // d'un gris presque neutre, un peu froid.
    granite: [
        [0, [162, 146, 118]],
        [25, [148, 133, 106]],
        [55, [116, 106, 90]],
        [90, [88, 84, 80]],
    ],
    // Schistes et ardoisiers — Queyras, Beaufortain, Maurienne. Sombre et froid,
    // et le débit en plaques ne produit aucune face lavée claire.
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

// ─── Névé ────────────────────────────────────────────────────────────────────
// ρ ≈ 0,85 fraîche, un peu moins tassée. C'est cette plage — roche à ~0,2,
// neige à ~0,85 — qui donne aux rendus de référence leur dynamique.
const SNOW_FRESH: readonly [number, number, number] = [238, 240, 245];
const SNOW_PACKED: readonly [number, number, number] = [214, 217, 223];

/**
 * Albédo de la pelouse alpine, entre l'alpage gras des replats bien arrosés et
 * la pelouse rase et brûlée des derniers mètres sous les névés. La transition
 * est une vraie variable de terrain : plus on monte vers la limite des neiges,
 * plus la saison végétative est courte, plus l'herbe se clairseme et laisse
 * voir la terre et le caillou — l'albédo gagne en clarté en perdant son vert.
 * D'où le lien avec le réglage « Ligne de neige » : c'est la même limite
 * climatique qui place les névés et qui date la pelouse.
 *
 * SATURATION : l'ambiante hémisphérique est une lumière de ciel, donc bleue.
 * Additionnée au soleil elle remonte le canal bleu d'environ 25 % avant le
 * tone mapping, qui désature encore les hautes lumières : une herbe neutre
 * ressort en kaki pastel. Le bleu est donc creusé ici, mais modérément — trop
 * et la prairie vire au jaune de paille en plein soleil.
 */
const TURF_LUSH: readonly [number, number, number] = [104, 132, 58];
const TURF_DRY: readonly [number, number, number] = [146, 138, 82];
/**
 * Dénivelé sous la ligne de neige où la pelouse passe de grasse à brûlée. Court
 * volontairement : l'alpage reste vert jusqu'à très près de sa limite, ce n'est
 * que dans la dernière ceinture — sol squelettique, saison de végétation de
 * quelques semaines — qu'il se clairseme et laisse voir la terre.
 */
const TURF_DRY_SPAN_M = 700;

/**
 * Altitude (m) de la limite des neiges d'été sur une face sud. Les névés
 * résiduels d'août dans les Alpes du Nord commencent vers 2400 m en exposition
 * nord et ne deviennent continus que vers 2900 — en dessous, une scène de
 * montagne en été n'a pas un flocon. Réglable : c'est le curseur « Ligne de
 * neige », qui déplace aussi la ceinture d'alpage et la pelouse.
 */
export const DEFAULT_SNOW_LINE = 2700;

/**
 * Épaisseur du manteau, dans [0,1] — l'accumulation, là où la ligne de neige
 * est la température. Les deux sont indépendantes sur le terrain : un coup de
 * froid de novembre blanchit jusqu'au fond de vallée sans rien plâtrer, un mois
 * de juin après un gros hiver ne laisse rien sous 2200 m mais couvre tout
 * au-dessus. Descendre la ligne ne saura jamais imiter ni l'un ni l'autre : à
 * 1200 m comme à 2700 m les parois raides restent nues et la transition prend
 * le même dénivelé. 0,5 est la valeur qui reproduit le rendu d'origine.
 */
export const DEFAULT_SNOW_AMOUNT = 0.5;

/** Massif calcaire par défaut : c'est la Chartreuse qui sert de référence ici. */
export const DEFAULT_ROCK: RockType = 'limestone';

export const DEFAULT_PALETTE: PaletteSettings = {
    preset: 'terrain',
    snowLine: DEFAULT_SNOW_LINE,
    snowAmount: DEFAULT_SNOW_AMOUNT,
    rock: DEFAULT_ROCK,
};

/**
 * Pente au-delà de laquelle plus rien ne tient, du manteau maigre au gros
 * manteau : une pellicule ne se pose que sur les replats, une couche épaisse
 * plâtre les vires et les dalles et ne cède que dans le surplomb.
 */
const SNOW_SLOPE_LIMIT_MIN = 40;
const SNOW_SLOPE_LIMIT_MAX = 76;
/** Largeur de la rampe de purge sous cette limite. */
const SNOW_SLOPE_FADE_DEG = 26;
/**
 * Dénivelé sur lequel la neige devient continue au-dessus de la ligne. Un
 * manteau maigre traîne en névés épars sur 800 m ; un manteau épais donne une
 * limite franche.
 */
const SNOW_SPAN_MAX_M = 800;
const SNOW_SPAN_MIN_M = 200;
/** Décalage de la ligne de neige entre une face plein nord et une face plein sud. */
const SNOW_ASPECT_SHIFT_M = 300;
/**
 * Écart entre la ligne de neige et le dernier gazon, et hauteur de la rampe qui
 * y mène. La pelouse continue s'arrête juste sous les premiers névés ; elle se
 * clairseme bien avant, d'où une rampe large plutôt qu'un seuil.
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

/** Voir {@link TURF_LUSH} : dessèchement avec l'altitude, puis avec la pente. */
function alpineTurf(z: number, slopeDeg: number, snowLine: number): [number, number, number] {
    const altitude = smoothstep01(1 - (snowLine - z) / TURF_DRY_SPAN_M);
    // Sol maigre : sur la pente la terre est plus mince et mieux drainée, le
    // caillou perce. Ne suffit jamais à lui seul à brûler complètement l'herbe.
    const thin = smoothstep01(slopeDeg / 45) * 0.45;
    return lerp3(TURF_LUSH, TURF_DRY, altitude + thin);
}

/**
 * Versant de montagne : roche nue, pelouse alpine là où la pente et l'altitude
 * la laissent tenir, névé au-dessus de la ligne de neige. Sans texture et sans
 * ombrage — les trois mêmes entrées que les rendus de référence : pente,
 * altitude, orientation.
 *
 * L'herbe tient bien plus raide qu'on ne le croit — sur les épaulements de la
 * Dent de Crolles la pelouse couvre encore des pentes à 35-40°, et la carte de
 * pente du même maillage donne ~30-32° sur tout l'épaulement herbeux : une
 * rupture placée à 30° repeignait la prairie en rocher, qui ressortait blanc.
 *
 * L'orientation ne décale que la neige, pas la pelouse : une face nord porte
 * bien sa limite de végétation plus bas, mais elle est aussi plus humide donc
 * plus verte, et un seul paramètre ne peut pas départager les deux effets.
 *
 * La pelouse ignore aussi `snowAmount` : l'alpage se cale sur le climat du
 * massif, pas sur les chutes de l'hiver en cours.
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

    // +1 = plein nord (à l'ombre, tient la neige plus bas), -1 = plein sud.
    const northFacing = Math.cos(Math.atan2(nx, ny));
    const retention = smoothstep01((slopeLimit - slopeDeg) / SNOW_SLOPE_FADE_DEG);
    const elevation = smoothstep01((z - (snowLine - northFacing * SNOW_ASPECT_SHIFT_M)) / span);
    const snow = retention * elevation;
    if (snow <= 0.01) return ground.map(Math.round) as [number, number, number];

    // Plus haut et plus plat, l'accumulation reste fraîche et brillante ; les
    // crêtes balayées par le vent et les névés bas sont tassés, plus sourds.
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
    palette: PaletteSettings,
): Uint8Array {
    const n = normals.length / 3;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nx = macroNormals ? macroNormals[i * 3] / 127.5 - 1 : normals[i * 3];
        const ny = macroNormals ? macroNormals[i * 3 + 1] / 127.5 - 1 : normals[i * 3 + 1];
        const nz = macroNormals ? macroNormals[i * 3 + 2] / 127.5 - 1 : normals[i * 3 + 2];
        const z = positions[i * 3 + 2];
        const [cr, cg, cb] = vertexColor(nx, ny, nz, z, palette);
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
    palette: PaletteSettings,
    positions?: Float32Array,
): Uint8Array {
    const n = normals.length / 3;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
        const z = positions ? positions[i * 3 + 2] : 0;
        const [r, g, b] = vertexColor(nx, ny, nz, z, palette);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 255;
    }
    return colors;
}
