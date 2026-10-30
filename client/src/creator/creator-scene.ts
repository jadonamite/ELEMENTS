/**
 * 3D character viewport scene for character creation.
 * Renders the hero base on a rotating stone plinth in soft studio light,
 * dressed in commoner's rags with the chosen skin tone, hair and body preset.
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  TorusGeometry,
  WebGLRenderer,
} from 'three';
import { BodyKit } from '../body.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterConfig } from './creator-types.js';

export class CreatorScene {
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly loader: GLTFLoader;

  private readonly turntableGroup: Group;
  private characterGroup: Group | null = null;
  private activeMixer: AnimationMixer | null = null;
  private idleClip: AnimationClip | null = null;

  private activeConfig: CharacterConfig;
  private isDisposed = false;
  private animFrameId = 0;
  private lastTime = 0;

  // Manual drag orbit
  private isDragging = false;
  private previousMouseX = 0;
  private rotationVelocity = 0.3; // Base turntable auto-rotation radians/sec

  // Loads each body, outfit and hair once, so preset switching is instant
  private readonly kit: BodyKit;
  private loadToken = 0;

  constructor(container: HTMLElement, initialConfig: CharacterConfig) {
    this.container = container;
    this.activeConfig = { ...initialConfig };

    this.scene = new Scene();
    this.scene.background = new Color(0x0a0908);

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 720;

    this.camera = new PerspectiveCamera(38, width / height, 0.1, 20);
    this.camera.position.set(0, 1.2, 3.5);
    this.camera.lookAt(0, 1.08, 0);

    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.turntableGroup = new Group();
    this.scene.add(this.turntableGroup);

    this.loader = new GLTFLoader();
    this.kit = new BodyKit(this.loader);

    this.setupLighting();
    this.setupPlinth();
    this.setupInteractions();

    window.addEventListener('resize', this.onResize);

    // Initial load
    this.loadCharacter();

    this.lastTime = performance.now();
    this.animate(this.lastTime);
  }

  private setupLighting(): void {
    // Ambient floor bounce
    const hemiLight = new HemisphereLight(0x383028, 0x0c0a08, 1.2);
    hemiLight.position.set(0, 5, 0);
    this.scene.add(hemiLight);

    const ambient = new AmbientLight(0x221c16, 0.6);
    this.scene.add(ambient);

    // Key studio light (warm, soft shadow)
    const keyLight = new DirectionalLight(0xfff3e6, 2.5);
    keyLight.position.set(-1.8, 3.2, 2.8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    // Fill light (cool tone contrast)
    const fillLight = new DirectionalLight(0x7692b8, 1.2);
    fillLight.position.set(2.4, 2.0, 2.0);
    this.scene.add(fillLight);

    // Cinematic golden rim light from behind
    const rimLight = new DirectionalLight(0xd8aa64, 2.2);
    rimLight.position.set(0, 2.6, -2.6);
    this.scene.add(rimLight);
  }

  private setupPlinth(): void {
    const plinthMat = new MeshStandardMaterial({
      color: 0x1f1b16,
      roughness: 0.85,
      metalness: 0.12,
    });
    const plinthGeo = new CylinderGeometry(1.15, 1.25, 0.18, 48);
    const plinth = new Mesh(plinthGeo, plinthMat);
    plinth.position.y = -0.09;
    plinth.receiveShadow = true;
    plinth.castShadow = true;
    this.turntableGroup.add(plinth);

    // Bronze trim ring
    const rimMat = new MeshStandardMaterial({
      color: 0xc49b55,
      roughness: 0.38,
      metalness: 0.75,
    });
    const rimGeo = new TorusGeometry(1.22, 0.016, 16, 64);
    rimGeo.rotateX(Math.PI / 2);
    const rim = new Mesh(rimGeo, rimMat);
    rim.position.y = -0.01;
    rim.castShadow = true;
    this.turntableGroup.add(rim);
  }

  private setupInteractions(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('pointerdown', (e) => {
      this.isDragging = true;
      this.previousMouseX = e.clientX;
      this.rotationVelocity = 0;
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const deltaX = e.clientX - this.previousMouseX;
      this.previousMouseX = e.clientX;
      this.turntableGroup.rotation.y += deltaX * 0.012;
      this.rotationVelocity = deltaX * 0.005;
    });

    window.addEventListener('pointerup', () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      // Gently settle back to slow rotation
      if (Math.abs(this.rotationVelocity) < 0.1) {
        this.rotationVelocity = 0.25;
      }
    });
  }

  private onResize = (): void => {
    if (this.isDisposed) return;
    const width = this.container.clientWidth || 640;
    const height = this.container.clientHeight || 720;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  /** Rebuilds the fighter for the current config, keeping the idle loop's place. */
  private async loadCharacter(token = ++this.loadToken): Promise<void> {
    if (this.isDisposed || this.loadToken !== token) return;

    if (!this.idleClip) {
      try {
        const heroGltf = await this.loader.loadAsync('/assets/characters/hero.glb');
        if (this.isDisposed || this.loadToken !== token) return;
        this.idleClip =
          heroGltf.animations.find(a => a.name === 'idle_relaxed') ??
          heroGltf.animations.find(a => a.name === 'idle') ??
          null;
      } catch {
        this.idleClip = null;
      }
    }

    try {
      const config = { ...this.activeConfig };
      const model = await this.kit.build(config);
      const clips = this.idleClip ? await this.kit.fitClips(config.sex, [this.idleClip], 'creator-idle') : [];
      if (this.isDisposed || this.loadToken !== token) return;

      const time = this.activeMixer?.time ?? 0;
      if (this.characterGroup) this.turntableGroup.remove(this.characterGroup);
      this.characterGroup = model;
      this.turntableGroup.add(model);

      this.activeMixer = null;
      if (clips[0]) {
        this.activeMixer = new AnimationMixer(model);
        this.activeMixer.clipAction(clips[0]).play();
        this.activeMixer.setTime(time);
      }
    } catch (err) {
      if (this.loadToken === token) {
        console.error('Failed to load character:', err);
      }
    }
  }

  /**
   * Updates configuration dynamically and applies visual changes.
   */
  async updateConfig(newConfig: CharacterConfig): Promise<void> {
    this.activeConfig = { ...newConfig };
    await this.loadCharacter(++this.loadToken);
  }

  private animate = (currentTime: number): void => {
    if (this.isDisposed) return;
    this.animFrameId = requestAnimationFrame(this.animate);

    const delta = Math.min(0.1, (currentTime - this.lastTime) / 1000);
    this.lastTime = currentTime;

    // Turntable smooth slow rotation
    if (!this.isDragging) {
      this.turntableGroup.rotation.y += this.rotationVelocity * delta;
      // Slowly return to gentle cruise speed
      const targetSpeed = 0.28;
      this.rotationVelocity += (targetSpeed - this.rotationVelocity) * 0.05;
    }

    // Animation player tick
    if (this.activeMixer) {
      this.activeMixer.update(delta);
    }

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.isDisposed = true;
    cancelAnimationFrame(this.animFrameId);
    window.removeEventListener('resize', this.onResize);

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(
        this.renderer.domElement
      );
    }

    this.scene.clear();
  }
}
