/**
 * Animation player for character rigs. Wraps Three.js AnimationMixer to provide
 * smooth, seamless cross-fading between locomotion and action clips without snapping.
 */

import {
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type AnimationAction,
  type Object3D,
} from 'three';

export interface AnimationPlayerOptions {
  /** Default cross-fade transition time in seconds. Defaults to 0.25s. */
  defaultFadeDuration?: number;
}

export class AnimationPlayer {
  readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly contributingActions = new Set<AnimationAction>();
  private transition: {
    target: AnimationAction;
    startWeights: Map<AnimationAction, number>;
    duration: number;
    elapsed: number;
  } | null = null;
  private currentClipName: string | null = null;
  private readonly defaultFadeDuration: number;
  private isDisposed = false;

  constructor(
    root: Object3D,
    clips: readonly AnimationClip[],
    options: AnimationPlayerOptions = {},
  ) {
    this.mixer = new AnimationMixer(root);
    this.defaultFadeDuration = options.defaultFadeDuration ?? 0.25;

    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }
  }

  /**
   * Cross-fade to the clip named `name`.
   * Returns true if transition started, false if clip was not found or already playing.
   */
  play(name: string, fadeDuration = this.defaultFadeDuration, loop = true): boolean {
    if (this.isDisposed) return false;
    if (this.currentClipName === name) return true;

    const nextAction = this.actions.get(name);
    if (!nextAction) {
      console.warn(`Animation clip "${name}" not found.`);
      return false;
    }

    nextAction.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    nextAction.clampWhenFinished = !loop;

    const startWeights = new Map<AnimationAction, number>();
    for (const action of this.contributingActions) {
      startWeights.set(action, action.getEffectiveWeight());
    }

    // Keep the playback position when returning to a clip still in the blend.
    if ((startWeights.get(nextAction) ?? 0) === 0) {
      nextAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(0).play();
    }
    this.contributingActions.add(nextAction);
    startWeights.set(nextAction, startWeights.get(nextAction) ?? 0);
    this.transition = {
      target: nextAction,
      startWeights,
      duration: Math.max(0, fadeDuration),
      elapsed: 0,
    };
    this.updateWeights(0);
    this.currentClipName = name;
    return true;
  }

  /**
   * Advance the animation mixer by delta seconds.
   */
  update(deltaSeconds: number): void {
    if (this.isDisposed) return;
    this.updateWeights(deltaSeconds * this.mixer.timeScale);
    this.mixer.update(deltaSeconds);
  }

  private updateWeights(deltaSeconds: number): void {
    const transition = this.transition;
    if (!transition) return;

    transition.elapsed = Math.max(0, transition.elapsed + deltaSeconds);
    const progress = transition.duration === 0
      ? 1
      : Math.min(1, transition.elapsed / transition.duration);

    for (const [action, startWeight] of transition.startWeights) {
      const endWeight = action === transition.target ? 1 : 0;
      action.setEffectiveWeight(startWeight + (endWeight - startWeight) * progress);
      if (progress === 1 && action !== transition.target) {
        action.stop();
        this.contributingActions.delete(action);
      }
    }

    if (progress === 1) this.transition = null;
  }

  /**
   * Returns the name of the currently active clip.
   */
  getCurrentClip(): string | null {
    return this.currentClipName;
  }

  /**
   * Returns true if a clip with the given name is registered.
   */
  hasClip(name: string): boolean {
    return this.actions.has(name);
  }

  /**
   * Returns a list of all registered clip names.
   */
  getClipNames(): string[] {
    return Array.from(this.actions.keys());
  }

  /**
   * Clean up mixer actions and listeners.
   */
  dispose(): void {
    this.isDisposed = true;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    this.actions.clear();
    this.contributingActions.clear();
    this.transition = null;
    this.currentClipName = null;
  }
}
