/**
 * MultiplyBlendLayer — a MapLibre Custom Layer that fetches WMTS raster tiles
 * (e.g. the IGN LiDAR HD shadow) and renders them with a true GPU `multiply`
 * blend mode against whatever has already been drawn (the SCAN 25 base layer).
 *
 * MapLibre GL JS does not expose any layer-to-layer blend mode beyond alpha
 * compositing (issue maplibre/maplibre-gl-js#48). This layer works around that
 * limitation by:
 *
 *  1. Owning its own tile cache (independent of the map's RasterTileSource), so
 *     we don't have to dig into private internals to get the texture data.
 *  2. Drawing each visible tile as a textured quad in mercator coordinates,
 *     using the projection matrix MapLibre passes to custom layers — which
 *     already accounts for the 3D terrain (`renderingMode: '3d'`).
 *  3. Setting `gl.blendFunc(gl.DST_COLOR, gl.ZERO)` so the fragment colour is
 *     multiplied with the framebuffer (Cdst' = Csrc * Cdst). Partial intensity
 *     is implemented in the shader via `mix(vec3(1.0), shadow.rgb, intensity)`,
 *     so intensity = 0 yields pure white (no-op) and intensity = 1 yields the
 *     full shadow.
 *
 * Inspired by the open-dronelog `FlightPath3DLayer` pattern referenced in
 * `ANALYSIS.md` §4.3.
 */

import maplibregl from 'maplibre-gl';

interface CachedTile {
  z: number;
  x: number;
  y: number;
  texture: WebGLTexture | null;
  loaded: boolean;
  failed: boolean;
}

const VERTEX_SRC = `
attribute vec2 a_pos;        // mercator coordinates in [0, 1]
attribute vec2 a_uv;          // tile UVs in [0, 1]
uniform mat4 u_matrix;
varying vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SRC = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_intensity;     // 0 = no shadow, 1 = full shadow
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_texture, v_uv);
  // The shadow tile is grayscale; lerp from white (no effect) to its colour.
  vec3 col = mix(vec3(1.0), c.rgb, u_intensity);
  gl_FragColor = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${log}`);
  }
  return sh;
}

function createProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

/** Convert a tile (z, x, y) into the lng/lat of its NW corner (XYZ scheme). */
function tileToLngLat(z: number, x: number, y: number): [number, number] {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return [lng, lat];
}

export class MultiplyBlendLayer implements maplibregl.CustomLayerInterface {
  public id: string;
  public type = 'custom' as const;
  public renderingMode = '3d' as const;

  private sourceId: string;
  private map: maplibregl.Map | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;

  private program: WebGLProgram | null = null;
  private aPos = -1;
  private aUv = -1;
  private uMatrix: WebGLUniformLocation | null = null;
  private uTexture: WebGLUniformLocation | null = null;
  private uIntensity: WebGLUniformLocation | null = null;

  private quadBuffer: WebGLBuffer | null = null;

  private intensity = 0.85;
  private maxTileZoom = 17;
  private minTileZoom = 4;

  private tiles = new Map<string, CachedTile>();

  constructor(id: string, sourceId: string) {
    this.id = id;
    this.sourceId = sourceId;
  }

  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.gl = gl;
    this.program = createProgram(gl, VERTEX_SRC, FRAGMENT_SRC);
    this.aPos = gl.getAttribLocation(this.program, 'a_pos');
    this.aUv = gl.getAttribLocation(this.program, 'a_uv');
    this.uMatrix = gl.getUniformLocation(this.program, 'u_matrix');
    this.uTexture = gl.getUniformLocation(this.program, 'u_texture');
    this.uIntensity = gl.getUniformLocation(this.program, 'u_intensity');

    // A unit quad covering [0,1]² in mercator coordinates, with matching UVs.
    // Each vertex: x, y, u, v.
    const quad = new Float32Array([
      0, 0, 0, 0,
      1, 0, 1, 0,
      0, 1, 0, 1,
      0, 1, 0, 1,
      1, 0, 1, 0,
      1, 1, 1, 1,
    ]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  }

