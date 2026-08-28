/**
 * Shared GPS coordinate display formatting (decimal / DMS / DDM), used by the
 * desktop `CursorCoordinates` widget and the mobile coordinate-picker tool so
 * both stay in sync.
 */

export type CoordFormat = 'dec' | 'dms' | 'ddm';

export const COORD_FORMAT_LABELS: Record<CoordFormat, string> = {
    dec: 'Décimal',
    dms: 'DMS',
    ddm: 'DDM',
};

function formatDecimal(value: number): string {
    return value.toFixed(5);
}

function formatDMS(value: number, isLat: boolean): string {
    let hemi: string;
    if (isLat) hemi = value >= 0 ? 'N' : 'S';
    else hemi = value >= 0 ? 'E' : 'O';
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minF = (abs - deg) * 60;
    const min = Math.floor(minF);
    const sec = (minF - min) * 60;
    return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1)}"${hemi}`;
}

function formatDDM(value: number, isLat: boolean): string {
    let hemi: string;
    if (isLat) hemi = value >= 0 ? 'N' : 'S';
    else hemi = value >= 0 ? 'E' : 'O';
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const min = (abs - deg) * 60;
    return `${deg}°${min.toFixed(3)}'${hemi}`;
}

export function formatCoordByMode(mode: CoordFormat, lat: number, lng: number): string {
    switch (mode) {
        case 'dms':
            return `${formatDMS(lat, true)} ${formatDMS(lng, false)}`;
        case 'ddm':
            return `${formatDDM(lat, true)} ${formatDDM(lng, false)}`;
        default:
            return `${formatDecimal(lat)}, ${formatDecimal(lng)}`;
    }
}
