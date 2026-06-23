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

uniform mat4 u_matrix;     // Pre-translated matrix (includes origin translation)
uniform float u_mpu;       // meters per Mercator unit
uniform float u_ps;        // point size
uniform uint u_classMask[8];
uniform vec3 u_sunDir;
uniform float u_sunIntensity;
uniform mat4 u_lightMatrix;   // world-meters → light-clip space
uniform vec4 u_uvRect;        // (eMin, nMin, eMax, nMax) en mètres-offset
uniform float u_vegSizeBoost; // point-size multiplier for vegetation
uniform float u_vegEnhance;   // 1 = vegetation enhancements on
uniform float u_vegIntensity;   // 0 = flat class colour, 1 = full palette
uniform float u_vegHeightScale; // height (m) mapped to the top of the palette
uniform float u_vegColorMode;   // 0 = natural ramp, 1 = viridis height colormap, 2 = species

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

out vec3 v_albedo;
out float v_diff;
out float v_flatDiff;
out vec2 v_uv;
out vec4 v_lightPos;
out float v_depth;
out float v_alpha;
out float v_isVeg;
out float v_isGround;

#include ./lib/flatLight.glsl;

// Dégradé feuillage « naturel » : tronc/litière brun → sous-bois → canopée
// vive → cime jaune-vert. "scale" étire l'axe hauteur (sommet atteint à
// "scale" m au lieu de 15) — copie GPU de vegRamp() (lidarCloud.ts).
// Palette volontairement contrastée : base sombre (ombre au sol) et cime très
// lumineuse virant au vert-doré pour bien détacher la canopée.
vec3 vegRampColor(float h, float scale) {
    float hh = h * (15.0 / max(1.0, scale));
    vec3 c0 = vec3(58.0, 44.0, 30.0) / 255.0;    // litière / tronc dans l'ombre
    vec3 c1 = vec3(52.0, 96.0, 42.0) / 255.0;    // sous-bois vert profond
    vec3 c2 = vec3(108.0, 172.0, 60.0) / 255.0;  // canopée vive
    vec3 c3 = vec3(226.0, 226.0, 110.0) / 255.0; // cime vert-doré lumineuse
    if (hh <= 0.0) return c0;
    if (hh <= 1.5) return mix(c0, c1, hh / 1.5);
    if (hh <= 6.0) return mix(c1, c2, (hh - 1.5) / 4.5);
    if (hh <= 15.0) return mix(c2, c3, (hh - 6.0) / 9.0);
    return c3;
}

// Modulation de hauteur appliquée SUR une couleur d'essence (mode « essence »).
// Assombrit nettement le bas (litière/tronc à l'ombre) et éclaircit la cime en
// la réchauffant vers un vert-doré : chaque arbre se détache fortement tout en
// gardant sa teinte BD Forêt. ht ∈ [0,1] = hauteur normalisée du point.
vec3 speciesHeightShade(vec3 base, float ht) {
    vec3 shade = base * mix(0.42, 1.10, ht);
    vec3 canopyTint = vec3(1.14, 1.10, 0.80);
    shade *= mix(vec3(1.0), canopyTint, smoothstep(0.5, 1.0, ht));
    return clamp(shade, 0.0, 1.0);
}


// Colormap viridis (matplotlib / IGN LiDAR HD), 11 paliers — copie GPU de
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

// Le bit 'legend' est-il visible dans le masque de filtre de la légende ?
bool speciesMaskHas(int legend) {
    uint w = uint(legend) >> 5u;
    uint b = uint(legend) & 31u;
    return (u_speciesMask[w] & (1u << b)) != 0u;
}

// Graine pseudo-aléatoire stable par cellule de grille — repli quand aucun
// sommet d'arbre (treeSeed) n'est disponible pour répartir les essences d'un
// peuplement mélangé.
float gridSeed(vec2 xy, float cell) {
    vec2 id = floor(xy / max(1.0, cell));
    return fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
}

