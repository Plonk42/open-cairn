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

/**
 * Bruit de valeur 3D interpolé en Hermite, dans [-1,1], ET son gradient
 * analytique `grad` (par unité de `p`).
 *
 * Le gradient est indispensable : le prendre en dérivées d'écran (dFdx/dFdy)
 * le rendrait constant sur le quad 2×2 du GPU, donc tout le relief rocheux
 * serait ombré à la moitié de la résolution linéaire de l'écran. Voir
 * docs/ROCK_AND_CLIFF_DETAIL.md §4. Le trilinéaire est réécrit sous forme
 * développée (k0..k7) — algébriquement identique au `mix` imbriqué, mais les
 * trois dérivées partielles s'en déduisent sans réévaluer les 8 coins.
 */
float mrValueNoiseD(vec3 p, out vec3 grad) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    vec3 du = 6.0 * f * (1.0 - f);
    float n000 = mrHash(i);
    float n100 = mrHash(i + vec3(1.0, 0.0, 0.0));
    float n010 = mrHash(i + vec3(0.0, 1.0, 0.0));
    float n110 = mrHash(i + vec3(1.0, 1.0, 0.0));
    float n001 = mrHash(i + vec3(0.0, 0.0, 1.0));
    float n101 = mrHash(i + vec3(1.0, 0.0, 1.0));
    float n011 = mrHash(i + vec3(0.0, 1.0, 1.0));
    float n111 = mrHash(i + vec3(1.0, 1.0, 1.0));

    float k0 = n000;
    float k1 = n100 - n000;
    float k2 = n010 - n000;
    float k3 = n001 - n000;
    float k4 = n000 - n100 - n010 + n110;
    float k5 = n000 - n100 - n001 + n101;
    float k6 = n000 - n010 - n001 + n011;
    float k7 = -n000 + n100 + n010 - n110 + n001 - n101 - n011 + n111;

    float n = k0 + k1 * u.x + k2 * u.y + k3 * u.z
        + k4 * u.x * u.y + k5 * u.x * u.z + k6 * u.y * u.z
        + k7 * u.x * u.y * u.z;

    // ×2 pour suivre la remise à l'échelle [0,1] → [-1,1] du retour.
    grad = 2.0 * du * vec3(
        k1 + k4 * u.y + k5 * u.z + k7 * u.y * u.z,
        k2 + k4 * u.x + k6 * u.z + k7 * u.x * u.z,
        k3 + k5 * u.x + k6 * u.y + k7 * u.x * u.y);

    return n * 2.0 - 1.0;
}

/** Même bruit, sans le gradient (le calcul de `grad` est éliminé à la compilation). */
float mrValueNoise(vec3 p) {
    vec3 grad;
    return mrValueNoiseD(p, grad);
}

// Longueur d'onde (m) et amplitude (m) de la première octave. 1,6 m / 13,5 cm :
// l'échelle du bloc et de l'écaille, juste sous ce que la reconstruction sait
// résoudre — assez gros pour se lire à 200 m, assez fin pour ne pas concurrencer
// le relief réel. Amplitude calée à l'œil sur les Aiguilles Rouges : au-delà, le
// rocher part en bruit plutôt qu'en grain.
const float MR_BASE_M = 1.6;
const float MR_AMPL_M = 0.135;
const int MR_OCTAVES = 3;
// Fondu d'octave, en fractions de la longueur d'onde : une octave commence à
// s'éteindre dès que l'empreinte pixel atteint la moitié de sa longueur d'onde
// et a disparu à 1,4 λ. Volontairement anticipé — à 0,9 λ une octave battait
// encore à moitié pile sur la fréquence de Nyquist de l'écran (§4.2).
const float MR_FADE_LO = 0.5;
const float MR_FADE_HI = 1.4;

/**
 * Champ de hauteur fractal en mètres, et son gradient monde `grad` (sans unité).
 * `pixelM` est l'empreinte monde d'un pixel : une octave dont la longueur d'onde
 * passe sous la taille du pixel ne peut plus être échantillonnée et
 * scintillerait, on l'éteint progressivement — c'est ce qui remplace le
 * mip-mapping dont on ne dispose pas ici.
 */
float mrHeight(vec3 wpos, float pixelM, out vec3 grad) {
    float h = 0.0;
    grad = vec3(0.0);
    float lambda = MR_BASE_M;
    float amp = MR_AMPL_M;
    for (int o = 0; o < MR_OCTAVES; o++) {
        float w = 1.0 - smoothstep(MR_FADE_LO * lambda, MR_FADE_HI * lambda, pixelM);
        vec3 g;
        h += amp * w * mrValueNoiseD(wpos / lambda, g);
        grad += (amp * w / lambda) * g;
        lambda *= 0.42;
        amp *= 0.55;
    }
    return h;
}

/**
 * Perturbe `n` par le micro-relief, `amount` dosant l'amplitude (0 = aucun effet).
 *
 * Méthode de Mikkelsen (« bump mapping unparametrized surfaces ») : le gradient
 * de surface est la composante tangentielle du gradient 3D de la hauteur, donc
 * ni tangentes ni UV — ce qui tombe bien, un maillage Poisson n'en a aucune.
 * Le gradient étant analytique, la perturbation est calculée PAR PIXEL (elle
 * l'était par quad 2×2 tant qu'elle venait de dFdx/dFdy — voir §4.2).
 */
vec3 microReliefNormal(vec3 n, vec3 wpos, float amount) {
    // Seule l'empreinte pixel reste une dérivée d'écran : c'est une grandeur
    // basse fréquence, sa quantification par quad est sans effet visible.
    float pixelM = max(length(dFdx(wpos)), length(dFdy(wpos)));
    vec3 grad;
    mrHeight(wpos, pixelM, grad);
    grad *= amount;
    vec3 surfGrad = grad - n * dot(n, grad);
    return normalize(n - surfGrad);
}
