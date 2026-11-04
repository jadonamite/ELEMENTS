/**
 * GLSL shared by the bending effects: value noise, fbm, and one shading routine per element
 * look. Modes: 0 fire, 1 hush fire, 2 water spray, 3 rock dust, 4 wind, 5 smoke, 6 mist, 7 dust.
 */

export const NOISE_GLSL = /* glsl */ `
float fxHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float fxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fxHash(i);
  float b = fxHash(i + vec2(1.0, 0.0));
  float c = fxHash(i + vec2(0.0, 1.0));
  float d = fxHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fxFbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * fxNoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    amp *= 0.5;
  }
  return v;
}
`;

export const RAMP_GLSL = /* glsl */ `
vec3 fxFireRamp(float h, int mode) {
  vec3 a = vec3(0.42, 0.02, 0.0);
  vec3 b = vec3(0.95, 0.24, 0.02);
  vec3 c = vec3(1.0, 0.56, 0.10);
  vec3 d = vec3(1.0, 0.88, 0.55);
  if (mode == 1) {
    a = vec3(0.22, 0.02, 0.40);
    b = vec3(0.58, 0.16, 1.0);
    c = vec3(0.86, 0.58, 1.0);
    d = vec3(1.0, 0.95, 1.0);
  }
  vec3 col = mix(a, b, smoothstep(0.08, 0.40, h));
  col = mix(col, c, smoothstep(0.42, 0.74, h));
  return mix(col, d, smoothstep(0.80, 1.0, h));
}
vec3 fxWaterRamp(float h) {
  vec3 col = mix(vec3(0.02, 0.18, 0.42), vec3(0.10, 0.55, 0.85), smoothstep(0.1, 0.5, h));
  return mix(col, vec3(0.88, 0.98, 1.0), smoothstep(0.62, 0.95, h));
}
vec3 fxDustRamp(float h) {
  return mix(vec3(0.20, 0.13, 0.07), vec3(0.62, 0.47, 0.30), smoothstep(0.15, 0.85, h));
}
`;

/**
 * Heat field of one flame on a quad; uv.y runs from base to tip. Each flame is a looping cycle:
 * a round base anchored to the floor squashes while a teardrop body stretches up, the neck
 * pinches and the top breaks off and rises, then it settles back to the start pose.
 * A smaller yellow-white inner flame runs the same cycle faster than the red-orange outer one.
 */
const FIRE_FIELD = /* glsl */ `
float fxTeardrop(float y, float r, float baseY, float tipY) {
  if (y < baseY) {
    float d = (baseY - y) / r;
    return r * sqrt(max(0.0, 1.0 - d * d));
  }
  float k = clamp((y - baseY) / max(tipY - baseY, 1e-3), 0.0, 1.0);
  return r * pow(1.0 - k, 0.6);
}

float fxTongueCycle(float x, float y, float phase) {
  float stretch = 0.5 - 0.5 * cos(6.2831853 * phase);
  float r = 0.24 * (1.0 + 0.2 * stretch);
  float baseY = r * (1.0 - 0.25 * stretch);
  float tipY = 0.5 + 0.42 * stretch;
  float neck = baseY + (tipY - baseY) * 0.5;
  float pinch = smoothstep(0.3, 0.6, phase);
  float lift = 0.3 * smoothstep(0.4, 1.0, phase);
  float body = y <= neck ? fxTeardrop(y, r, baseY, tipY) : 0.0;
  float top = y >= neck + lift ? fxTeardrop(y - lift, r, baseY, tipY) : 0.0;
  // The broken-off top shrinks and fades as it rises.
  top *= (1.0 - 0.6 * smoothstep(0.45, 1.0, phase)) * (1.0 - smoothstep(0.7, 1.0, phase));
  float w = max(body, top) * (1.0 - pinch * 0.85 * exp(-((y - neck) / 0.05) * ((y - neck) / 0.05)));
  if (w < 0.004) return 0.0;
  return 1.0 - smoothstep(w * 0.2, w * 1.05, abs(x));
}

// Two copies of the cycle half a period apart, cross-faded, so the loop has no visible seam.
float fxTongue(float x, float y, float t, float rate, float seed) {
  float pa = fract(t * rate + seed);
  float pb = fract(pa + 0.5);
  float wa = sin(3.14159265 * pa);
  wa *= wa;
  return fxTongueCycle(x, y, pa) * wa + fxTongueCycle(x + 0.03, y, pb) * (1.0 - wa);
}

float fxFlameHeat(vec2 uv, float t, float seed, float life) {
  float n = fxFbm(vec2(uv.x * 3.0 + seed * 7.0, uv.y * 2.2 - t * 2.4));
  float fine = fxNoise(vec2(uv.x * 9.0 - seed * 5.0, uv.y * 7.0 - t * 6.0));
  // Sway grows with height, so the base stays planted and the top whips.
  float x = uv.x - 0.5 + (n - 0.5) * 0.32 * uv.y;
  float outer = fxTongue(x, uv.y, t, 0.9, seed);
  float inner = fxTongue((x + (fine - 0.5) * 0.04) / 0.55, uv.y / 0.62, t, 1.7, seed + 0.37);
  float heat = outer * (0.42 + 0.25 * n) + inner * 0.6;
  // Ragged edges: noise eats into the outline, more toward the top.
  heat -= (1.0 - fine) * (0.12 + 0.25 * uv.y) * (1.0 - inner);
  heat *= smoothstep(0.0, 0.10, life) * (1.0 - smoothstep(0.4, 0.5, abs(uv.x - 0.5)));
  heat -= smoothstep(0.5, 1.0, life) * 0.8;
  return clamp(heat * 1.15, 0.0, 1.0);
}
`;