// Résout l'identifiant de légende (groupe ou essence) d'un point de végétation,
// ou -1 si le point n'a pas de donnée BD Forêt (→ dégradé hauteur générique).
// En mode « essence », un peuplement mélangé pioche une essence candidate selon
// la graine d'arbre, donc tous les points d'une même cime partagent la couleur.
int forestLegend(int cat, float treeSeed, vec2 xy) {
    if (cat < 0 || cat >= 32) return -1;
    int grp = u_catGroup[cat];
    if (grp > 200) return -1;                 // 255 = catégorie non définie
    if (u_forestGrouping < 0.5) return grp;    // mode « groupes » : plat par peuplement
    int sp = u_catSpecies[cat];
    if (sp > 200) {                            // catégorie mélangée → tirage d'une essence
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
        v_uv = vec2(-1.0);
        v_lightPos = vec4(0.0);
        v_depth = 0.0;
        v_alpha = 0.0;
        v_isVeg = 0.0;
        v_isGround = 0.0;
        return;
    }

    // Sol = classes ASPRS 2 (sol) et 9 (eau) — drapage photo « sol » vs « non-sol ».
    v_isGround = (c == 2u || c == 9u) ? 1.0 : 0.0;
    // Végétation = classes ASPRS 3/4/5 (basse/moyenne/haute).
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

    vec3 nrm = normalize(a_normal);
    v_diff = max(0.0, dot(nrm, u_sunDir)) * u_sunIntensity;
    // Éclairage neutre : wrap-lighting doux (le terme négatif est replié pour
    // que les faces opposées restent éclairées) → relief lisible sans dureté.
    v_flatDiff = dot(nrm, normalize(FLAT_LIGHT_DIR)) * 0.5 + 0.5;
    // Coloration du feuillage calculée sur le GPU : « Dégradé feuillage »
    // (intensité) et « Hauteur max » (échelle) sont de simples uniforms → les
    // sliders sont instantanés, sans recalcul CPU ni ré-upload du nuage.
    vec3 baseCol = a_color.rgb;
    if (v_isVeg > 0.5) {
        float gradAmt = clamp(u_vegIntensity, 0.0, 1.0);
        if (u_vegColorMode > 1.5) {
            // Mode « essence » : couleur réelle issue de la BD Forêt.
            int cat = int(a_tfv + 0.5);
            int legend = forestLegend(cat, a_treeSeed, a_pos.xy);
            if (legend >= 0) {
                // Filtre de légende : on pousse hors écran les essences masquées.
                if (u_speciesFilterOn > 0.5 && !speciesMaskHas(legend)) {
                    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    gl_PointSize = 0.0;
                    v_alpha = 0.0;
                    return;
                }
                // La coloration par essence est TOUJOURS appliquée (découplée du
                // slider). « Dégradé feuillage » ne pilote que l'amplitude du
                // dégradé de hauteur ajouté par-dessus : à 0 la teinte d'essence
                // reste pleine, à 1 le dégradé cime/tronc est complet.
                vec3 species = u_forestPalette[legend];
                float ht = clamp(a_height / max(1.0, u_vegHeightScale), 0.0, 1.0);
                baseCol = mix(species, speciesHeightShade(species, ht), gradAmt);
            } else {
                // Végétation hors de tout peuplement → dégradé hauteur générique,
                // piloté par le slider (rien à colorer par essence ici).
                baseCol = mix(baseCol, vegRampColor(a_height, u_vegHeightScale), gradAmt);
            }
        } else if (u_vegColorMode > 0.5) {
            baseCol = mix(baseCol, viridisColor(a_height / max(1.0, u_vegHeightScale)), gradAmt);
        } else {
            baseCol = mix(baseCol, vegRampColor(a_height, u_vegHeightScale), gradAmt);
        }
    }
    v_albedo = baseCol;
    v_alpha = a_color.a;
    // Projection planaire nadir (vue de dessus) identique au mesh : permet de
    // draper l'orthophoto sur les points (végétation, bâti, …).
    v_uv = vec2(
        (a_pos.x - u_uvRect.x) / (u_uvRect.z - u_uvRect.x),
        (u_uvRect.w - a_pos.y) / (u_uvRect.w - u_uvRect.y)
    );

    // a_pos is east/north/up in meters — same frame as the light matrix.
    v_lightPos = u_lightMatrix * vec4(a_pos, 1.0);
}
