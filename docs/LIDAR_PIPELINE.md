# LiDAR HD data loading & processing pipeline

This document maps how a point cloud gets from the IGN LiDAR HD archive
into the WebGL overlay rendered on top of MapLibre.

Everything runs **entirely in the browser** using a Web Worker. COPC tiles
are decoded with `copc.js` + `laz-perf` (WASM). Two render modes are
supported:

- **`shaded`** — All points with k-NN computed normals, rendered with
  slope-based coloring and Eye-Dome Lighting
- **`mixed`** — Ground (class 2) as a Delaunay mesh, vegetation/buildings
  as shaded points, both rendered together for proper depth ordering

Both modes produce variants of `LidarShadedCloudData` so the overlay layer
handles them uniformly.

---

## 1. High-level overview

```mermaid
flowchart LR
    UI[LidarCloudPanel<br/>UI] -->|loadLidarCloud| Store[mapStore<br/>Zustand]
    Store --> IDX[lib/lidarBrowser/index.ts<br/>cache-first wrapper]
    IDX --> CACHE[(IndexedDB<br/>idb-keyval)]
    IDX --> WC[workerClient.ts]
    WC --> WK[worker.ts<br/>DedicatedWorker]
    WK --> PIPE[pipeline.ts<br/>fetchCommon + finalizers]
    PIPE --> WFS[wfs.ts]
    PIPE --> EXT[extract.ts<br/>COPC reader]
    WFS --> IGN[(data.geopf.fr<br/>COPC LAZ tiles)]
    EXT --> IGN
    PIPE --> FIN[mesh.ts / normals.ts / slope.ts]
    Store --> OV[LidarCloudOverlay<br/>LidarWebGLLayer]
    OV --> MAP[MapLibre canvas]
```

---

## 2. Common shared stage: `fetchCommon`

Both modes (`shaded`, `mixed`) share the same fetch-and-crop prelude.
It runs inside the worker.

```mermaid
flowchart TD
    P([BrowserFetchParams<br/>lng, lat, radius, stride, classes]) --> R[Clamp radius 20-1000m<br/>Clamp stride 1-200]
    R --> L93[proj.ts<br/>lng,lat → Lambert-93 x0,y0]
    L93 --> WFS[wfs.ts findTiles<br/>bbox query data.geopf.fr WFS]
    WFS -->|0 tiles| ERR([Throw 'no_lidar_tile'])
    WFS -->|N tiles| FAN[Promise.all over tiles]
    FAN --> EXT[extract.ts<br/>extractPoints per tile]
    EXT --> MERGE[concat Float32 positions<br/>+ Uint8 classifications]
    MERGE --> OUT([positions, classifications,<br/>pointCount, radius,<br/>centerLng, centerLat])
```

Notes:

- `radius` is the half-side of the L93 query square, not a circle radius.
- WFS bbox uses **lng/lat order** despite `srsname=EPSG:4326` — IGN
  quirk (see [wfs.ts](../src/lib/lidarBrowser/wfs.ts)).
- Positions are **METER_OFFSETS** (Float32 east/north/up) relative to
  the request center (centerLng/centerLat). This keeps Float32 precision
  workable for hundreds of meters of range.

---

## 3. Per-tile COPC decode (`extract.ts`)

A COPC tile is a 0.5–2 GB LAZ file with an octree index in its EVLR.
We HTTP-Range-fetch only the nodes that intersect our bbox.

```mermaid
flowchart TD
    T([tileUrl, x0, y0,<br/>radius, stride, classFilter]) --> G[Getter.create url<br/>+ semaphore + retry]
    G --> H[Copc.create<br/>reads LAS header + COPC VLR]
    H --> WALK[collectIntersectingNodes<br/>BFS over hierarchy pages]
    WALK --> NODES[List of CopcNode<br/>with key, offset, length]
    NODES --> PAR[Promise.all over nodes]
    PAR --> DEC[runOnLazPerf<br/>Copc.loadPointDataView]
    DEC --> FILT[Per-point loop:<br/>bbox crop, stride decimation,<br/>classification whitelist]
    FILT --> SUB[Subarray to actual kept count]
    SUB --> AGG[Concat node results]
    AGG --> OUT([positions Float32 + classifications Uint8<br/>in METER_OFFSETS])
```

### Throttle & retry on `data.geopf.fr` 429s

IGN rate-limits aggressive byte-range storms. The `get` wrapper handles
this transparently:

```mermaid
flowchart LR
    REQ([get begin, end]) --> SEM{inflight &lt; MAX_INFLIGHT?<br/>currently 2}
    SEM -->|no| WAIT[await queue slot]
    SEM -->|yes| FETCH[rawGet via copc.js]
    WAIT --> FETCH
    FETCH --> CHK{byteLength == expected?}
    CHK -->|yes| OK([return buffer])
    CHK -->|no| DEC[Decode body as UTF-8<br/>look for 429/503/'too many']
    DEC -->|retriable| BACK[Exponential backoff<br/>500/1000/2000/4000ms + jitter]
    BACK -->|attempt &lt; 5| FETCH
    DEC -->|not retriable| THROW([Throw with body snippet])
    BACK -->|attempt 5| THROW
```

