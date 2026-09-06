// Cassure d'albédo du rocher. Voir docs/ROCK_AND_CLIFF_DETAIL.md §2.D.13.
//
// La palette `montagne` (src/lib/lidarBrowser/slope.ts) est une fonction lisse
// de la pente, de l'altitude et de l'orientation : à pente et altitude données,
// tout le versant reçoit exactement la même couleur. Le rocher réel, lui, est
// zoné — bancs, veines, patine, lichen, traînées de ruissellement — et cette
// variation de réflectance est une bonne moitié de ce qui le fait *lire* comme
// de la roche. On la rajoute ici en espace monde, en réflectance pure : aucune
// lumière n'est cuite, la palette n'en sait rien, et le résultat suit le mesh
// quand la caméra bouge.
//
// Second effet, même curseur : la limite névé/rocher de `montagneGround` est
// une rampe lisse → des plaques de neige floues et gélatineuses. On la
// re-tranche avec le même bruit, ce qui lui rend un bord dentelé.
//
// DÉPENDANCE : requiert `mrValueNoise` de ./lib/microRelief.glsl, qui doit être
// inclus AVANT ce fichier (les includes sont textuels et à plat).

// Longueurs d'onde (m) des deux octaves de patine : l'échelle du banc rocheux
// et celle de la dalle.
const float RA_BAND_M = 22.0;
const float RA_DETAIL_M = 6.5;
// Amplitude de la modulation de luminosité à 100 % (±18 %) et de la dérive
// chaud/froid associée (oxydation vs roche saine).
const float RA_VALUE = 0.18;
const float RA_TINT = 0.07;

// Fenêtre de luminance dans laquelle on considère qu'on est sur la transition
// rocher → neige. Mêmes bornes que le masque de micro-relief, pour que les deux
// effets se relaient exactement au même endroit.
const float RA_SNOW_LO = 0.55;
const float RA_SNOW_HI = 0.80;
// Longueur d'onde (m) et amplitude du bruit qui découpe le bord du névé, et
// raideur du re-seuillage (>1 = bord plus franc que la rampe d'origine).
const float RA_SNOW_M = 5.0;
const float RA_SNOW_JITTER = 0.42;
const float RA_SNOW_SHARPEN = 2.6;

/**
 * Bruit fractal 2 octaves en espace monde, dans [-1,1] environ.
 * `pixelM` = empreinte d'un pixel sur la surface (m) : chaque octave s'éteint
 * avant d'atteindre la fréquence de Nyquist de l'écran, sinon la roche
 * fourmille dès qu'on s'éloigne.
 */
float raFbm(vec3 wpos, float pixelM) {
    float w1 = 1.0 - smoothstep(0.25 * RA_BAND_M, 0.9 * RA_BAND_M, pixelM);
    float w2 = 1.0 - smoothstep(0.25 * RA_DETAIL_M, 0.9 * RA_DETAIL_M, pixelM);
    return mrValueNoise(wpos / RA_BAND_M) * w1
         + mrValueNoise(wpos / RA_DETAIL_M) * 0.5 * w2;
}

/**
 * Module l'albédo du rocher et redécoupe le bord des névés.
 *
 * @param albedo  couleur de base (palette ou photo drapée), linéaire perceptuel
 * @param wpos    position monde en mètres (est, nord, altitude)
 * @param pixelM  empreinte pixel sur la surface, en mètres
 * @param rock    masque rocher dans [0,1] (0 = neige)
 * @param amount  intensité de l'effet (0 = aucun, 1 = nominal). L'appelant y
 *                annule le socle synthétique, qui n'est pas du terrain.
 * @param snowEdge 1 si la palette courante peint de la neige, 0 sinon. La
 *                re-découpe du bord de névé lit un taux de neige dans la
 *                luminance : sur une palette d'été, où la même luminance veut
 *                juste dire « calcaire clair », elle déchiquetterait la paroi
 *                en plaques aléatoires.
 */
vec3 rockAlbedoBreakup(vec3 albedo, vec3 wpos, float pixelM, float rock, float amount, float snowEdge) {
    if (amount <= 0.0) return albedo;

    // ── Patine : variation de valeur + dérive chaud/froid ──────────────────
    float nb = raFbm(wpos, pixelM);
    float k = amount * rock;
    // Le rouge monte et le bleu descend quand le bruit est positif : c'est la
    // signature d'une patine ferrugineuse, la dérive inverse donnant la roche
    // fraîchement cassée, plus grise et plus froide.
    vec3 tint = vec3(1.0 + RA_TINT * nb, 1.0, 1.0 - RA_TINT * nb);
    vec3 out_ = albedo * (1.0 + RA_VALUE * nb * k) * mix(vec3(1.0), tint, k);

    // ── Bord de névé ──────────────────────────────────────────────────────
    // On lit dans la luminance le taux de neige `t` déjà mélangé par la
    // palette, on reconstruit les deux couleurs extrêmes qui redonnent
    // exactement `out_` en `t` (donc effet nul quand le bruit est nul), puis on
    // remélange avec un seuil bruité et plus raide.    if (snowEdge <= 0.0) return clamp(out_, 0.0, 1.0);    float lum = dot(out_, vec3(0.2126, 0.7152, 0.0722));
    float t = smoothstep(RA_SNOW_LO, RA_SNOW_HI, lum);
    // Hors zone de transition (t≈0 ou t≈1) le remélange est l'identité : la
    // dalle rocheuse et le névé franc ne bougent pas.
    float ns = mrValueNoise(wpos / RA_SNOW_M);
    float tn = clamp((t - 0.5 - RA_SNOW_JITTER * ns) * RA_SNOW_SHARPEN + 0.5, 0.0, 1.0);
    vec3 rockRef = out_ * (1.0 - 0.30 * t);
    vec3 snowRef = out_ + 0.30 * (1.0 - t) * (vec3(1.0) - out_);
    out_ = mix(out_, mix(rockRef, snowRef, tn), amount * snowEdge);

    return clamp(out_, 0.0, 1.0);
}
