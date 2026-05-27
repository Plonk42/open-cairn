/**
 * Slope-based palette + per-point colorization, shared between the
 * shaded-cloud and mesh pipelines.
 */

/**
 * Palette inspired by the CloudCompare renders shared in the Camptocamp
 * LiDAR HD forum thread. Slope = angle (degrees) between the local surface
 * normal and the vertical Z axis.
 */
const SLOPE_PALETTE: Array<[number, [number, number, number]]> = [
    [0, [230, 220, 200]],   // gentle: pale sand
    [20, [205, 175, 130]],  // 20°:    warm tan
    [35, [170, 120, 75]],   // 35°:    brown
    [55, [120, 75, 45]],    // 55°:    deep brown
    [80, [70, 45, 30]],     // near-vertical: dark
];

/**
 * Interpolate the palette for a given slope angle (radians).
 */
export function slopeColor(slopeRad: number): [number, number, number] {
    const slopeDeg = slopeRad * (180 / Math.PI);
    if (slopeDeg <= SLOPE_PALETTE[0][0]) return SLOPE_PALETTE[0][1];
    for (let i = 1; i < SLOPE_PALETTE.length; i++) {
        const [degHi, colHi] = SLOPE_PALETTE[i];
        if (slopeDeg <= degHi) {
            const [degLo, colLo] = SLOPE_PALETTE[i - 1];
            const t = (slopeDeg - degLo) / (degHi - degLo);
            return [
                Math.round(colLo[0] + (colHi[0] - colLo[0]) * t),
                Math.round(colLo[1] + (colHi[1] - colLo[1]) * t),
                Math.round(colLo[2] + (colHi[2] - colLo[2]) * t),
            ];
        }
    }
    return SLOPE_PALETTE.at(-1)?.[1] ?? [200, 200, 200];
}

/**
 * Per-point RGBA from a normals buffer. Alpha is always 255.
 */
export function colorsFromNormals(normals: Float32Array): Uint8Array {
    const n = normals.length / 3;
    const colors = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
        const nz = Math.max(-1, Math.min(1, normals[i * 3 + 2]));
        const slope = Math.acos(Math.abs(nz));
        const [r, g, b] = slopeColor(slope);
        colors[i * 4] = r;
        colors[i * 4 + 1] = g;
        colors[i * 4 + 2] = b;
        colors[i * 4 + 3] = 255;
    }
    return colors;
}