  onRemove(): void {
    const gl = this.gl;
    if (gl) {
      this.tiles.forEach((t) => {
        if (t.texture) gl.deleteTexture(t.texture);
      });
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.program) gl.deleteProgram(this.program);
    }
    this.tiles.clear();
    this.program = null;
    this.quadBuffer = null;
    this.gl = null;
    this.map = null;
  }

  /**
   * Compute the list of XYZ tiles intersecting the current viewport at an
   * appropriate zoom level. We approximate using `map.getBounds()`; this is
   * good enough for an overlay that blends with the visible base.
   */
  private visibleTiles(map: maplibregl.Map): Array<{ z: number; x: number; y: number }> {
    const z = Math.max(this.minTileZoom, Math.min(this.maxTileZoom, Math.floor(map.getZoom())));
    const bounds = map.getBounds();
    const n = 2 ** z;
    const lon2tile = (lng: number) => Math.floor(((lng + 180) / 360) * n);
    const lat2tile = (lat: number) => {
      const r = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    };
    const xMin = Math.max(0, lon2tile(bounds.getWest()));
    const xMax = Math.min(n - 1, lon2tile(bounds.getEast()));
    const yMin = Math.max(0, lat2tile(bounds.getNorth()));
    const yMax = Math.min(n - 1, lat2tile(bounds.getSouth()));
    const tiles: Array<{ z: number; x: number; y: number }> = [];
    // Cap how many tiles we request in one frame to avoid runaway loads when
    // the user zooms out very far.
    const MAX_TILES = 96;
    for (let x = xMin; x <= xMax && tiles.length < MAX_TILES; x++) {
      for (let y = yMin; y <= yMax && tiles.length < MAX_TILES; y++) {
        tiles.push({ z, x, y });
      }
    }
    return tiles;
  }

  /** Fetch the tile image and upload it as a GL texture. */
  private loadTile(t: CachedTile): void {
    const map = this.map;
    const gl = this.gl;
    if (!map || !gl) return;
    // Resolve the tile URL via the style source spec we registered.
    const style = map.getStyle();
    const source = style?.sources?.[this.sourceId] as
      | { tiles?: string[] }
      | undefined;
    const template = source?.tiles?.[0];
    if (!template) {
      t.failed = true;
      return;
    }
    const url = template
      .replace('{z}', String(t.z))
      .replace('{x}', String(t.x))
      .replace('{y}', String(t.y));

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = gl.createTexture();
      if (!tex) {
        t.failed = true;
        return;
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      t.texture = tex;
      t.loaded = true;
      map.triggerRepaint();
    };
    img.onerror = () => {
      t.failed = true;
    };
    img.src = url;
  }

  /** Evict tiles outside the current view to keep memory bounded. */
  private evictTiles(visible: Array<{ z: number; x: number; y: number }>): void {
    const gl = this.gl;
    if (!gl) return;
    const keep = new Set(visible.map((t) => `${t.z}/${t.x}/${t.y}`));
    // Keep at most 256 tiles in cache; drop those not visible first.
    if (this.tiles.size <= 256) return;
    for (const [k, tile] of this.tiles) {
      if (keep.has(k)) continue;
      if (tile.texture) gl.deleteTexture(tile.texture);
      this.tiles.delete(k);
      if (this.tiles.size <= 200) break;
    }
  }

  render(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: unknown,
  ): void {
    // MapLibre v5 passes an options object (not a raw matrix). v4 used to pass
    // a raw matrix as the 2nd argument, so support both.
    let matrix: Float32Array | number[] | null = null;
    if (options instanceof Float32Array || Array.isArray(options)) {
      matrix = options as Float32Array | number[];
    } else if (options && typeof options === 'object') {
      const o = options as {
        defaultProjectionData?: { mainMatrix?: Float32Array | number[] };
        modelViewProjectionMatrix?: Float32Array | number[];
      };
      matrix =
        o.defaultProjectionData?.mainMatrix ??
        o.modelViewProjectionMatrix ??
        null;
    }
    const map = this.map;
    if (!map || !this.program || !this.quadBuffer || !matrix) return;

    const visible = this.visibleTiles(map);

    // Make sure all visible tiles are loading or loaded.
    for (const v of visible) {
      const k = `${v.z}/${v.x}/${v.y}`;
      let t = this.tiles.get(k);
      if (!t) {
        t = { z: v.z, x: v.x, y: v.y, texture: null, loaded: false, failed: false };
        this.tiles.set(k, t);
        this.loadTile(t);
      }
    }
    this.evictTiles(visible);

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 16, 8);

    gl.uniform1f(this.uIntensity, this.intensity);
    gl.uniform1i(this.uTexture, 0);
    gl.activeTexture(gl.TEXTURE0);

    // Multiply blending: out = src * dst, no alpha.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    const m = matrix;

    for (const v of visible) {
      const k = `${v.z}/${v.x}/${v.y}`;
      const t = this.tiles.get(k);
      if (!t || !t.loaded || !t.texture) continue;

      // Mercator-coordinate corners of this tile (origin top-left, [0,1] range).
      const [lng0, lat0] = tileToLngLat(v.z, v.x, v.y);
      const [lng1, lat1] = tileToLngLat(v.z, v.x + 1, v.y + 1);
      const nw = maplibregl.MercatorCoordinate.fromLngLat([lng0, lat0]);
      const se = maplibregl.MercatorCoordinate.fromLngLat([lng1, lat1]);

      // Build a per-tile model matrix: translate by (nw.x, nw.y), scale by
      // (se.x - nw.x, se.y - nw.y) → maps the unit quad to the tile extent.
      const sx = se.x - nw.x;
      const sy = se.y - nw.y;
      const tx = nw.x;
      const ty = nw.y;

      // Compose: u_matrix = matrix * translate(tx,ty) * scale(sx,sy).
      // We unroll a 4x4 column-major multiplication for speed.
      const mvp = new Float32Array(16);
      // Load matrix into columns m0..m3
      // Column 0
      mvp[0] = m[0] * sx;
      mvp[1] = m[1] * sx;
      mvp[2] = m[2] * sx;
      mvp[3] = m[3] * sx;
      // Column 1
      mvp[4] = m[4] * sy;
      mvp[5] = m[5] * sy;
      mvp[6] = m[6] * sy;
      mvp[7] = m[7] * sy;
      // Column 2 (unchanged)
      mvp[8] = m[8];
      mvp[9] = m[9];
      mvp[10] = m[10];
      mvp[11] = m[11];
      // Column 3: matrix * (tx, ty, 0, 1)
      mvp[12] = m[0] * tx + m[4] * ty + m[12];
      mvp[13] = m[1] * tx + m[5] * ty + m[13];
      mvp[14] = m[2] * tx + m[6] * ty + m[14];
      mvp[15] = m[3] * tx + m[7] * ty + m[15];

      gl.uniformMatrix4fv(this.uMatrix, false, mvp);
      gl.bindTexture(gl.TEXTURE_2D, t.texture);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}
