// Albedo palette evaluated on the GPU — a port of `vertexColor` from
// src/lib/lidarBrowser/slope.ts, which remains the documentary reference for the
// WHY of each constant (ramp profiles, transition widths, turf desaturation…).
// This file only carries the HOW.
//
// Evaluation lives in the vertex shader: the original palette is a per-vertex
// colour interpolated across the triangle, and keeping it there makes the port
// strictly iso-render — up to the 8-bit quantization, which the CPU suffered
// and the GPU does not.
//
// The three palettes and the three rock ramps are flattened into a single pair
// of arrays: GLSL cannot take a variable-length array as a parameter, and one
// interpolation function per palette would be the same body copied five times.
//
//   Mono       0 → 4      (BASE_PALETTE)
//   Pente      5 → 22     (SLOPE_PALETTE)
//   Limestone 23 → 27     (ROCK_RAMPS.limestone)
//   Granite   28 → 31     (ROCK_RAMPS.granite)
//   Schist    32 → 35     (ROCK_RAMPS.schist)

const float PAL_DEG[36] = float[36](
    0.0, 20.0, 35.0, 55.0, 80.0,
    0.0, 10.0, 20.0, 27.0, 30.0, 33.0, 36.0, 39.0, 42.0, 45.0, 48.0, 51.0, 55.0, 60.0, 65.0, 70.0, 80.0, 90.0,
    0.0, 30.0, 58.0, 75.0, 90.0,
    0.0, 25.0, 55.0, 90.0,
    0.0, 25.0, 55.0, 90.0
);

const vec3 PAL_COL[36] = vec3[36](
    vec3(230.0, 220.0, 200.0) / 255.0,
    vec3(205.0, 175.0, 130.0) / 255.0,
    vec3(170.0, 120.0, 75.0) / 255.0,
    vec3(120.0, 75.0, 45.0) / 255.0,
    vec3(70.0, 45.0, 30.0) / 255.0,

    vec3(34.0, 139.0, 58.0) / 255.0,
    vec3(80.0, 162.0, 55.0) / 255.0,
    vec3(145.0, 190.0, 55.0) / 255.0,
    vec3(205.0, 206.0, 60.0) / 255.0,
    vec3(255.0, 235.0, 59.0) / 255.0,
    vec3(255.0, 202.0, 40.0) / 255.0,
    vec3(255.0, 160.0, 0.0) / 255.0,
    vec3(255.0, 110.0, 30.0) / 255.0,
    vec3(244.0, 67.0, 54.0) / 255.0,
    vec3(211.0, 47.0, 47.0) / 255.0,
    vec3(198.0, 40.0, 70.0) / 255.0,
    vec3(173.0, 20.0, 110.0) / 255.0,
    vec3(162.0, 25.0, 140.0) / 255.0,
    vec3(156.0, 39.0, 176.0) / 255.0,
    vec3(173.0, 60.0, 202.0) / 255.0,
    vec3(199.0, 90.0, 220.0) / 255.0,
    vec3(224.0, 130.0, 235.0) / 255.0,
    vec3(236.0, 160.0, 240.0) / 255.0,

    vec3(166.0, 160.0, 141.0) / 255.0,
    vec3(160.0, 154.0, 136.0) / 255.0,
    vec3(172.0, 167.0, 154.0) / 255.0,
    vec3(164.0, 159.0, 148.0) / 255.0,
    vec3(128.0, 124.0, 116.0) / 255.0,

    vec3(162.0, 146.0, 118.0) / 255.0,
    vec3(148.0, 133.0, 106.0) / 255.0,
    vec3(116.0, 106.0, 90.0) / 255.0,
    vec3(88.0, 84.0, 80.0) / 255.0,

    vec3(122.0, 116.0, 106.0) / 255.0,
    vec3(108.0, 103.0, 96.0) / 255.0,
    vec3(88.0, 85.0, 82.0) / 255.0,
    vec3(70.0, 68.0, 68.0) / 255.0
);

const vec3 PAL_SNOW_FRESH = vec3(238.0, 240.0, 245.0) / 255.0;
const vec3 PAL_SNOW_PACKED = vec3(214.0, 217.0, 223.0) / 255.0;
const vec3 PAL_TURF_LUSH = vec3(104.0, 132.0, 58.0) / 255.0;
const vec3 PAL_TURF_DRY = vec3(146.0, 138.0, 82.0) / 255.0;
const float PAL_TURF_DRY_SPAN_M = 700.0;
const float PAL_SNOW_SLOPE_LIMIT_MIN = 30.0;
const float PAL_SNOW_SLOPE_LIMIT_MAX = 86.0;
const float PAL_SNOW_SLOPE_FADE_DEG = 26.0;
const float PAL_SNOW_SPAN_MAX_M = 900.0;
const float PAL_SNOW_SPAN_MIN_M = 100.0;
const float PAL_SNOW_ASPECT_SHIFT_M = 300.0;
const float PAL_TURF_TOP_GAP_M = 100.0;
const float PAL_TURF_TOP_FADE_M = 700.0;

