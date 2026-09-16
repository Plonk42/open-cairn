/**
 * Mounts one {@link SkyBodyLayer} per body — the sun and the moon — and keeps
 * them fed.
 *
 * Two independent inputs:
 *   - the DAY's track, rebuilt only when the date or the site moves;
 *   - the disc.
 *
 * The SUN's disc follows the *effective* light (`lidarSunAzimuth` /
 * `lidarSunElevation`), not the date. Same rule as the panel's read-out: if the
 * user forces the lighting, seeing the disc leave the track is the useful
 * signal, not a bug. The MOON's disc has no such override: it follows the date,
 * which is also what its phase is computed from.
 */

import {
    MOON_PALETTE,
    SkyBodyLayer,
    SUN_PALETTE,
    type SkyBodyDisc,
    type SkyBodyPalette,
} from '@/components/map/SkyBodyLayer';
import { applyWhenStyleReady } from '@/components/map/styleReady';
import { brightLimbDirection, moonState } from '@/lib/moon';
import {
    buildSkyPathGeometry,
    clockParts,
    moonSampleAt,
    sampleSkyPath,
    sunSampleAt,
    SUN_ANGULAR_RADIUS_DEG,
    type SkySampleAt,
} from '@/lib/skyPath';
import { apparentSunPosition, parseSunDate, sunDirectionVector } from '@/lib/sun';
import { useMapStore } from '@/stores/mapStore';
import { useEffect, useRef, useState, type RefObject } from 'react';

const DEG = Math.PI / 180;

/** One mounted layer, plus the counter that survives a style rebuild. */
function useBodyLayer(id: string, palette: SkyBodyPalette, enabled: boolean) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const layerRef = useRef<SkyBodyLayer | null>(null);
    // MapLibre drops custom layers on every style rebuild, so the layer is
    // re-added and the buffers re-pushed against this counter.
    const [epoch, setEpoch] = useState(0);

    useEffect(() => {
        const map = mapInstance;
        if (!map || !enabled) return undefined;

        const ensureLayer = () => {
            if (map.getLayer(id)) return;
            const layer = new SkyBodyLayer(id, palette);
            // No `beforeId`: the track must be composited last, on top of the
            // terrain and of the LiDAR mesh whose depth it tests against.
            map.addLayer(layer);
            layerRef.current = layer;
            setEpoch((e) => e + 1);
        };
        const cancel = applyWhenStyleReady(map, ensureLayer);

        return () => {
            cancel();
            try { map.removeLayer(id); } catch { /* map or style already gone */ }
            layerRef.current = null;
        };
    }, [mapInstance, enabled, id, palette]);

    return { layerRef, epoch };
}

/** Push a day's track into a layer whenever the date or the site moves. */
function useTrack(
    layerRef: RefObject<SkyBodyLayer | null>,
    epoch: number,
    sampleAt: SkySampleAt,
    deps: readonly unknown[],
) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        const { track, ticks } = buildSkyPathGeometry(sampleSkyPath(sampleAt));
        layer.setGeometry(track, ticks);
        mapInstance?.triggerRepaint();
        // `sampleAt` is a fresh closure on every render; the caller lists what
        // it actually closes over instead.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapInstance, layerRef, epoch, ...deps]);
}

function useDisc(layerRef: RefObject<SkyBodyLayer | null>, epoch: number, disc: SkyBodyDisc) {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const { dir, radiusDeg, illuminatedFraction, limbDir } = disc;
    useEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;
        layer.setDisc({ dir, radiusDeg, illuminatedFraction, limbDir });
        mapInstance?.triggerRepaint();
        // Same reason: `disc` is rebuilt every render, its numbers are not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapInstance, layerRef, epoch, ...dir, radiusDeg, illuminatedFraction, ...limbDir]);
}

/** The moon as the layer wants it: direction, size, phase and lit limb. */
function moonDisc(datePart: string, minutesOfDay: number, lat: number, lng: number): SkyBodyDisc {
    const { h, m, s } = clockParts(minutesOfDay);
    const date = new Date(`${datePart}T${h}:${m}:${s}`);
    const state = moonState(date, lat, lng);
    const dir = sunDirectionVector(state.position);
    return {
        dir,
        radiusDeg: state.angularRadiusDeg,
        illuminatedFraction: state.illuminatedFraction,
        // The REAL sun, not the possibly-forced light: a crescent points where
        // the sun actually is, and faking that would be misinformation.
        limbDir: brightLimbDirection(dir, sunDirectionVector(apparentSunPosition(date, lat, lng))),
    };
}

export function SkyBodiesOverlay() {
    const enabled = useMapStore((s) => s.lidarSunPath);
    const sunDate = useMapStore((s) => s.lidarSunDate);
    const azimuthDeg = useMapStore((s) => s.lidarSunAzimuth);
    const elevationDeg = useMapStore((s) => s.lidarSunElevation);
    // Same site the lighting is computed for (see `sunStateFor`): the cloud's
    // centre when one is loaded, the map centre otherwise.
    const lng = useMapStore((s) => s.lidarShaded?.centerLng ?? s.lidarMesh?.centerLng ?? s.view.longitude);
    const lat = useMapStore((s) => s.lidarShaded?.centerLat ?? s.lidarMesh?.centerLat ?? s.view.latitude);

    const { datePart, minutesOfDay } = parseSunDate(sunDate);
    const sun = useBodyLayer('open-cairn-sun-path', SUN_PALETTE, enabled);
    const moon = useBodyLayer('open-cairn-moon-path', MOON_PALETTE, enabled);
    const site = [datePart, lat, lng] as const;

    useTrack(sun.layerRef, sun.epoch, (t) => sunSampleAt(datePart, t, lat, lng), site);
    useTrack(moon.layerRef, moon.epoch, (t) => moonSampleAt(datePart, t, lat, lng), site);

    useDisc(sun.layerRef, sun.epoch, {
        dir: sunDirectionVector({ azimuth: azimuthDeg * DEG, elevation: elevationDeg * DEG }),
        radiusDeg: SUN_ANGULAR_RADIUS_DEG,
        illuminatedFraction: 1,
        limbDir: [0, 0, 1],
    });
    useDisc(moon.layerRef, moon.epoch, moonDisc(datePart, minutesOfDay, lat, lng));

    return null;
}
