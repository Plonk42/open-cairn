/**
 * Eye-Dome Lighting (EDL) post-processing effect for deck.gl.
 *
 * EDL darkens pixels that are "in front of" their neighbours, revealing
 * depth discontinuities (object edges, terrain relief) without requiring
 * an explicit depth pass.
 *
 * For classification-coloured point clouds the per-class luminance is a good
 * proxy for elevation (brown ground ≈ 0.4 lum, dark-green high-veg ≈ 0.43 lum,
 * light-green low-veg ≈ 0.8 lum), so luminance differences faithfully encode
 * depth boundaries at class transitions — exactly where EDL should darken.
 *
 * Implementation uses deck.gl's PostProcessEffect + a custom luma.gl ShaderPass.
 * The sampler2D is passed as an explicit function parameter (not a global) by
 * using `passes: [{sampler: true}]`, which generates the template:
 *   fragColor = edl_sampleColor(texSrc, screen.texSize, coordinate)
 * This avoids the GLSL ordering issue where the module code is emitted before
 * the `uniform sampler2D texSrc;` declaration in the main template.
 */

// The SAMPLER_FS_TEMPLATE (deck.gl post-process-effect.js) generates:
//   fragColor = edl_sampleColor(texSrc, screen.texSize, coordinate);
// Our function receives texSrc as a parameter — no ordering issues.
const EDL_FS = /* glsl */ `
layout(std140) uniform edlUniforms {
  float strength;
  float radius;
} edl;

vec4 edl_sampleColor(sampler2D texSrc, vec2 texSize, vec2 coordinate) {
  vec4 color = texture(texSrc, coordinate);

  // Skip fully-transparent background pixels (no point rendered here).
  if (color.a < 0.01) return color;

  // Pixel-space sampling step
  vec2 texel = edl.radius / texSize;
  vec3 lumCoeff = vec3(0.299, 0.587, 0.114);
  float cL = dot(color.rgb, lumCoeff);

  // Sample 8 neighbours (4 cardinal + 4 diagonal at 1/√2 weight)
  vec4 s0 = texture(texSrc, coordinate + vec2( 1.0,  0.0) * texel);
  vec4 s1 = texture(texSrc, coordinate + vec2(-1.0,  0.0) * texel);
  vec4 s2 = texture(texSrc, coordinate + vec2( 0.0,  1.0) * texel);
  vec4 s3 = texture(texSrc, coordinate + vec2( 0.0, -1.0) * texel);
  vec4 s4 = texture(texSrc, coordinate + vec2( 0.707,  0.707) * texel);
  vec4 s5 = texture(texSrc, coordinate + vec2(-0.707,  0.707) * texel);
  vec4 s6 = texture(texSrc, coordinate + vec2( 0.707, -0.707) * texel);
  vec4 s7 = texture(texSrc, coordinate + vec2(-0.707, -0.707) * texel);

  float response = 0.0;
  float weight   = 0.0;

  // Only accumulate response from other foreground pixels.
  // A foreground pixel that is DARKER than the current pixel implies the
  // current pixel is "above" it → EDL darkening.
  if (s0.a > 0.01) { response += max(0.0, cL - dot(s0.rgb, lumCoeff)); weight += 1.0; }
  if (s1.a > 0.01) { response += max(0.0, cL - dot(s1.rgb, lumCoeff)); weight += 1.0; }
  if (s2.a > 0.01) { response += max(0.0, cL - dot(s2.rgb, lumCoeff)); weight += 1.0; }
  if (s3.a > 0.01) { response += max(0.0, cL - dot(s3.rgb, lumCoeff)); weight += 1.0; }
  if (s4.a > 0.01) { response += max(0.0, cL - dot(s4.rgb, lumCoeff)); weight += 1.0; }
  if (s5.a > 0.01) { response += max(0.0, cL - dot(s5.rgb, lumCoeff)); weight += 1.0; }
  if (s6.a > 0.01) { response += max(0.0, cL - dot(s6.rgb, lumCoeff)); weight += 1.0; }
  if (s7.a > 0.01) { response += max(0.0, cL - dot(s7.rgb, lumCoeff)); weight += 1.0; }

  if (weight > 0.0) response /= weight;

  float shade = exp(-edl.strength * response);
  return vec4(color.rgb * shade, color.a);
}
`;

/**
 * ShaderPass definition consumed by `new PostProcessEffect(edlModule, props)`.
 * Uniform types use luma.gl / WGSL notation ('f32', 'vec2<f32>', …).
 */
export const edlModule = {
    name: 'edl',
    uniformTypes: {
        strength: 'f32',
        radius: 'f32',
    },
    uniforms: {
        strength: 2.5,
        radius: 1.5,
    },
    fs: EDL_FS,
    // sampler pass: deck.gl calls edl_sampleColor(texSrc, screen.texSize, coordinate)
    // texSrc is passed as an explicit parameter → no GLSL declaration-order issues.
    passes: [{ sampler: true }],
} as const;
