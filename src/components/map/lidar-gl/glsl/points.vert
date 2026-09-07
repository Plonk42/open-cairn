#version 300 es
// Pass 1 — render points to the FBO.
//
// Lighting decomposition: each vertex emits its ambient term and its diffuse
// term separately. The fragment shader recombines them as
//     final = v_ambient + v_diffuse * shadowFactor
// where shadowFactor ∈ [0,1] comes from sampling the shadow map. Splitting
// ambient/diffuse this way lets cast shadows darken only the lit portion of
// the surface (so shaded sides remain legible).
precision highp float;
layout(location = 0) in vec3 a_pos;      // (x, y, z) in meters: x=east, y=north, z=up
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec4 a_color;
layout(location = 3) in float a_class;   // LAS classification (0..255), unnormalized
layout(location = 4) in float a_height;  // height above local ground (m), pre-sanitized
layout(location = 5) in float a_tfv;     // BD Forêt category (0..n, 255 = none), unnormalized
layout(location = 6) in float a_treeSeed;// per-tree seed (0..254, 255 = none), unnormalized
layout(location = 7) in vec4 a_vegDiag;  // height-decision diagnostics [blendW, cluster, flags, rough·10], 0..255

uniform mat4 u_matrix;     // Pre-translated matrix (includes origin translation)
uniform float u_mpu;       // meters per Mercator unit
uniform float u_ps;        // point size
uniform uint u_classMask[8];
uniform vec3 u_sunDir;
uniform float u_sunIntensity;
uniform mat4 u_lightMatrix;   // world-meters → light-clip space
uniform vec4 u_uvRect;        // (eMin, nMin, eMax, nMax) in offset metres
uniform float u_vegSizeBoost; // point-size multiplier for vegetation
uniform float u_vegEnhance;   // 1 = vegetation enhancements on
uniform float u_vegIntensity;   // 0 = flat class colour, 1 = full palette
uniform float u_vegHeightScale; // height (m) mapped to the top of the palette
uniform float u_vegColorMode;   // 0 = natural ramp, 1 = viridis height colormap, 2 = species,
                                // 3..6 = « Analyse hauteur » diagnostics (decision/clusters/roughness/flags)

// ── IGN BD Forêt® species rendering ──────────────────────────────────────────
uniform float u_forestGrouping;    // 0 = coarse group, 1 = concrete species
uniform float u_forestMixCellSize; // grid-hash cell (m) for mix fallback w/o treeSeed
uniform float u_speciesFilterOn;   // 1 = legend filter active (hide unmasked species)
uniform vec3  u_forestPalette[16]; // legend id → RGB (0–1), grouping-dependent
uniform int   u_catGroup[32];      // category → group id (255 = unset)
uniform int   u_catSpecies[32];    // category → species id (255 = mix)
uniform int   u_catMixBase[32];    // category → offset into u_mixSpecies
uniform int   u_catMixCount[32];   // category → mix candidate count
uniform int   u_mixSpecies[32];    // flattened mix candidate species ids
uniform uint  u_speciesMask[8];    // 256-bit legend-id visibility mask

// Eye position in the SAME space as `pos` (Mercator units relative to the
// cloud origin, Y flipped) — reconstructed from the matrix by
// `cameraFromMatrix()`. Divided by u_mpu, the distance becomes metric.
uniform vec3 u_camPos;

// Ground albedo palette — same uniforms as the mesh.
uniform int u_palettePreset;
uniform int u_rockType;
uniform float u_snowLine;
uniform float u_snowAmount;

out vec3 v_albedo;
out float v_diff;
out float v_flatDiff;
out float v_flatDirect; // N·L not folded, for the fixed light (PBR path)
out vec2 v_uv;
out vec4 v_lightPos;
out float v_depth;
out float v_distM;      // camera→point distance in metres (aerial perspective)
out float v_nz;         // vertical component of the normal (hemispheric ambient)
out float v_alpha;
out float v_isVeg;
out float v_isGround;
out float v_emissive;   // 1 = flat/emissive diagnostic colour (bypass shading)

#include ./lib/flatLight.glsl;
#include ./lib/palette.glsl;

// Also declared by lib/pbr.glsl on the fragment side: same program, same uniform.
uniform float u_pbr;         // 0 = legacy sRGB shading, 1 = linear tone-mapped