const SHADE_GLSL = /* glsl */ `
vec4 fxShade(vec2 uv, float t, float life, float seed, int mode) {
  if (mode <= 1) {
    float h = fxFlameHeat(uv, t, seed, life);
    return vec4(fxFireRamp(h, mode), smoothstep(0.02, 0.45, h) * 0.9);
  }
  if (mode == 2) {
    // Water: a narrow jet that fans out, streaked along its rise, breaking into droplets at the crest.
    vec2 p = vec2(uv.x - 0.5, uv.y);
    float n1 = fxFbm(vec2(p.x * 3.0 + seed * 5.0, p.y * 1.6 - t * 1.8));
    float streak = fxFbm(vec2(p.x * 12.0 + seed * 11.0, p.y * 1.2 - t * 2.6));
    float x = p.x + (n1 - 0.5) * 0.22 * uv.y;
    float width = (0.08 + 0.30 * uv.y) * smoothstep(-0.06, 0.10, uv.y);
    float body = 1.0 - smoothstep(width * 0.3, width, abs(x));
    float crest = 1.0 - smoothstep(0.45 + (n1 - 0.5) * 0.35, 0.9, uv.y);
    float h = body * crest * (0.25 + 0.95 * streak);
    h *= smoothstep(0.0, 0.10, life) * (1.0 - smoothstep(0.38, 0.5, abs(p.x)));
    h -= smoothstep(0.45, 1.0, life) * 0.8;
    h = clamp(h * 1.3, 0.0, 1.0);
    // Droplets thrown past the crest and off the sides.
    float cell = fxNoise(vec2(p.x * 34.0 + seed * 3.0, p.y * 26.0 - t * 5.0));
    float spray = smoothstep(0.35, 0.8, uv.y) * (1.0 - smoothstep(0.8, 1.0, uv.y)) * step(abs(x), 0.42);
    float drops = step(0.86, cell) * spray * (1.0 - smoothstep(0.4, 1.0, life));
    float a = smoothstep(0.05, 0.45, h) * 0.72 + drops * 0.8;
    return vec4(fxWaterRamp(max(h, drops * 0.9)), a);
  }
  if (mode == 3) {
    // Rock dust: a heavy column of grit, darker and slower than fire.
    float h = fxFlameHeat(vec2((uv.x - 0.5) * 0.8 + 0.5, uv.y), t * 0.45, seed, life);
    float grit = step(0.86, fxNoise(uv * vec2(30.0, 40.0) + seed * 9.0));
    vec3 col = mix(fxDustRamp(h), vec3(0.10, 0.08, 0.06), grit);
    return vec4(col, smoothstep(0.04, 0.28, h) * 0.95);
  }
  if (mode == 4) {
    // Wind: thin curved streaks that slide across the quad.
    vec2 p = uv - 0.5;
    float n = fxFbm(vec2(p.x * 2.0 - t * 2.5, p.y * 3.0 + seed * 4.0));
    float lines = pow(abs(sin((p.y + (n - 0.5) * 0.35 + p.x * p.x * 0.6) * 26.0)), 18.0);
    float mask = (1.0 - smoothstep(0.25, 0.5, length(p * vec2(0.8, 1.3))));
    float a = lines * mask * (0.4 + n) * smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.55, 1.0, life));
    return vec4(vec3(0.78, 0.94, 1.0), clamp(a, 0.0, 1.0));
  }
  // Smoke, mist and dust: a soft billow that thins as it rises.
  vec2 p = uv - 0.5;
  float n = fxFbm(p * 3.2 + vec2(seed * 5.0, -t * 0.35));
  // One fbm and one octave: smoke covers a lot of screen, so it stays cheap.
  float n2 = 0.3 + 0.5 * fxNoise(p * 6.5 + vec2(-seed * 3.0, t * 0.25)) + 0.2 * n;
  float r = length(p) * 2.0 + (n - 0.5) * 0.7;
  float puff = 1.0 - smoothstep(0.25, 0.95, r);
  float d = puff * (0.45 + 0.7 * n2);
  float fade = smoothstep(0.0, 0.18, life) * (1.0 - smoothstep(0.45, 1.0, life));
  vec3 col = mode == 6 ? mix(vec3(0.62, 0.74, 0.82), vec3(0.88, 0.94, 0.98), n2)
           : mode == 7 ? mix(vec3(0.26, 0.20, 0.14), vec3(0.50, 0.41, 0.31), n2)
           : mix(vec3(0.07, 0.065, 0.06), vec3(0.24, 0.22, 0.21), n2);
  return vec4(col, clamp(d * fade, 0.0, 1.0));
}
`;

