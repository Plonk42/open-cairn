---
description: "Use when editing LiDAR shaders or the terrain palette."
applyTo: "src/components/map/**/*.glsl, src/components/map/**/*.vert, src/components/map/**/*.frag, src/lib/lidarBrowser/slope.ts"
---
# Shaders and palette

- The palette exists twice: `glsl/lib/palette.glsl` renders it, `slope.ts` `vertexColor` is its only
  executable specification (tested). Change a ramp or threshold in both.
- `atan(0.0, 0.0)` is undefined in GLSL where `Math.atan2(0, 0)` is 0: guard a flat normal.
- No `dFdx`/`dFdy` inside a divergent branch; sample on a result, never select between samplers.
- No gate compiles GLSL. Without a capture, compile and link `shaders.ts` in a throwaway WebGL2
  canvas from `page.evaluate` and check `getUniformLocation` on new uniforms (see the
  `verify-in-browser` skill).
