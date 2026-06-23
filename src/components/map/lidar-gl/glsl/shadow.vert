#version 300 es
// Depth-only shadow pass: project mesh vertices into the sun's ortho view.
// The framebuffer attaches only a depth texture; we sample it later with PCF.
precision highp float;
layout(location = 0) in vec3 a_pos;
uniform mat4 u_lightMatrix;
void main() {
    gl_Position = u_lightMatrix * vec4(a_pos, 1.0);
}
