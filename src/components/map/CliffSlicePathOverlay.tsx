import {
    extractPolylineSliceProfile,
    mergeSliceProfiles,
    meshAsSliceSource,
    traceLidarSurfacePathFromProfile,
    type SliceProfile,
    type SliceSource,
} from '@/lib/cliffSlice';
import { useMapStore } from '@/stores/mapStore';
import { PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { useEffect, useMemo, useRef } from 'react';

const SLICE_LINE_LAYER_ID = 'open-cairn-cliff-slice-path-3d';
const SLICE_CORRIDOR_LAYER_ID = 'open-cairn-cliff-slice-corridor-3d';
const SLICE_ENDPOINT_HALO_LAYER_ID = 'open-cairn-cliff-slice-endpoint-halo-3d';
const SLICE_ENDPOINT_LABEL_LAYER_ID = 'open-cairn-cliff-slice-endpoint-label-3d';
// Lift the ribbon above the cloud surface to clear z-fighting.
const Z_BIAS_METERS = 0.5;
// Bucket width along the polyline for the upper-envelope sampler. 0.5 m
// matches the LiDAR HD mean spacing.
const ENVELOPE_BUCKET_METERS = 0.5;
// Push markers a couple of metres above the ribbon so the halo disc isn't
// clipped by the rock face it sits against.
const MARKER_Z_BIAS_METERS = 2.5;

type LngLatZ = [number, number, number];

/**
 * Overlay that draws the cliff-slice polyline on the LiDAR surface via
 * deck.gl's PathLayer (interleaved with MapLibre's depth buffer so it shares
 * z with the LidarWebGLLayer).
 *
 * The 3D path is computed from **the same profile the bottom chart shows**:
 * `extractPolylineSliceProfile(cloud, …)` + `extractPolylineSliceProfile(
 * mesh, …)` merged via `mergeSliceProfiles`, with the user's exact
 * `cliffSliceCorridor` and class filter. We then run the upper envelope on
 * that merged profile (max z per d-bucket, smoothed) and reproject buckets
 * back onto the polyline. Since the chart proves the profile has coverage
 * end-to-end, the ribbon spans A→B as long as the chart does.
 *
 * On top of the centreline we draw a semi-transparent corridor band of the
 * same colour following the same z curve, and the A/B markers at the actual
 * ribbon endpoints (lifted slightly above the rock so the halos render
 * cleanly).
 */
export function CliffSlicePathOverlay() {
    const mapInstance = useMapStore((s) => s.mapInstance);
    const cliffSlicePoints = useMapStore((s) => s.cliffSlicePoints);
    const cliffSliceClasses = useMapStore((s) => s.cliffSliceClasses);
    const cliffSliceCorridor = useMapStore((s) => s.cliffSliceCorridor);
    const lidarShaded = useMapStore((s) => s.lidarShaded);
    const lidarMesh = useMapStore((s) => s.lidarMesh);

    const overlayRef = useRef<MapboxOverlay | null>(null);

    const filter = useMemo<ReadonlySet<number> | null>(
        () => (cliffSliceClasses.length > 0 ? new Set<number>(cliffSliceClasses) : null),
        [cliffSliceClasses],
    );

    const pathAndMarkers = useMemo<{ path: LngLatZ[]; markers: LngLatZ[] } | null>(() => {
        if (!mapInstance || cliffSlicePoints.length < 2) return null;
        const cloudSource: SliceSource | null = lidarShaded
            ? {
                centerLng: lidarShaded.centerLng,
                centerLat: lidarShaded.centerLat,
                positions: lidarShaded.positions,
                classifications: lidarShaded.classifications,
                pointCount: lidarShaded.pointCount,
            }
            : null;
        const meshSource: SliceSource | null =
            lidarMesh && (!filter || filter.has(2)) ? meshAsSliceSource(lidarMesh) : null;
        if (!cloudSource && !meshSource) return null;

        // Same dual-source merge as useCliffSliceProfile: ground is in the
        // mesh in delaunay/poisson modes, in the cloud otherwise. Using both
        // means the envelope sees every return the chart sees.
        const cloudProfile = cloudSource
            ? extractPolylineSliceProfile(cloudSource, cliffSlicePoints, cliffSliceCorridor, filter)
            : null;
        const meshProfile = meshSource
            ? extractPolylineSliceProfile(meshSource, cliffSlicePoints, cliffSliceCorridor, filter)
            : null;
        const profile: SliceProfile | null =
            cloudProfile && meshProfile ? mergeSliceProfiles(cloudProfile, meshProfile) : cloudProfile ?? meshProfile;
        if (!profile) return null;
        const ref = cloudSource ?? meshSource;
        if (!ref) return null;
        const samples = traceLidarSurfacePathFromProfile(
            profile,
            cliffSlicePoints,
            ref.centerLng,
            ref.centerLat,
            ENVELOPE_BUCKET_METERS,
        );
        if (samples.length < 2) return null;
        const path: LngLatZ[] = samples.map((s) => [s.lng, s.lat, s.z + Z_BIAS_METERS]);
        // Markers for every polyline vertex (A, B, C, …). Head/tail re-use
        // the path's anchor z so the disc sits exactly on the ribbon end;
        // intermediate vertices fall back to the terrain DEM at their click
        // location, which is the same elevation MapLibre projected the
        // click onto, so the disc lands where the user clicked.
        const queryZ = (lng: number, lat: number): number | null => {
            const e = mapInstance.queryTerrainElevation([lng, lat] as [number, number]);
            return typeof e === 'number' && Number.isFinite(e) ? e : null;
        };
        const markers: LngLatZ[] = cliffSlicePoints.map((pt, i) => {
            if (i === 0) return [path[0][0], path[0][1], path[0][2]];
            if (i === cliffSlicePoints.length - 1) {
                const last = path.at(-1) ?? path[0];
                return [last[0], last[1], last[2]];
            }
            const z = queryZ(pt[0], pt[1]);
            return [pt[0], pt[1], (z ?? path[0][2]) + Z_BIAS_METERS];
        });
        return { path, markers };
    }, [mapInstance, lidarShaded, lidarMesh, cliffSlicePoints, cliffSliceCorridor, filter]);

    useEffect(() => {
        if (!mapInstance) return undefined;
        const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
        mapInstance.addControl(overlay);
        overlayRef.current = overlay;
        return () => {
            try { mapInstance.removeControl(overlay); } catch { /* map gone */ }
            overlayRef.current = null;
        };
    }, [mapInstance]);

    useEffect(() => {
        const overlay = overlayRef.current;
        if (!overlay) return;
        if (!pathAndMarkers) {
            overlay.setProps({ layers: [] });
            return;
        }
        const { path, markers } = pathAndMarkers;
        // One halo + label per polyline vertex, labelled A, B, C, ….
        const endpoints = markers.map((pos, i) => ({
            role: String.fromCodePoint(65 + i),
            position: [pos[0], pos[1], pos[2] + MARKER_Z_BIAS_METERS] as LngLatZ,
        }));
        const corridorWidthMeters = Math.max(0.5, cliffSliceCorridor * 2);
        // The cliff cloud's per-fragment depth (MRT in LidarWebGLLayer) wins
        // the z-test against the line bucket-by-bucket where micro-relief
        // bulges in front of it, which looks like a dashed/"hachée" stroke.
        // Routes do the same trick: disable depth test on the overlay so the
        // line and corridor always draw on top.
        const alwaysOnTop = { depthCompare: 'always' as const };
        overlay.setProps({
            layers: [
                // Semi-transparent corridor band, drawn first so it sits
                // under the centreline. Width is in meters so it matches the
                // user-set ±halfCorridor exactly.
                new PathLayer<{ path: LngLatZ[] }>({
                    id: SLICE_CORRIDOR_LAYER_ID,
                    data: [{ path }],
                    getPath: (d) => d.path,
                    getColor: [56, 189, 248, 60], // sky-400 @ ~24%
                    getWidth: corridorWidthMeters,
                    widthUnits: 'meters',
                    widthMinPixels: 6,
                    capRounded: true,
                    jointRounded: true,
                    parameters: alwaysOnTop,
                }),
                new PathLayer<{ path: LngLatZ[] }>({
                    id: SLICE_LINE_LAYER_ID,
                    data: [{ path }],
                    getPath: (d) => d.path,
                    getColor: [56, 189, 248, 255], // sky-400
                    getWidth: 3,
                    widthUnits: 'pixels',
                    capRounded: true,
                    jointRounded: true,
                    parameters: alwaysOnTop,
                }),
                // Disc + label for every polyline vertex. `billboard:true` so
                // the disc faces the camera regardless of pitch (otherwise
                // it lies flat in world space and disappears edge-on).
                // `lineWidthUnits:'pixels'` so the blue ring stays 2 px at
                // every zoom level instead of growing in metres.
                new ScatterplotLayer<{ role: string; position: LngLatZ }>({
                    id: SLICE_ENDPOINT_HALO_LAYER_ID,
                    data: endpoints,
                    getPosition: (d) => d.position,
                    getRadius: 8,
                    radiusUnits: 'pixels',
                    radiusMinPixels: 8,
                    radiusMaxPixels: 8,
                    filled: true,
                    stroked: true,
                    billboard: true,
                    getFillColor: [248, 250, 252, 255], // slate-50
                    getLineColor: [2, 132, 199, 255], // sky-700
                    lineWidthUnits: 'pixels',
                    getLineWidth: 2,
                    lineWidthMinPixels: 2,
                    lineWidthMaxPixels: 2,
                    parameters: alwaysOnTop,
                }),
                new TextLayer<{ role: string; position: LngLatZ }>({
                    id: SLICE_ENDPOINT_LABEL_LAYER_ID,
                    data: endpoints,
                    getPosition: (d) => d.position,
                    getText: (d) => d.role,
                    getSize: 12,
                    getColor: [2, 132, 199, 255], // sky-700
                    fontFamily: 'sans-serif',
                    fontWeight: 700,
                    getTextAnchor: 'middle',
                    getAlignmentBaseline: 'center',
                    billboard: true,
                    parameters: alwaysOnTop,
                }),
            ],
        });
    }, [pathAndMarkers, cliffSliceCorridor]);

    return null;
}