// "Natural" foliage gradient: trunk/litter brown → understorey → vivid canopy
// → yellow-green crown. "scale" stretches the height axis (top reached at
// "scale" m instead of 15) — GPU copy of vegRamp() (lidarCloud.ts).
// Deliberately contrasted palette: dark base (ground shade) and a very bright
// crown turning golden-green, to make the canopy stand out clearly.
vec3 vegRampColor(float h, float scale) {
    float hh = h * (15.0 / max(1.0, scale));
    vec3 c0 = vec3(58.0, 44.0, 30.0) / 255.0;    // litter / trunk in shade
    vec3 c1 = vec3(52.0, 96.0, 42.0) / 255.0;    // deep green understorey
    vec3 c2 = vec3(108.0, 172.0, 60.0) / 255.0;  // vivid canopy
    vec3 c3 = vec3(226.0, 226.0, 110.0) / 255.0; // bright golden-green crown
    if (hh <= 0.0) return c0;
    if (hh <= 1.5) return mix(c0, c1, hh / 1.5);
    if (hh <= 6.0) return mix(c1, c2, (hh - 1.5) / 4.5);
    if (hh <= 15.0) return mix(c2, c3, (hh - 6.0) / 9.0);
    return c3;
}

// Same gradient, but in physical REFLECTANCE, for the photorealistic path.
//
// The ramp above is a map palette: it already encodes a reading (bright crown,
// dark understorey) and peaks at a yellow-green of luminance 0.87. The PBR path
// treats it as an albedo and multiplies it by a solar irradiance of about 1.8:
// the foliage came out as acid-green confetti.
//
// A conifer canopy is on the contrary one of the darkest natural surfaces in
// the visible range — ρ ≈ 0.03 red, 0.05-0.08 green, 0.03 blue (needles trap
// light through multiple scattering inside the crown structure). That is what
// gives, in photographs, near-black trees standing out against light turf. We
// keep the same vertical structure (litter → crown) but in the right
// reflectance range, with a very slight warming of the crown instead of the
// golden-green.
vec3 vegRampColorPbr(float h, float scale) {
    float hh = h * (15.0 / max(1.0, scale));
    vec3 c0 = vec3(46.0, 40.0, 30.0) / 255.0;  // litter / trunk in shade     ρ≈0.03
    vec3 c1 = vec3(38.0, 54.0, 38.0) / 255.0;  // crown base, very dark
    vec3 c2 = vec3(48.0, 68.0, 46.0) / 255.0;  // crown                       ρ≈0.06
    vec3 c3 = vec3(64.0, 84.0, 54.0) / 255.0;  // exposed crown, barely lighter
    if (hh <= 0.0) return c0;
    if (hh <= 1.5) return mix(c0, c1, hh / 1.5);
    if (hh <= 6.0) return mix(c1, c2, (hh - 1.5) / 4.5);
    if (hh <= 15.0) return mix(c2, c3, (hh - 6.0) / 9.0);
    return c3;
}

vec3 vegRamp(float h, float scale) {
    return (u_pbr > 0.5) ? vegRampColorPbr(h, scale) : vegRampColor(h, scale);
}

// Height modulation applied ON TOP of a species colour ("essence" mode).
// Markedly darkens the bottom (litter/trunk in shade) and brightens the crown
// while warming it towards golden-green: each tree stands out strongly while
// keeping its BD Forêt hue. ht ∈ [0,1] = normalized point height.
vec3 speciesHeightShade(vec3 base, float ht) {
    vec3 shade = base * mix(0.42, 1.10, ht);
    vec3 canopyTint = vec3(1.14, 1.10, 0.80);
    shade *= mix(vec3(1.0), canopyTint, smoothstep(0.5, 1.0, ht));
    return clamp(shade, 0.0, 1.0);
}


// Viridis colormap (matplotlib / IGN LiDAR HD), 11 stops — GPU copy of
// viridis() (lidarCloud.ts).
vec3 viridisColor(float t) {
    vec3 v[11] = vec3[11](
        vec3(68.0, 1.0, 84.0), vec3(72.0, 33.0, 115.0), vec3(64.0, 67.0, 135.0),
        vec3(52.0, 94.0, 141.0), vec3(41.0, 120.0, 142.0), vec3(32.0, 144.0, 140.0),
        vec3(34.0, 167.0, 132.0), vec3(68.0, 190.0, 112.0), vec3(121.0, 209.0, 81.0),
        vec3(189.0, 222.0, 38.0), vec3(253.0, 231.0, 37.0)
    );
    float x = clamp(t, 0.0, 1.0) * 10.0;
    float fi = floor(x);
    int i = int(min(fi, 9.0));
    return mix(v[i], v[i + 1], x - fi) / 255.0;
}

