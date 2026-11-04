import { ShaderChunk } from 'three';

/**
 * Aerial haze for the open zone. three's exponential fog grows with the square of distance and ignores height,
 * so a street either stays crisp to its end or the volcano vanishes. This haze grows with distance itself
 * (as light scattering in air does) and thins with height along the view ray, so the far end of a street
 * goes soft and pale while ridges and the volcano stand out above it. It replaces the fog shader chunks for
 * every material that uses fog; scene.fog (a FogExp2) still supplies the colour and the density.
 */
export function installHaze(falloff = 0.03, floor = 0.12): void {
  if (ShaderChunk.fog_fragment.includes('hazeThin')) return;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
    #ifdef USE_FOG
      varying float vFogDepth;
      varying float vHazeY;
    #endif`;
  ShaderChunk.fog_vertex = /* glsl */ `
    #ifdef USE_FOG
      vFogDepth = length(mvPosition.xyz);
      vHazeY = cameraPosition.y + (transpose(mat3(viewMatrix)) * mvPosition.xyz).y;
    #endif`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying float vFogDepth;
      varying float vHazeY;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
    #endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        // Thinner with the mean height of the ray from the eye to the surface.
        float hazeThin = exp(-max(0.0, 0.5 * (cameraPosition.y + vHazeY)) * ${falloff.toFixed(4)});
        float fogFactor = 1.0 - exp(-fogDensity * vFogDepth * (${floor.toFixed(3)} + ${(1 - floor).toFixed(3)} * hazeThin));
      #else
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
      #endif
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
    #endif`;
}
