import {
  Color,
  ShaderMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    sunUv: { value: new Vector2(0.5, 0.5) },
    sunColor: { value: new Color(0xffcb80) },
    exposure: { value: 0.16 },
    decay: { value: 0.90 },
    density: { value: 0.60 },
    weight: { value: 0.32 },
    intensity: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunUv;
    uniform vec3 sunColor;
    uniform float exposure;
    uniform float decay;
    uniform float density;
    uniform float weight;
    uniform float intensity;
    varying vec2 vUv;

    const int NUM_SAMPLES = 8;

    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);
      if (intensity <= 0.001) {
        gl_FragColor = baseColor;
        return;
      }

      vec2 delta = (vUv - sunUv) * (density / float(NUM_SAMPLES));
      vec2 coord = vUv;
      float illum = 1.0;
      vec3 rayColor = vec3(0.0);

      for (int i = 0; i < NUM_SAMPLES; i++) {
        coord -= delta;
        if (coord.x >= 0.0 && coord.x <= 1.0 && coord.y >= 0.0 && coord.y <= 1.0) {
          vec3 s = texture2D(tDiffuse, coord).rgb;
          float brightness = dot(s, vec3(0.299, 0.587, 0.114));
          float mask = smoothstep(0.92, 1.8, brightness);
          rayColor += s * mask * illum * weight;
        }
        illum *= decay;
      }

      // Additive golden shaft glow
      vec3 finalRays = rayColor * exposure * intensity * sunColor;
      gl_FragColor = vec4(baseColor.rgb + finalRays, baseColor.a);
    }
  `,
};

export class GodRaysSystem {
  readonly pass: ShaderPass;
  private readonly sunWorldPos = new Vector3();
  private readonly projected = new Vector3();
  private readonly sunUv = new Vector2();

  constructor(sunDir: Vector3, enabled: boolean) {
    this.pass = new ShaderPass(GodRaysShader);
    this.pass.enabled = enabled;
    this.sunWorldPos.copy(sunDir).multiplyScalar(80);
  }

  update(camera: PerspectiveCamera): void {
    if (!this.pass.enabled) return;

    // Project sun into NDC coordinates
    this.projected.copy(this.sunWorldPos).project(camera);

    // Sun behind camera
    if (this.projected.z >= 1.0) {
      this.pass.uniforms['intensity']!.value = 0.0;
      return;
    }

    // Convert to UV space [0, 1]
    this.sunUv.set((this.projected.x + 1.0) * 0.5, (this.projected.y + 1.0) * 0.5);
    this.pass.uniforms['sunUv']!.value.copy(this.sunUv);

    // Fade when sun moves far off screen
    const dist = Math.hypot(this.projected.x, this.projected.y);
    const vis = Math.max(0.0, 1.0 - Math.max(0.0, dist - 0.75) * 1.2);
    this.pass.uniforms['intensity']!.value = vis;
  }
}
