#version 300 es
precision highp float;
in vec3 v_albedo;
in float v_ndotl;
in float v_flatNdotl;
in vec2 v_uv;
in vec4 v_lightPos;
in float v_depth;
in float v_distM;
in float v_alpha;
in float v_up;
in float v_base;
in vec3 v_wpos;

#include ./lib/sampleShadow.glsl;
#include ./lib/pbr.glsl;

uniform vec3 u_sunColor;
uniform float u_flatLight;        // 1 = neutral omnidirectional light, 0 = sun
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
    // Le socle synthétique (murs du pourtour + fond fermé du mesh Poisson) est
    // un artifice cartographique : il donne au nuage l'aspect d'un bloc posé
    // sur la carte, ce qui est lisible en vue oblique de carte mais trahit
    // immédiatement le pavé rectangulaire dès qu'on cherche une image de
    // paysage. En rendu photoréaliste on le supprime, pour que le maillage se
    // raccorde visuellement au terrain autour au lieu de flotter dessus.
    // Deux familles de faces : les murs marqués par le masque (v_base) et le
    // fond, reconnaissable à sa normale qui regarde le sol (même critère que
    // le fondu du drapage photo plus bas).
    if (u_pbr > 0.5 && (v_base > 0.5 || v_up < -0.25)) discard;
    // Le maillage Poisson n'a pas un winding globalement cohérent : le culler
    // ouvrait de vrais trous, variables selon l'angle de vue. On dessine donc
    // les deux faces et on retourne la normale vers l'œil — une face arrière
    // n'est plus un trou noir mais la même surface vue de l'autre côté.
    float face = gl_FrontFacing ? 1.0 : -1.0;
    float up = v_up * face;
    float diff = max(0.0, v_ndotl * face);
    // Lumière neutre : wrap-lighting doux → relief lisible sans dureté. Le
    // chemin PBR, lui, a déjà un plancher via l'ambiante hémisphérique et veut
    // un N·L franc, sinon le relief s'écrase.
    float flatDiff = v_flatNdotl * face * 0.5 + 0.5;
    float flatDirect = max(0.0, v_flatNdotl * face);
    float s = sampleShadow();
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
    float photoFacing = v_base > 0.5 ? 0.0 : smoothstep(-0.25, 0.05, up);
    if (u_hasPhoto > 0.5
        && photoFacing > 0.0
        && v_uv.x >= 0.0 && v_uv.x <= 1.0
        && v_uv.y >= 0.0 && v_uv.y <= 1.0) {
        vec3 photo = texture(u_ortho, v_uv).rgb;
        albedo = mix(v_albedo, photo, u_photoOpacityGround * photoFacing);
    }
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
    rgb = mix(rgb, pbrEncode(pbrShade(albedo, up, direct, v_distM)), u_pbr);
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
