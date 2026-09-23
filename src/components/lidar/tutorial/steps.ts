/**
 * Declarative definition of the LiDAR Studio onboarding tutorial.
 *
 * This file is the SINGLE source of truth for the tutorial content. Adding,
 * removing or reordering a step — or retargeting one at a different control —
 * is done here alone; the `StudioTutorial` component reads this list and never
 * hard-codes a feature.
 *
 * Targets are referenced by a `data-tutorial="<id>"` attribute placed on the
 * real UI element (see `StudioSidePanel`, `StudioCaptureButton`,
 * `ShowcaseGallery`, `ShowcaseExport`, `LidarStudio`). Using DOM anchors
 * instead of React refs keeps the tutorial fully decoupled: a button can move
 * to another component without touching this file, and a step whose target is
 * absent from the DOM is simply skipped.
 */

/** Where the tooltip card sits relative to its highlighted target. */
export type TutorialPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** Optional motion hint baked into the card (built-in SVG, no external media). */
export type TutorialGesture = 'drag-orbit';

/**
 * A surface the tutorial must reveal before the step can anchor to it (e.g. a
 * panel section whose contents only exist in the DOM while it is open, or one
 * that has to be scrolled into view). The studio listens for the
 * `open-cairn-studio-reveal` event and unfolds the matching surface. Steps
 * without a `reveal` leave every surface as the user left it.
 */
export type TutorialReveal = 'capture' | 'render' | 'camera' | 'scene';

/**
 * Name of the event the studio listens to so a step can reveal the surface it
 * needs. Its `detail` is the `TutorialReveal` of the current step, or `null`
 * when leaving it. Lives here rather than in the overlay component so the
 * surfaces that react to it (`StudioCaptureButton`, `StudioSidePanel`) don't
 * have to import the tutorial UI.
 */
export const STUDIO_REVEAL_EVENT = 'open-cairn-studio-reveal';

export interface TutorialStep {
    /** Stable id (also used as React key). */
    id: string;
    /**
     * CSS selector of the element to spotlight, or `null` for a centered,
     * anchor-less step (e.g. the welcome card).
     */
    selector: string | null;
    /** Short, action-oriented title. */
    title: string;
    /** One or two sentences of guidance. Keep it light. */
    body: string;
    /**
     * Optional bullet lines rendered under the body, one per line. Each item
     * may use `Label — text` or `Label : text`; the part before the first
     * `—`/`:` is emphasised. Used e.g. to contrast the reconstruction modes.
     */
    lines?: readonly string[];
    /** Preferred card placement around the target. */
    placement: TutorialPlacement;
    /** Optional built-in animated gesture hint. */
    gesture?: TutorialGesture;
    /**
     * Optional surface to open before the step (so its target can be measured)
     * and close again on leaving. Such steps are never auto-skipped — the
     * reveal mechanism guarantees their target appears.
     */
    reveal?: TutorialReveal;
    /**
     * Optional media URL (image/webm) for a future richer step. Intentionally
     * unused today — the live spotlight is the illustration — but kept so a
     * short clip can be dropped in later without changing the component.
     */
    media?: string;
}

/**
 * The "first render" golden path: ~6 short steps that take a newcomer from an
 * empty studio to a saved 3D render, without drowning them in every option.
 */
export const STUDIO_TUTORIAL_STEPS: readonly TutorialStep[] = [
    {
        id: 'welcome',
        selector: null,
        title: 'Bienvenue dans le Studio LiDAR',
        body: 'En quelques étapes, créez votre premier rendu 3D du relief. Pressé d’explorer ? La Galerie propose des scènes prêtes à l’emploi.',
        placement: 'center',
    },
    {
        id: 'capture',
        selector: '[data-tutorial="capture"]',
        title: '1 · Dessiner une zone',
        body: 'Le gros bouton vert ouvre la capture : le mode dessin est actif aussitôt, glissez sur la carte pour tracer le rectangle à capturer. Un nouveau glissement remplace le précédent. Le curseur « Qualité » règle le compromis détail / temps de calcul.',
        placement: 'left',
        reveal: 'capture',
    },
    {
        id: 'capture-modes',
        selector: '[data-tutorial="capture-modes"]',
        title: '2 · Choisir la reconstruction',
        body: 'Trois façons de reconstruire le terrain, du plus brut au plus sculpté :',
        lines: [
            'Points — le nuage brut, simplement ombré. Rapide et léger, pas de maillage 3D.',
            'Delaunay — maillage du sol, lisse et rapide. En 2.5D (une seule altitude par point au sol), il ne peut pas reconstruire les falaises verticales.',
            'Poisson — maillage 3D complet et détaillé, y compris les parois verticales. Le plus beau pour un rendu sculpté, mais le plus lent à calculer.',
        ],
        placement: 'left',
        reveal: 'capture',
    },
    {
        id: 'render-settings',
        selector: '[data-tutorial="render-settings"]',
        title: '3 · Sculpter le rendu',
        body: 'Ajustez l’apparence, la lumière, les ombres et l’effet de profondeur. Plusieurs sections peuvent rester dépliées en même temps — c’est ici que le relief prend tout son volume.',
        placement: 'left',
        reveal: 'render',
    },
    {
        id: 'orbit',
        selector: '[data-tutorial="orbit"]',
        title: '4 · Mettre en mouvement',
        body: 'Activez l’orbite pour faire tourner la vue automatiquement — idéal pour révéler le relief de façon cinématique. Vous pouvez aussi faire pivoter à la souris (clic droit / glisser).',
        placement: 'bottom',
        gesture: 'drag-orbit',
        reveal: 'camera',
    },
    {
        id: 'export',
        selector: '[data-tutorial="export"]',
        title: '5 · Garder votre vue',
        body: 'Une fois la vue à votre goût, exportez-la : enregistrez-la dans « Mes vues » ou téléchargez-la pour la partager.',
        placement: 'bottom',
        reveal: 'scene',
    },
    {
        id: 'gallery',
        selector: '[data-tutorial="gallery"]',
        title: '6 · Retrouver vos scènes',
        body: 'Ouvrez la Galerie pour rouvrir vos vues enregistrées et explorer les scènes de démonstration mises en avant — de quoi s’inspirer sans rien capturer.',
        placement: 'bottom',
        reveal: 'scene',
    },
];