export const FX_COMMON_GLSL = NOISE_GLSL + RAMP_GLSL + FIRE_FIELD + SHADE_GLSL;

/** Instanced quads: fire, water and dust stand upright on their base; smoke and wind face the camera. */
export const SPRITE_VERTEX = /* glsl */ `
uniform float uTime;
attribute vec3 iPos;
attribute vec3 iSize;
attribute vec4 iData;
attribute vec4 iAnim;
attribute vec3 iMotion;
varying vec4 vAnim;
varying vec2 vUv;
varying vec4 vData;
void main() {
  vUv = uv;
  vAnim = iAnim;
  vData = iData;
  // Anything right in front of the lens fades out instead of filling the screen.
  vData.z *= smoothstep(0.9, 2.2, distance(cameraPosition, iPos));
  float mode = iData.w;
  bool upright = mode < 3.5;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 right = upright ? normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0)) : camRight;
  vec3 up = upright ? vec3(0.0, 1.0, 0.0) : camUp;
  vec2 local = vec2(position.x, position.y + (upright ? 0.5 : 0.0)) * iSize.xy;
  float c = cos(iSize.z);
  float s = sin(iSize.z);
  vec2 r = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  r.x += sin(iAnim.w * 31.0 + uTime * (3.0 + iAnim.y * 3.0)) * uv.y * uv.y * iSize.x * 0.14;
  if (iAnim.w > 0.5 && iAnim.x < 3.5) {
    vUv.x = 1.0 - uv.x;
  }
  if (iAnim.x > 3.5) {
    vec4 clip0 = projectionMatrix * viewMatrix * vec4(iPos, 1.0);
    vec4 clip1 = projectionMatrix * viewMatrix * vec4(iPos + iMotion, 1.0);
    vec2 ndc0 = clip0.xy / max(1e-4, clip0.w);
    vec2 ndc1 = clip1.xy / max(1e-4, clip1.w);
    vec2 dir2d = ndc1 - ndc0;
    float aspect = projectionMatrix[1][1] / max(1e-4, projectionMatrix[0][0]);
    vec2 screenDir = vec2(dir2d.x * aspect, dir2d.y);
    float screenLen = length(screenDir);

    float alignWeight = smoothstep(0.04, 0.22, screenLen);
    vec2 normDir = screenLen > 1e-4 ? normalize(screenDir) : vec2(1.0, 0.0);
    vec2 axisX = -normDir;
    vec2 axisY = vec2(-axisX.y, axisX.x);

    vec3 alignedRight = camRight * axisX.x + camUp * axisX.y;
    vec3 alignedUp = camRight * axisY.x + camUp * axisY.y;

    right = mix(camRight, alignedRight, alignWeight);
    up = mix(camUp, alignedUp, alignWeight);

    float sideX = (position.x + 0.5 - 0.22) * iSize.x;
    float headX = position.x * iSize.y;
    r = vec2(mix(headX, sideX, alignWeight), position.y * iSize.y);

    vUv.x = mix(0.22 + position.x * 0.44, uv.x, alignWeight);
    vUv.y = mix(0.50 + position.y * 0.44, uv.y, alignWeight);
  }
  vec3 world = iPos + right * r.x + up * r.y;
  if (iAnim.x < 3.5) world.xz -= iMotion.xz * (uv.y * uv.y) * 0.035;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

export const SPRITE_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform sampler2D uAtlas0;
uniform sampler2D uAtlas1;
uniform sampler2D uAtlas2;
uniform sampler2D uAtlas3;
uniform sampler2D uAtlas4;
uniform sampler2D uSceneDepth;
uniform vec2 uViewport;
uniform vec2 uNearFar;
uniform float uSoftReady;
varying vec2 vUv;
varying vec4 vData;
varying vec4 vAnim;
${FX_COMMON_GLSL}
float linearDepth(float d) {
  return uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x));
}
vec4 atlasFrame(float frame) {
  vec2 cell = vec2(mod(frame, 8.0), 7.0 - floor(frame / 8.0));
  vec2 coords = (cell + clamp(vUv, 0.008, 0.992)) / 8.0;
  if (vAnim.x < 0.5) return texture2D(uAtlas0, coords);
  if (vAnim.x < 1.5) return texture2D(uAtlas1, coords);
  if (vAnim.x < 2.5) return texture2D(uAtlas2, coords);
  if (vAnim.x < 3.5) return texture2D(uAtlas3, coords);
  return texture2D(uAtlas4, coords);
}
void main() {
  int mode = int(vData.w + 0.5);
  vec4 col;
  if (mode <= 1 || mode == 5) {
    float frame = (vAnim.x < 0.5 || vAnim.x > 3.5) ? mod(uTime * (24.0 * vAnim.y) + vAnim.w * 64.0, 64.0) : clamp(vData.x * 63.0 * vAnim.y, 0.0, 63.0);
    float nextFrame = (vAnim.x < 0.5 || vAnim.x > 3.5) ? mod(floor(frame) + 1.0, 64.0) : min(63.0, floor(frame) + 1.0);
    col = mix(atlasFrame(floor(frame)), atlasFrame(nextFrame), fract(frame));
    // sRGB atlas textures decode to linear light before the hot core feeds bloom.
    if (mode <= 1) {
      if (vAnim.x > 3.5) {
        col.rgb *= vec3(1.15, 1.10, 1.02);
        col.rgb = min(col.rgb, vec3(2.2, 2.0, 1.8));
      } else {
        // The baked atlases carry their own fire colour: lift it for bloom, vary yellow-orange per tongue.
        col.rgb *= 1.6 * vec3(1.0, vAnim.z, mix(1.0, vAnim.z, 0.5));
        col.rgb = min(col.rgb, vec3(2.3, 2.1, 1.8));
      }
      if (mode == 1) col.rgb = col.rgb.r * vec3(0.6, 0.14, 1.0);
      col.a *= 1.0 - smoothstep(0.65, 1.0, vData.x);
    }
  } else col = fxShade(vUv, uTime + vData.y * 13.0, vData.x, vData.y, mode);
  col.a *= vData.z;
  if (uSoftReady > 0.5) {
    float sceneDepth = linearDepth(texture2D(uSceneDepth, gl_FragCoord.xy / uViewport).x);
    float particleDepth = linearDepth(gl_FragCoord.z);
    col.a *= smoothstep(0.0, mode == 5 ? 0.32 : 0.16, sceneDepth - particleDepth);
  }
  if (col.a < 0.004) discard;
  gl_FragColor = col;
}
`;
