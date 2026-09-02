/**
 * Recover the camera (eye) position from a projection·view matrix.
 *
 * Why: the LiDAR shaders need the true **metric** distance from the eye to
 * each vertex (aerial perspective / atmospheric haze, and later view-dependent
 * terms). `gl_Position.w` is *not* metres — MapLibre's `mainMatrix` folds in
 * `worldSize = 512·2^zoom`, so `w` is expressed in screen-pixel-ish units that
 * change with zoom. Rather than guessing that scale (or reaching into
 * MapLibre's private `transform`), we invert the relationship analytically.
 *
 * For any perspective matrix `M` the centre of projection is the single point
 * `e` that maps to a *degenerate* clip position: `clip.x = clip.y = clip.w = 0`
 * (it is the apex of the view frustum — every ray through it hits the same
 * screen point, and its homogeneous divide is undefined). That gives three
 * linear equations in the three unknowns `(ex, ey, ez)`, solved here with
 * Cramer's rule.
 *
 * The result lives in the *input space* of the matrix that was passed in. For
 * `LidarWebGLLayer` that is the layer's translated matrix, whose input is the
 * shader-side `pos` vector (Mercator units relative to the cloud origin, with
 * the Y axis flipped) — so dividing the resulting distance by `u_mpu` yields
 * metres.
 *
 * Returns `null` for an orthographic / singular matrix (no finite eye).
 */
export function cameraFromMatrix(m: ArrayLike<number>): [number, number, number] | null {
    // Rows of the column-major matrix that produce clip.x, clip.y and clip.w.
    const a11 = m[0], a12 = m[4], a13 = m[8], b1 = -m[12];
    const a21 = m[1], a22 = m[5], a23 = m[9], b2 = -m[13];
    const a31 = m[3], a32 = m[7], a33 = m[11], b3 = -m[15];

    const det =
        a11 * (a22 * a33 - a23 * a32) -
        a12 * (a21 * a33 - a23 * a31) +
        a13 * (a21 * a32 - a22 * a31);

    // Orthographic projections have an all-zero `clip.w` row (w is constant),
    // making the system singular: there is no finite centre of projection.
    if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;

    const dx =
        b1 * (a22 * a33 - a23 * a32) -
        a12 * (b2 * a33 - a23 * b3) +
        a13 * (b2 * a32 - a22 * b3);
    const dy =
        a11 * (b2 * a33 - a23 * b3) -
        b1 * (a21 * a33 - a23 * a31) +
        a13 * (a21 * b3 - b2 * a31);
    const dz =
        a11 * (a22 * b3 - b2 * a32) -
        a12 * (a21 * b3 - b2 * a31) +
        b1 * (a21 * a32 - a22 * a31);

    const x = dx / det, y = dy / det, z = dz / det;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return [x, y, z];
}