// HSV→RGB (rainbow hue to tell neighbouring stacked clusters apart).
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// « Analyse hauteur » false colours: turns the per-point diagnostics into a flat
// colour that reveals the height algorithm's decision. `mode` ∈ [3,6]:
//   3 decision  : red=cliff (stacked) → green=slope (vertical-to-ground),
//                 blue=overhang anchored at the cliff top, grey=no ground
//   4 clusters  : stable hue per vertical cluster (stacked column)
//   5 roughness : viridis of the local ground relief (0..20 m)
//   6 flags     : grey=no ground / magenta=overhang / orange=floating / green=supported
vec3 vegDiagColor(vec4 diag, float mode) {
    float dBlend = diag.x / 255.0;
    int dFlags = int(diag.z + 0.5);
    float dRough = diag.w / 10.0;
    bool hasGround = (dFlags & 2) != 0;
    bool floating = (dFlags & 4) != 0;
    bool cliff = (dFlags & 8) != 0;
    if (mode < 3.5) {
        if (!hasGround) return vec3(0.5);
        if (cliff) return vec3(0.2, 0.45, 1.0);
        return mix(vec3(0.92, 0.22, 0.20), vec3(0.22, 0.85, 0.32), dBlend);
    }
    if (mode < 4.5) {
        float hue = fract(diag.y * 0.61803399);
        return hsv2rgb(vec3(hue, 0.65, 0.95));
    }
    if (mode < 5.5) {
        return viridisColor(clamp(dRough / 20.0, 0.0, 1.0));
    }
    if (!hasGround) return vec3(0.5);
    if (cliff) return vec3(1.0, 0.0, 0.8);
    if (floating) return vec3(1.0, 0.55, 0.0);
    return vec3(0.2, 0.8, 0.3);
}

// Is the 'legend' bit visible in the legend filter mask?
bool speciesMaskHas(int legend) {
    uint w = uint(legend) >> 5u;
    uint b = uint(legend) & 31u;
    return (u_speciesMask[w] & (1u << b)) != 0u;
}

// Stable per-grid-cell pseudo-random seed — fallback when no tree top
// (treeSeed) is available to spread the species of a mixed stand.
float gridSeed(vec2 xy, float cell) {
    vec2 id = floor(xy / max(1.0, cell));
    return fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
}

// Resolves the legend id (group or species) of a vegetation point, or -1 if the
// point has no BD Forêt data (→ generic height gradient).
// In « essence » mode, a mixed stand picks a candidate species from the tree
// seed, so every point of the same crown shares the colour.
int forestLegend(int cat, float treeSeed, vec2 xy) {
    if (cat < 0 || cat >= 32) return -1;
    int grp = u_catGroup[cat];
    if (grp > 200) return -1;                 // 255 = undefined category
    if (u_forestGrouping < 0.5) return grp;    // « groupes » mode: flat per stand
    int sp = u_catSpecies[cat];
    if (sp > 200) {                            // mixed category → draw a species
        int cnt = u_catMixCount[cat];
        if (cnt <= 0) return grp;
        float seed01 = (treeSeed < 254.5)
            ? (treeSeed + 0.5) / 255.0
            : gridSeed(xy, u_forestMixCellSize);
        int pick = clamp(int(floor(seed01 * float(cnt))), 0, cnt - 1);
        sp = u_mixSpecies[u_catMixBase[cat] + pick];
    }
    return sp;
}

