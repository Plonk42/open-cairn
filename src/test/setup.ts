import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement URL.createObjectURL / revokeObjectURL, which
// maplibre-gl calls at import time (worker bootstrap). Stub them so modules
// that transitively import the map store can be unit-tested.
if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:stub';
}
if (typeof URL.revokeObjectURL !== 'function') {
    URL.revokeObjectURL = () => undefined;
}
