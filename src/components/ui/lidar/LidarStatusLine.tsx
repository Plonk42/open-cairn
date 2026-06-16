import type { LidarMeshData, LidarShadedCloudData } from '@/lib/lidarCloud';

/** One-line summary of the currently-loaded cloud/mesh (triangles, points, radius). */
export function LidarStatusLine({
    shaded,
    mesh,
    radius,
}: Readonly<{
    shaded: LidarShadedCloudData | null;
    mesh: LidarMeshData | null;
    radius: number;
}>) {
    const meshLabel = mesh ? ` ${mesh.triangleCount.toLocaleString('fr-FR')} tri` : '';
    const sep = mesh && shaded ? ' +' : '';
    const shadedLabel = shaded ? ` ${shaded.pointCount.toLocaleString('fr-FR')} pts` : '';
    return (
        <p className="text-xs text-slate-500 dark:text-slate-400">
            ✓{meshLabel}{sep}{shadedLabel} · rayon {radius} m
        </p>
    );
}
