/**
 * WebGL2 GLSL programs for the LiDAR point-cloud layer.
 *
 * The shader sources live as standalone `.vert`/`.frag` files under ./glsl/
 * (native GLSL syntax highlighting, `#include` for shared chunks). They are
 * imported as strings via vite-plugin-glsl. This module only re-exports those
 * strings and provides the compile/link helpers (no DOM).
 */

import FS_EDL from './glsl/edl.frag';
import FS_MESH from './glsl/mesh.frag';
import VS_MESH from './glsl/mesh.vert';
import FS_POINTS from './glsl/points.frag';
import VS_POINTS from './glsl/points.vert';
import VS_QUAD from './glsl/quad.vert';
import FS_SHADOW from './glsl/shadow.frag';
import VS_SHADOW from './glsl/shadow.vert';

export { FS_EDL, FS_MESH, FS_POINTS, FS_SHADOW, VS_MESH, VS_POINTS, VS_QUAD, VS_SHADOW };

function compileShader(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
    const s = gl.createShader(type);
    if (!s) throw new Error('createShader failed');
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(s) ?? 'unknown';
        gl.deleteShader(s);
        throw new Error(`Shader compile:\n${info}`);
    }
    return s;
}

export function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
    const v = compileShader(gl, gl.VERTEX_SHADER, vs);
    const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram failed');
    gl.attachShader(prog, v);
    gl.attachShader(prog, f);
    gl.linkProgram(prog);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`Program link:\n${gl.getProgramInfoLog(prog)}`);
    }
    return prog;
}
