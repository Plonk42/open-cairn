#version 300 es
precision highp float;
in vec3 v_albedo;
in vec3 v_normal;
in vec2 v_uv;
in vec4 v_lightPos;
in float v_depth;
in float v_distM;
in float v_alpha;
in float v_base;
in vec3 v_wpos;

#include ./lib/sampleShadow.glsl;
#include ./lib/flatLight.glsl;
#include ./lib/microRelief.glsl;
// rockAlbedo utilise mrValueNoise : il doit rester APRÈS microRelief.
#include ./lib/rockAlbedo.glsl;
#include ./lib/pbr.glsl;

uniform vec3 u_sunDir;
uniform float u_sunIntensity;
uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
// Mélange normale interpolée → normale géométrique (0 = lisse, 1 = facettes).
// Voir docs/ROCK_AND_CLIFF_DETAIL.md §2.C.8.
uniform float u_facet;
// Amplitude du micro-relief procédural (0 = aucun). §2.D.12.
uniform float u_microRelief;
// Amplitude de la cassure d'albédo (patine + bord de névé, 0 = aucune). §2.D.13.
uniform float u_rockBreak;
uniform sampler2D u_ortho;       // mosaïque orthophoto IGN (unité texture 3)
uniform float u_photoOpacityGround;    // 0..1, drapage photo sur le sol (le mesh = sol)
uniform float u_hasPhoto;        // 0 ou 1, texture photo disponible
uniform float u_wireframe;       // 1 = fil de fer debug (couleur plate, sans lumière/texture)
layout(location = 0) out vec4 fragColor;
// x = linear EDL depth (v_depth, normalized by u_farPlane in edl.frag), stored
// **negated** so the composite pass can tell mesh fragments from point ones:
// EDL's black silhouettes are a point-cloud legibility trick and read as
// cracks on a continuous surface, so edl.frag skips them here. Magnitude is
// unchanged (edl.frag takes abs()), and 0 stays the no-data sentinel.
// y = real hardware NDC depth (gl_FragCoord.z) — sampled in edl.frag as the
// "own depth" and compared against the LiDAR-only shared depth texture so a
// nearer cloud wins over a farther one where they overlap (multi-cloud
// occlusion; see SharedLidarDepth in LidarWebGLLayer.ts).
layout(location = 1) out vec2 fragDepth;

