// ─── Strates et fractures des parois ────────────────────────────────────────
//
// Une orthophoto est prise au nadir : sur une face verticale elle ne couvre
// qu'une poignée de pixels étirés, et `mesh.frag` coupe donc le drapage dès que
// la normale bascule vers l'horizontale (`photoFacing`). Résultat : les
// falaises — les surfaces qui demandent le plus de détail — sont les seules à
// n'avoir aucune information d'albédo, juste l'aplat continu de la palette.
//
// Ce module comble ce trou par une texture procédurale en espace monde, dosée
// exactement là où le drapage s'éteint : des bancs quasi horizontaux (la roche
// sédimentaire des Aiguilles Rouges se lit en strates) et un réseau de
// fractures fines. Purement réflectance — aucune lumière n'est cuite ici.
//
// DÉPENDANCE : requiert `mrValueNoise` de ./lib/microRelief.glsl, inclus AVANT
// ce fichier.
//
// Voir docs/ROCK_AND_CLIFF_DETAIL.md §2.D.14.

const float CT_STRATA_M = 3.6;      // épaisseur moyenne d'un banc (mètres)
const float CT_STRATA_LATERAL = 0.03; // 1/m — vitesse de dérive latérale des bancs
const float CT_WARP = 0.045;        // 1/m — ondulation qui casse l'horizontale parfaite
const float CT_WARP_M = 2.0;        // amplitude de cette ondulation (mètres)
const float CT_FRACT_M = 2.2;       // espacement moyen des fractures (mètres)
const float CT_STRATA_AMT = 0.22;   // contraste de valeur entre deux bancs
const float CT_FRACT_AMT = 0.30;    // assombrissement au fond d'une fracture

/** Atténue un motif dès que sa période passe sous l'empreinte du pixel. */
float ctFade(float periodM, float pixelM) {
    return 1.0 - smoothstep(0.30 * periodM, 1.10 * periodM, pixelM);
}

/** Bruit à crêtes : maximal là où le bruit de base traverse zéro. */
float ctRidged(vec3 p) {
    return 1.0 - abs(mrValueNoise(p));
}

/**
 * `steep` vaut 1 sur une paroi verticale et 0 sur une surface tournée vers le
 * ciel (donc déjà drapée), `amount` est le curseur. `pixelM` est l'empreinte
 * monde d'un pixel, qui sert à éteindre chaque motif avant qu'il ne moutonne.
 */
vec3 cliffTexture(vec3 albedo, vec3 wpos, float pixelM, float steep, float amount) {
    float k = amount * steep;
    if (k <= 0.0) return albedo;

    // Bancs : bruit fortement comprimé sur la verticale, avec un gauchissement
    // basse fréquence pour qu'ils ne soient pas rigoureusement horizontaux.
    float warp = mrValueNoise(wpos * CT_WARP) * CT_WARP_M;
    float strata = mrValueNoise(vec3(wpos.xy * CT_STRATA_LATERAL, (wpos.z + warp) / CT_STRATA_M));
    float v = 1.0 + CT_STRATA_AMT * strata * k * ctFade(CT_STRATA_M, pixelM);

    // Fractures : seules les crêtes les plus marquées deviennent une cassure.
    float cracks = ctRidged(wpos / CT_FRACT_M) * ctFade(CT_FRACT_M, pixelM);
    v *= 1.0 - CT_FRACT_AMT * smoothstep(0.74, 1.0, cracks) * k;

    return clamp(albedo * v, 0.0, 1.0);
}
