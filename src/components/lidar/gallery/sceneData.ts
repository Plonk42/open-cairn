import { applyAmbiance } from '@/lib/showcaseAmbiance';
import {
    fetchShowcaseManifest,
    showcaseScenePaths,
    type ShowcaseCamera,
    type ShowcaseManifest,
    type ShowcaseScene,
} from '@/lib/showcaseScene';
import { useMapStore } from '@/stores/mapStore';
import type maplibregl from 'maplibre-gl';

const INDEX_URL = `${import.meta.env.BASE_URL}showcase/index.json`;

/** A gallery card: scene id + its loaded manifest + resolved asset URLs. */
export interface GalleryEntry {
    id: string;
    title: string;
    description?: string;
    thumbUrl: string;
    geometryUrl: string;
    manifest: ShowcaseManifest;
}

function resolveUrl(ref: string): string {
    if (/^https?:\/\//.test(ref) || ref.startsWith('/')) return ref;
    return `${import.meta.env.BASE_URL}${ref}`;
}

/** Keep only non-empty string ids; warn about the rest. */
function sanitizeIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const ids: string[] = [];
    for (const item of raw) {
        if (typeof item === 'string' && item.length > 0) ids.push(item);
        else console.warn('showcase: entrée ignorée (id attendu)', item);
    }
    return ids;
}

/** Resolve one scene id to a gallery card by loading its sidecar manifest. */
async function buildEntry(id: string): Promise<GalleryEntry> {
    const paths = showcaseScenePaths(id);
    const manifest = await fetchShowcaseManifest(resolveUrl(paths.manifest));
    return {
        id,
        title: manifest.title || id,
        description: manifest.description,
        thumbUrl: resolveUrl(paths.thumb),
        geometryUrl: resolveUrl(paths.geometry),
        manifest,
    };
}

/**
 * Load the gallery: fetch the id list from `index.json`, then each scene's
 * manifest in parallel. Scenes whose manifest fails to load are skipped.
 */
export async function loadGalleryEntries(): Promise<GalleryEntry[]> {
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`Galerie indisponible (${res.status})`);
    const data = (await res.json()) as { scenes?: unknown };
    const ids = sanitizeIds(data.scenes);
    const settled = await Promise.allSettled(ids.map(buildEntry));
    const entries: GalleryEntry[] = [];
    for (const r of settled) {
        if (r.status === 'fulfilled') entries.push(r.value);
        else console.warn('showcase: scène ignorée', r.reason);
    }
    return entries;
}

export function applyScene(scene: ShowcaseScene) {
    applyAmbiance(scene.ambiance);
    const st = useMapStore.getState();
    st.addLidarCloudSnapshot(
        { shaded: scene.shaded, mesh: scene.mesh },
        { mode: scene.mesh ? 'poisson' : 'shaded', sourceSceneId: scene.id },
    );
    // A scene may bundle several clouds (all the ones that were displayed at
    // export time) — restore each one alongside the primary so the whole view
    // comes back in a single click.
    for (const cloud of scene.extraClouds ?? []) {
        st.addLidarCloudSnapshot(
            { shaded: cloud.shaded, mesh: cloud.mesh },
            { mode: cloud.mesh ? 'poisson' : 'shaded', sourceSceneId: scene.id },
        );
    }
    const map = st.mapInstance;
    if (map) {
        flyToScene(map, scene.camera);
    }
}

/**
 * Fly to the scene's saved camera, correctly framed over 3D terrain.
 *
 * With terrain on, `flyTo` carries over the *start* center elevation and never
 * recomputes it for the destination, so the camera target ends up above/below
 * the relief and the cloud isn't framed. Pre-seeding the destination's center
 * elevation *before* the flight makes `flyTo` retain it and land perfectly
 * synced — the elevation is set at the very start of the motion, so it blends
 * into the flight instead of snapping at the end.
 *
 * (`freezeElevation`, the "official" flyTo option for this, hangs the animation
 * for non-trivial moves; syncing elevation every frame breaks the flight; and a
 * post-flight `setCenterElevation` + `jumpTo` produces a visible jump.)
 */
function flyToScene(map: maplibregl.Map, camera: ShowcaseCamera) {
    const target = {
        center: camera.center,
        zoom: camera.zoom,
        pitch: camera.pitch,
        bearing: camera.bearing,
    };
    const hasTerrain = Boolean(map.getTerrain());

    if (hasTerrain && typeof camera.centerElevation === 'number' && Number.isFinite(camera.centerElevation)) {
        map.setCenterElevation(camera.centerElevation);
        map.flyTo({ ...target, duration: 1400, essential: true });
        return;
    }

    map.flyTo({ ...target, duration: 1400, essential: true });

    // Fallback for scenes saved without a stored center elevation: once the
    // flight settles and destination terrain has loaded, sync to the relief if
    // the elevation drifted.
    if (!hasTerrain) return;
    map.once('moveend', () => {
        const elevation = map.queryTerrainElevation(map.getCenter());
        if (typeof elevation !== 'number' || !Number.isFinite(elevation)) return;
        if (Math.abs(map.getCenterElevation() - elevation) < 1) return;
        map.setCenterElevation(elevation);
        map.jumpTo(target);
    });
}
