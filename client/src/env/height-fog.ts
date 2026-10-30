import {
  Color,
  ShaderChunk,
  Vector3,
  type Material,
} from 'three';

export interface HeightFogParams {
  sunDirection: Vector3;
  sunColor: Color;
  coolColor: Color;
  density: number;
  heightFalloff: number;
  baseHeight: number;
}

export class HeightFogSystem {
  readonly sunDirection = new Vector3();
  // Warm golden amber towards the sun
  readonly sunColor = new Color().setRGB(1.0, 0.76, 0.42);
  // Cool crisp slate blue away from the sun
  readonly coolColor = new Color().setRGB(0.36, 0.46, 0.62);
  density = 0.0065;
  heightFalloff = 0.038;
  baseHeight = 0.0;

  private readonly trackedMaterials = new Set<Material>();

  constructor() {
    this.installShaderChunks();
  }

  private installShaderChunks(): void {
    if (ShaderChunk.fog_pars_fragment.includes('heightFogDensity')) return;

    // Inject varying world position in vertex shader
    ShaderChunk.fog_pars_vertex = /* glsl */ `
      #ifdef USE_FOG
        varying vec3 vEnvWorldPosition;
      #endif
    ` + ShaderChunk.fog_pars_vertex;

    ShaderChunk.fog_vertex = /* glsl */ `
      #ifdef USE_FOG
        vEnvWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif
    ` + ShaderChunk.fog_vertex;

    // Inject height fog parameters in fragment shader
    ShaderChunk.fog_pars_fragment = /* glsl */ `
      #ifdef USE_FOG
        uniform vec3 heightFogSunDir;
        uniform vec3 heightFogSunColor;
        uniform vec3 heightFogCoolColor;
        uniform float heightFogDensity;
        uniform float heightFogHeightFalloff;
        uniform float heightFogBase;
        varying vec3 vEnvWorldPosition;
      #endif
    ` + ShaderChunk.fog_pars_fragment;

    // Atmospheric height fog with directional Mie and Rayleigh scattering (no muddy brown)
    ShaderChunk.fog_fragment = /* glsl */ `
      #ifdef USE_FOG
        float envDist = length(vEnvWorldPosition - cameraPosition);
        float envH = max(0.0, vEnvWorldPosition.y - heightFogBase);
        float envHFactor = exp(-envH * heightFogHeightFalloff);
        
        // Optical depth based on distance and vertical density
        float envOptDepth = envDist * heightFogDensity * (0.3 + 0.7 * envHFactor);
        float envFogFactor = 1.0 - exp(-envOptDepth);
        envFogFactor = clamp(envFogFactor, 0.0, 0.96);

        // Directional scattering: cool slate-blue away from sun, transitioning through
        // soft twilight lavender-peach into glowing golden amber near the sun
        vec3 envViewDir = normalize(vEnvWorldPosition - cameraPosition);
        float envSunDot = max(0.0, dot(envViewDir, heightFogSunDir));
        float mieLobe = pow(envSunDot, 4.5);
        
        vec3 warmHaze = mix(heightFogCoolColor, vec3(0.68, 0.58, 0.60), envSunDot * 0.4);
        vec3 envCurrentFogColor = mix(warmHaze, heightFogSunColor, mieLobe);

        gl_FragColor.rgb = mix(gl_FragColor.rgb, envCurrentFogColor, envFogFactor);
      #endif
    `;
  }

  setupMaterial(mat: Material): void {
    if (this.trackedMaterials.has(mat)) return;
    this.trackedMaterials.add(mat);

    const prevOnBeforeCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      if (prevOnBeforeCompile) prevOnBeforeCompile(shader, renderer);

      shader.uniforms['heightFogSunDir'] = { value: this.sunDirection };
      shader.uniforms['heightFogSunColor'] = { value: this.sunColor };
      shader.uniforms['heightFogCoolColor'] = { value: this.coolColor };
      shader.uniforms['heightFogDensity'] = { value: this.density };
      shader.uniforms['heightFogHeightFalloff'] = { value: this.heightFalloff };
      shader.uniforms['heightFogBase'] = { value: this.baseHeight };
    };

    mat.needsUpdate = true;
  }

  update(sunDir: Vector3): void {
    this.sunDirection.copy(sunDir).normalize();
  }
}