void main() {
    // Mode debug fil de fer : couleur plate lisible, aucune lumière ni photo.
    if (u_wireframe > 0.5) {
        fragColor = vec4(0.15, 1.0, 0.55, 1.0);
        fragDepth = vec2(-v_depth, gl_FragCoord.z);
        return;
    }
    float s = sampleShadow();

    vec3 nSmooth = normalize(v_normal);
    vec3 albedo = v_albedo;
    // Drapage photo uniquement à l'intérieur de l'emprise de la mosaïque — et
    // seulement sur les surfaces qui « voient le ciel ». Une photo nadir n'a
    // aucun sens sur une face orientée vers le bas : on l'estompe quand la
    // normale bascule sous l'horizontale, ce qui retire la texture du fond
    // fermé fantôme du mesh Poisson (et des dessous de surplombs) sans toucher
    // à la géométrie ni aux falaises verticales. Les murs verticaux du socle
    // synthétique (v_base, hachurés ci-dessous) ne « voient » pas le ciel non
    // plus mais leur normale est quasi-horizontale (v_up≈0) donc le lissage
    // ci-dessus les laisserait recevoir la photo — on les exclut explicitement.
    // On utilise ici la normale LISSE : le drapage ne doit pas scintiller au
    // gré de la facettisation.
    float photoFacing = v_base > 0.5 ? 0.0 : smoothstep(-0.25, 0.05, nSmooth.z);
    if (u_hasPhoto > 0.5
        && photoFacing > 0.0
        && v_uv.x >= 0.0 && v_uv.x <= 1.0
        && v_uv.y >= 0.0 && v_uv.y <= 1.0) {
        vec3 photo = texture(u_ortho, v_uv).rgb;
        albedo = mix(v_albedo, photo, u_photoOpacityGround * photoFacing);
    }

    // ── Normale de rendu ──────────────────────────────────────────────────
    // La normale de sommet issue de Poisson est lisse par construction (le
    // solveur résout un champ scalaire C², et le pipeline lui applique encore
    // deux passes laplaciennes) : interpolée sur le triangle, elle donne au
    // rocher un aspect de cire. La normale géométrique — constante sur chaque
    // facette, reconstruite ici depuis les dérivées écran de la position monde
    // — restitue au contraire la facettisation réelle du maillage. u_facet
    // dose entre les deux.
    vec3 nGeom = nSmooth;
    if (u_facet > 0.0) {
        vec3 g = cross(dFdx(v_wpos), dFdy(v_wpos));
        float gLen2 = dot(g, g);
        // Triangle dégénéré / silhouette : pas de normale géométrique exploitable.
        if (gLen2 > 1e-20) {
            nGeom = g * inversesqrt(gLen2);
            // Le signe dépend du bobinage à l'écran, pas de l'orientation réelle.
            if (dot(nGeom, nSmooth) < 0.0) nGeom = -nGeom;
        }
    }
    vec3 n = normalize(mix(nSmooth, nGeom, u_facet));

    // Micro-relief : uniquement sur la roche. La neige est lisse dans la
    // nature, et les murs verticaux du socle synthétique ne sont pas du terrain
    // — la luminance de l'albédo suffit à distinguer névé et rocher, palette ou
    // photo drapée indifféremment. Multiplié plutôt que branché : `microReliefNormal`
    // prend des dérivées d'écran, elles seraient indéfinies sous un branchement divergent.
    float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    float notBase = 1.0 - step(0.5, v_base);
    float rockness = (1.0 - smoothstep(0.55, 0.80, lum)) * notBase;
    n = microReliefNormal(n, v_wpos, u_microRelief * rockness);

    // Cassure d'albédo : patine fractale sur le rocher + bord de névé dentelé.
    // Purement réflectance — appliquée avant tout calcul de lumière.
    float pixelM = max(length(dFdx(v_wpos)), length(dFdy(v_wpos)));
    albedo = rockAlbedoBreakup(albedo, v_wpos, pixelM, rockness, u_rockBreak * notBase);

    float diff = max(0.0, dot(n, u_sunDir)) * u_sunIntensity;
    vec3 flatDir = normalize(FLAT_LIGHT_DIR);
    // Éclairage neutre : wrap-lighting doux → relief lisible sans dureté.
    float flatDiff = dot(n, flatDir) * 0.5 + 0.5;
    // Le chemin PBR fournit déjà un plancher via l'ambiante hémisphérique : il
    // lui faut un N·L franc, pas le wrap (qui rajouterait de la lumière fantôme
    // sur les faces détournées de la lumière et écraserait le relief).
    float flatDirect = max(0.0, dot(n, flatDir));
    vec3 ambient = albedo * 0.35;
    vec3 diffuse = albedo * (0.75 * diff) * u_sunColor;
    vec3 lit = ambient + diffuse * s;
    // Éclairage neutre (soleil désactivé) : direction fixe douce + plancher
    // ambiant élevé → relief toujours lisible. Les ombres portées (s) peuvent
    // s'appliquer même sans soleil — la shadow map suit alors la direction fixe.
    vec3 neutral = albedo * (0.2 + 0.8 * flatDiff * s);
    vec3 rgb = mix(lit, neutral, u_flatLight);
    // Chemin photoréaliste : même décomposition (direct × ombre, soleil ou
    // lumière fixe) mais résolue en radiance linéaire avec ambiante
    // hémisphérique, perspective aérienne et tone mapping filmique.
    float direct = mix(diff, flatDirect, u_flatLight) * s;
    rgb = mix(rgb, pbrEncode(pbrShade(albedo, n.z, direct, v_distM)), u_pbr);
    // Hachures à 45° gravées sur les murs du socle synthétique. En espace-monde
    // (v_wpos, mètres) : les lignes suivent le mesh (elles restent fixées à la
    // paroi quand la caméra bouge). L'épaisseur est mesurée en pixels via fwidth
    // pour rester un trait fin d'~1 px quel que soit le zoom.
    if (v_base > 0.5) {
        const float HATCH_PERIOD_M = 10.0; // espacement des lignes (mètres, sur le mesh)
        float coord = (v_wpos.z + v_wpos.x + v_wpos.y) / HATCH_PERIOD_M;
        float f = fract(coord);
        float line = min(f, 1.0 - f);                  // distance à la ligne la plus proche
        float dist = line / max(fwidth(coord), 1e-5);  // distance en pixels
        float lineMask = 1.0 - smoothstep(0.5, 1.0, dist); // trait fin d'~1 px
        rgb = mix(rgb, rgb * 0.75, lineMask);
    }
    // Couleur PRÉMULTIPLIÉE par l'alpha : la passe géométrique peut être rendue
    // en suréchantillonnage, et seule une couleur prémultipliée se moyenne
    // correctement — sinon les silhouettes, moyennées avec le fond effacé à
    // (0,0,0,0), ressortent assombries. Le compositing (edl.frag) applique donc
    // un blend prémultiplié.
    fragColor = vec4(rgb * v_alpha, v_alpha);
    fragDepth = vec2(-v_depth, gl_FragCoord.z);
}
