// Micro-relief procédural pour le maillage rocheux.
//
// La reconstruction Poisson plafonne à la résolution de la donnée (~0,45 m
// d'espacement d'échantillons sur les pentes douces, bien moins sur les
// parois : un LiDAR nadir échantillonne une pente à densité × cos θ, soit 9 %
// à 85°). Tout ce qui est plus fin que ça — la granulométrie de la roche, les
// fissures décimétriques, l'écaillage — n'existe tout simplement pas dans la
// géométrie et n'y sera jamais.
//
// On le restitue donc en éclairage : un champ de hauteur fractal en espace
// monde perturbe la normale d'ombrage, sans toucher ni à la silhouette ni aux
// ombres portées. Voir docs/ROCK_AND_CLIFF_DETAIL.md §2.D.12.

/** Hash 3D → [0,1). Variante Dave Hoskins (hash13), sans sin(). */
float mrHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.x + p.y) * p.z);
}

/** Bruit de valeur 3D interpolé en smoothstep, dans [-1,1]. */
float mrValueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    float n000 = mrHash(i);
    float n100 = mrHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = mrHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = mrHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = mrHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = mrHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = mrHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = mrHash(i + vec3(1.0, 1.0, 1.0));
    float nz0 = mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y);
    float nz1 = mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y);
    return mix(nz0, nz1, u.z) * 2.0 - 1.0;
}

// Longueur d'onde (m) et amplitude (m) de la première octave. 1,6 m / 13,5 cm :
// l'échelle du bloc et de l'écaille, juste sous ce que la reconstruction sait
// résoudre — assez gros pour se lire à 200 m, assez fin pour ne pas concurrencer
// le relief réel. Amplitude calée à l'œil sur les Aiguilles Rouges : au-delà, le
// rocher part en bruit plutôt qu'en grain.
const float MR_BASE_M = 1.6;
const float MR_AMPL_M = 0.135;
const int MR_OCTAVES = 3;

/**
 * Champ de hauteur fractal en mètres. `pixelM` est l'empreinte monde d'un pixel :
 * une octave dont la longueur d'onde passe sous la taille du pixel ne peut plus
 * être échantillonnée et scintillerait, on l'éteint progressivement — c'est ce
 * qui remplace le mip-mapping dont on ne dispose pas ici.
 */
float mrHeight(vec3 wpos, float pixelM) {
    float h = 0.0;
    float lambda = MR_BASE_M;
    float amp = MR_AMPL_M;
    for (int o = 0; o < MR_OCTAVES; o++) {
        // Pas de branchement : `w` doit rester calculé de façon identique sur
        // tout le quad, sinon les dFdx/dFdy pris sur `h` seraient indéfinis.
        float w = 1.0 - smoothstep(0.25 * lambda, 0.9 * lambda, pixelM);
        h += amp * w * mrValueNoise(wpos / lambda);
        lambda *= 0.42;
        amp *= 0.55;
    }
    return h;
}

/**
 * Perturbe `n` par le micro-relief, `amount` dosant l'amplitude (0 = aucun effet).
 *
 * Méthode de Mikkelsen (« bump mapping unparametrized surfaces ») : le gradient
 * de surface se reconstruit depuis les dérivées écran de la hauteur et de la
 * position monde, donc sans tangentes ni UV — ce qui tombe bien, un maillage
 * Poisson n'en a aucune.
 */
vec3 microReliefNormal(vec3 n, vec3 wpos, float amount) {
    vec3 dpx = dFdx(wpos);
    vec3 dpy = dFdy(wpos);
    float pixelM = max(length(dpx), length(dpy));
    float h = mrHeight(wpos, pixelM) * amount;
    float hx = dFdx(h);
    float hy = dFdy(h);
    vec3 r1 = cross(dpy, n);
    vec3 r2 = cross(n, dpx);
    float det = dot(dpx, r1);
    // Triangle vu par la tranche : pas de repère exploitable.
    if (abs(det) < 1e-12) return n;
    vec3 grad = sign(det) * (hx * r1 + hy * r2);
    return normalize(abs(det) * n - grad);
}