void main() {
    uint c = uint(a_class);
    uint word = c >> 5u;
    uint bit  = c & 31u;
    if ((u_classMask[word] & (1u << bit)) == 0u) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        v_albedo = vec3(0.0);
        v_diff = 0.0;
        v_flatDiff = 0.0;
        v_flatDirect = 0.0;
        v_uv = vec2(-1.0);
        v_lightPos = vec4(0.0);
        v_depth = 0.0;
        v_distM = 0.0;
        v_nz = 1.0;
        v_alpha = 0.0;
        v_isVeg = 0.0;
        v_isGround = 0.0;
        v_emissive = 0.0;
        return;
    }

    // Ground = ASPRS classes 2 (ground) and 9 (water) — "ground" vs "non-ground"
    // photo draping.
    v_isGround = (c == 2u || c == 9u) ? 1.0 : 0.0;
    // Vegetation = ASPRS classes 3/4/5 (low/medium/high).
    bool isVeg = (c == 3u || c == 4u || c == 5u);
    v_isVeg = (u_vegEnhance > 0.5 && isVeg) ? 1.0 : 0.0;

    vec3 pos = vec3(
        a_pos.x * u_mpu,
        -a_pos.y * u_mpu,
        a_pos.z * u_mpu
    );
    gl_Position = u_matrix * vec4(pos, 1.0);
    float ps = (v_isVeg > 0.5) ? u_ps * u_vegSizeBoost : u_ps;
    gl_PointSize = max(ps, 1.0);
    v_depth = gl_Position.w;
    // gl_Position.w is NOT metric (MapLibre folds worldSize = 512·2^zoom into
    // it), hence the Euclidean eye distance converted to metres by u_mpu.
    v_distM = distance(pos, u_camPos) / max(u_mpu, 1e-20);

    vec3 nrm = normalize(a_normal);
    v_nz = nrm.z;
    v_diff = max(0.0, dot(nrm, u_sunDir)) * u_sunIntensity;
    // Neutral lighting: soft wrap lighting (the negative term is folded back so
    // that opposite faces stay lit) → readable relief without harshness.
    v_flatDiff = dot(nrm, normalize(FLAT_LIGHT_DIR)) * 0.5 + 0.5;
    // The PBR path already has a floor (hemispheric ambient): it needs a plain
    // N·L, not the wrap, otherwise the relief is flattened.
    v_flatDirect = max(0.0, dot(nrm, normalize(FLAT_LIGHT_DIR)));
    // Foliage colouring computed on the GPU: « Dégradé feuillage » (intensity)
    // and « Hauteur max » (scale) are plain uniforms → the sliders are instant,
    // with no CPU recompute and no cloud re-upload.
    // The ground gets the albedo palette, evaluated here for the same reason;
    // a_color now only carries the classification colour.
    vec3 baseCol = (c == 2u)
        ? paletteAlbedo(nrm, a_pos.z, u_palettePreset, u_snowLine, u_snowAmount, u_rockType).rgb
        : a_color.rgb;
    v_emissive = 0.0;
    if (u_vegColorMode > 2.5 && isVeg) {
        // « Analyse hauteur »: flat false colours revealing the height
        // algorithm's decision (computation mode, clusters, roughness, flags).
        // Independent of « Améliorations végétation » (v_isVeg) — always active.
        baseCol = vegDiagColor(a_vegDiag, u_vegColorMode);
        v_emissive = 1.0;
    } else if (v_isVeg > 0.5) {
        float gradAmt = clamp(u_vegIntensity, 0.0, 1.0);
        if (u_vegColorMode > 1.5) {
            // « essence » mode: real colour taken from the BD Forêt.
            int cat = int(a_tfv + 0.5);
            int legend = forestLegend(cat, a_treeSeed, a_pos.xy);
            if (legend >= 0) {
                // Legend filter: masked species are pushed off-screen.
                if (u_speciesFilterOn > 0.5 && !speciesMaskHas(legend)) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    gl_PointSize = 0.0;
                    v_alpha = 0.0;
                    return;
                }
                // Species colouring is ALWAYS applied (decoupled from the
                // slider). « Dégradé feuillage » only drives the amplitude of
                // the height gradient added on top: at 0 the species hue stays
                // full, at 1 the crown/trunk gradient is complete.
                vec3 species = u_forestPalette[legend];
                float ht = clamp(a_height / max(1.0, u_vegHeightScale), 0.0, 1.0);
                baseCol = mix(species, speciesHeightShade(species, ht), gradAmt);
            } else {
                // Vegetation outside any stand → generic height gradient, driven
                // by the slider (nothing to colour by species here).
                baseCol = mix(baseCol, vegRamp(a_height, u_vegHeightScale), gradAmt);
            }
        } else if (u_vegColorMode > 0.5) {
            baseCol = mix(baseCol, viridisColor(a_height / max(1.0, u_vegHeightScale)), gradAmt);
        } else {
            baseCol = mix(baseCol, vegRamp(a_height, u_vegHeightScale), gradAmt);
        }
    }
    v_albedo = baseCol;
    v_alpha = a_color.a;
    // Nadir planar projection (top-down view) identical to the mesh: allows the
    // orthophoto to be draped over the points (vegetation, buildings, …).
    v_uv = vec2(
        (a_pos.x - u_uvRect.x) / (u_uvRect.z - u_uvRect.x),
        (u_uvRect.w - a_pos.y) / (u_uvRect.w - u_uvRect.y)
    );

    // a_pos is east/north/up in meters — same frame as the light matrix.
    v_lightPos = u_lightMatrix * vec4(a_pos, 1.0);
}
