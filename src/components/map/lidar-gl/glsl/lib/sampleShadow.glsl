// Shadow-map sampling (3×3 PCF) shared by FS_POINTS and FS_MESH.
// Requires an `in vec4 v_lightPos;` varying (world-meters → light-clip) to be
// declared BEFORE the include point.
uniform sampler2D u_shadowMap;
uniform float u_shadowEnabled;   // 0 or 1
uniform float u_shadowBias;
uniform vec2 u_shadowTexel;      // 1/shadowMapSize (x,y)
uniform float u_shadowStrength;  // 0..1, strength of the cast shadows

float sampleShadow() {
    if (u_shadowEnabled < 0.5) return 1.0;
    // Perspective divide (light projection is ortho so w==1, but be safe).
    vec3 lp = v_lightPos.xyz / v_lightPos.w;
    // Light NDC ∈ [-1,1] → texture uv ∈ [0,1] and reference depth ∈ [0,1].
    vec3 luv = lp * 0.5 + 0.5;
    if (luv.x < 0.0 || luv.x > 1.0 || luv.y < 0.0 || luv.y > 1.0 || luv.z > 1.0) {
        return 1.0;
    }
    float ref = luv.z - u_shadowBias;
    // 3×3 PCF for a soft penumbra.
    float sum = 0.0;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            vec2 off = vec2(float(dx), float(dy)) * u_shadowTexel;
            float d = texture(u_shadowMap, luv.xy + off).r;
            sum += (ref <= d) ? 1.0 : 0.0;
        }
    }
    float visible = sum / 9.0;
    // Blend toward fully lit by (1 - strength) so a strength of 1 gives
    // hard cast shadows and strength 0 disables them.
    return mix(1.0, visible, u_shadowStrength);
}
