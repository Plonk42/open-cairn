/**
 * Progress reporting for the browser LiDAR pipeline.
 */

export type LidarProgressStage =
    | 'wfs'       // Querying WFS for tile URLs
    | 'tiles'     // Downloading and decoding COPC tiles
    | 'normals'   // Computing k-NN normals
    | 'mesh'      // Building Delaunay mesh
    | 'colors'    // Computing slope colors
    | 'forest'    // Typing vegetation from BD Forêt
    | 'done';     // Finished

export interface LidarProgress {
    stage: LidarProgressStage;
    /** Human-readable message for the current stage. */
    message: string;
    /** Progress within the current stage (0-1), if known. */
    progress?: number;
    /** Additional details (e.g., tile count, point count). */
    detail?: string;
}

export type ProgressCallback = (progress: LidarProgress) => void;

/** No-op callback for when progress isn't needed. */
export const noopProgress: ProgressCallback = () => { };

/** Stage labels in French. */
export const STAGE_LABELS: Record<LidarProgressStage, string> = {
    wfs: 'Recherche des dalles…',
    tiles: 'Téléchargement et décodage…',
    normals: 'Calcul des normales…',
    mesh: 'Construction du maillage…',
    colors: 'Calcul des couleurs…',
    forest: 'Typage de la végétation…',
    done: 'Terminé',
};