/** Linear ramp over the [lo,hi] slice of the arrays above. */
vec3 palInterp(int lo, int hi, float deg) {
    if (deg <= PAL_DEG[lo]) return PAL_COL[lo];
    for (int i = lo + 1; i <= hi; i++) {
        if (deg <= PAL_DEG[i]) {
            float t = (deg - PAL_DEG[i - 1]) / (PAL_DEG[i] - PAL_DEG[i - 1]);
            return mix(PAL_COL[i - 1], PAL_COL[i], t);
        }
    }
    return PAL_COL[hi];
}

vec3 palAlpineTurf(float z, float slopeDeg, float snowLine) {
    float altitude = smoothstep(0.0, 1.0, 1.0 - (snowLine - z) / PAL_TURF_DRY_SPAN_M);
    float thin = smoothstep(0.0, 1.0, slopeDeg / 45.0) * 0.45;
    return mix(PAL_TURF_LUSH, PAL_TURF_DRY, clamp(altitude + thin, 0.0, 1.0));
}

/** @return rgb = albedo, w = snow ratio in [0,1]. */
vec4 palTerrain(vec3 nrm, float z, float slopeDeg, float snowLine, float snowAmount, int rock) {
    int lo = rock == 1 ? 28 : (rock == 2 ? 32 : 23);
    int hi = rock == 1 ? 31 : (rock == 2 ? 35 : 27);
    vec3 bare = palInterp(lo, hi, slopeDeg);
    float turf = smoothstep(0.0, 1.0, (45.0 - slopeDeg) / 9.0)
        * smoothstep(0.0, 1.0, (snowLine - PAL_TURF_TOP_GAP_M - z) / PAL_TURF_TOP_FADE_M);
    vec3 ground = mix(bare, palAlpineTurf(z, slopeDeg, snowLine), turf);

    float amount = clamp(snowAmount, 0.0, 1.0);
    float slopeLimit = mix(PAL_SNOW_SLOPE_LIMIT_MIN, PAL_SNOW_SLOPE_LIMIT_MAX, amount);
    float span = mix(PAL_SNOW_SPAN_MAX_M, PAL_SNOW_SPAN_MIN_M, amount);
    // cos(atan2(nx, ny)) = ny / hypot(nx, ny), written this way because
    // atan(0,0) is undefined in GLSL where Math.atan2(0,0) is 0 on the CPU side:
    // a perfectly horizontal vertex would have taken a random aspect.
    float h = length(nrm.xy);
    float northFacing = h > 1e-8 ? nrm.y / h : 1.0;
    float retention = smoothstep(0.0, 1.0, (slopeLimit - slopeDeg) / PAL_SNOW_SLOPE_FADE_DEG);
    float elevation = smoothstep(0.0, 1.0, (z - (snowLine - northFacing * PAL_SNOW_ASPECT_SHIFT_M)) / span);
    float snow = retention * elevation;
    if (snow <= 0.01) return vec4(ground, 0.0);

    float freshness = smoothstep(0.0, 1.0, (z - snowLine - span) / 600.0) * 0.6 + retention * 0.4;
    vec3 pack = mix(PAL_SNOW_PACKED, PAL_SNOW_FRESH, clamp(freshness, 0.0, 1.0));
    return vec4(mix(ground, pack, snow), snow);
}

/**
 * Albedo of a vertex. `nrm` must be the MACRO normal (terrain orientation at
 * decametric scale): the zoning switches over a few degrees of slope, and the
 * lighting normal of a lapiaz would sprinkle salt-and-pepper over it.
 *
 * @param preset 0 = Mono, 1 = Terrain, 2 = Pente
 * @param rock   0 = limestone, 1 = granite, 2 = schist
 * @return rgb = albedo, w = snow ratio (0 outside the Terrain preset)
 */
vec4 paletteAlbedo(vec3 nrm, float z, int preset, float snowLine, float snowAmount, int rock) {
    float len = length(nrm);
    float nzn = len > 0.0 ? nrm.z / len : 1.0;
    float slopeDeg = degrees(acos(clamp(abs(nzn), -1.0, 1.0)));
    if (preset == 0) return vec4(palInterp(0, 4, slopeDeg), 0.0);
    if (preset == 2) return vec4(palInterp(5, 22, slopeDeg), 0.0);
    return palTerrain(nrm, z, slopeDeg, snowLine, snowAmount, rock);
}