- Up to **5 attempts**, total ≤ 7.5 s of backoff.
- Semaphore is per-tile (each `extractPoints` call). With 1–4 tiles,
  the effective global concurrency is `tiles × MAX_INFLIGHT`. If 429s
  persist, drop `MAX_INFLIGHT` further or hoist the semaphore to module
  scope.

---

## 4. Mode-specific finalization

After `fetchCommon`, the worker dispatches one of two finalizers.

```mermaid
flowchart TD
    F([fetchCommon output]) --> K{Mode}

    K -->|shaded| S[fetchLidarShaded]
    S --> S1[normals.ts<br/>computeNormalsKNN<br/>k=12, 2 iterations]
    S1 --> S2[slope.ts<br/>colorsFromNormals]
    S2 --> SO([LidarShadedCloudData<br/>+ normals + RGBA colors])

    K -->|mixed| M[fetchLidarMixed]
    M --> M1[Filter ground class=2]
    M1 --> M2[mesh.ts buildMesh<br/>2.5D Delaunator]
    M2 --> M3[Process non-ground as shaded]
    M3 --> MO([LidarMixedData<br/>mesh + shaded])
```

### Mesh rendering (mixed mode only)

The Delaunay mesh uses:
- **2.5D Delaunator** — Fast, preserves point detail, with edge-length
  filtering to remove long triangles at boundaries

---

## 5. Worker boundary (`workerClient` ↔ `worker`)

```mermaid
sequenceDiagram
    participant Store as mapStore.loadLidarCloud
    participant IDX as lib/lidarBrowser/index.ts
    participant Cache as IndexedDB cache
    participant WC as workerClient.ts
    participant WK as worker.ts
    participant PIPE as pipeline.ts

    Store->>IDX: fetchLidarShaded(params)
    IDX->>Cache: readCachedLidar('shaded', params)
    Cache-->>IDX: hit? return; miss? continue
    IDX->>WC: dispatch('shaded', params)
    WC->>WK: postMessage({id, kind, params})
    WK->>PIPE: fetchLidarShaded(paramsWithProgress)
    loop progress events
        PIPE-->>WK: onProgress(stage, detail)
        WK-->>WC: postMessage({id, type:'progress'})
        WC-->>Store: onProgress callback (UI updates)
    end
    PIPE-->>WK: LidarShadedCloudData (typed arrays)
    WK->>WK: collectTransferables(data)
    WK-->>WC: postMessage({id, ok, data}, [buffers])
    WC-->>IDX: resolve(data)
    IDX->>Cache: writeCachedLidar (fire-and-forget)
    IDX-->>Store: data
    Store->>Store: set({lidarShaded: data})
```

Key contracts:

- **Cloneable params only**: `workerClient.cleanParams` strips `signal`
  and `onProgress` (functions / AbortSignal don't survive
  `postMessage`). Cancellation is not currently propagated; the store
  handles races by "latest-wins".
- **Transferables**: every TypedArray buffer in the result is sent
  zero-copy. After `postMessage`, the worker's references are detached.
- **Progress**: streamed messages of shape
  `{ id, type: 'progress', progress: LidarProgress }` are de-multiplexed
  by request id.

---

## 6. IndexedDB cache (`cache.ts`)

```mermaid
flowchart LR
    P([params]) --> K[makeKey<br/>lidar:shaded:lng:lat:r:s:classes]
    K --> GET[idbGet]
    GET -->|hit| UNPACK[unpack ArrayBuffer<br/>→ Float32Array etc.]
    GET -->|miss| RUN[run worker pipeline]
    RUN --> PACK[pack typed arrays<br/>→ ArrayBuffer]
    PACK --> SET[idbSet]
    SET --> EV[evictIfNeeded<br/>soft LRU, 50 entries cap]
```

- Coordinates rounded to 4 decimals (~10 m) so small jitter still hits
  the cache.
- Eviction is best-effort, ordered by insertion (Chromium IDB key
  ordering).

---

## 7. From data to pixels

Once data is in the store, the overlay re-renders:

```mermaid
flowchart LR
    Store[mapStore.lidarShaded] --> OV[LidarCloudOverlay.tsx]
    OV --> LWG[LidarWebGLLayer<br/>custom GL with EDL + AO]
    LWG --> MAP[MapLibre custom layer]
```

The custom `LidarWebGLLayer` uses MapLibre's `mainMatrix` from
`args.defaultProjectionData` so points stay registered with the basemap
at any pitch/bearing/zoom. METER_OFFSETS are converted to Mercator in
the vertex shader using
`MercatorCoordinate.meterInMercatorCoordinateUnits()`.

---

## 8. Where to start when something breaks

| Symptom                                         | Likely culprit                                          |
|-------------------------------------------------|---------------------------------------------------------|
| `429 Too Many Requests` retries                 | Lower `MAX_INFLIGHT` in [extract.ts](../src/lib/lidarBrowser/extract.ts) |
| `Aucune dalle LiDAR HD` toast                   | WFS bbox; check `wfs.ts` (lng,lat order!)               |
| Points drift when pitching/panning              | `LidarWebGLLayer` shader matrix; check `mainMatrix` use |
| Worker silent / no progress                     | Check `workerClient.cleanParams` keeps required params  |
