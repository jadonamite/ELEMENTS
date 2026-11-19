import RAPIER from '@dimforge/rapier3d-compat';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector3, type Scene } from 'three';
import { IGNIS_MISSION as M, MISSION_COPY as COPY, HOME_MEAL_PRICE, MEAL_ITEM, type MissionEvent } from '../../../shared/src/story/missions.js';
import type { Loaders } from '../assets/loaders.js';
import type { HeroController } from '../controller.js';
import type { ContextOffer } from '../ui/context-action.js';
import { MissionActor } from './mission-actor.js';
import { MissionApi, type MissionSnapshot } from './mission-api.js';
import { saveProgressAtGate } from '../auth/save-progress.js';
import type { DrawingResult } from '../opening.js';
import './mission-flow.css';

interface Options {
  scene: Scene; world: RAPIER.World; loaders: Loaders; controller: HeroController;
  notice(text: string): void;
  accountDrawing(drawing: DrawingResult): void;
  changed(snapshot: MissionSnapshot): void;
  ate(): void;
  reach(): void;
  retryGate(): void;
  zone(): string;
  unavailable(): void;
}
interface Reply { label: string; run(): void | Promise<void> }

/** Drives story presentation; account state and economic effects come only from MissionApi. */
export class MissionFlow {
  readonly api = new MissionApi();
  readonly ready: Promise<void>;
  private readonly registrar: MissionActor;
  private readonly neri: MissionActor;
  private readonly cook: MissionActor;
  private readonly master: MissionActor;
  private readonly kellan: MissionActor;
  private readonly invitationButton = document.createElement("button");
  seated = false;
  private approach = false;
  private returnAt = 0;
  private readonly trail: Vector3[] = [];
  private readonly props = new Group();
  private readonly coverCollider: RAPIER.Collider;
  private panel: HTMLElement | null = null;
  private lastFocus: HTMLElement | null = null;
  private busy = false;
  private disposed = false;
  private routePoint = 0;
  private ambushing = false;
  private nextPoll = 0;
  private polling = false;
  private wasAlive = true;
  private deathPending = false;
  private gestureUntil = 0;
  private readonly offerAt = new Vector3();
  private readonly routeTarget = new Vector3();
  private readonly cookFacing = new Vector3();
  trainingReady = false;

  constructor(private readonly opts: Options) {
    this.registrar = new MissionActor(opts.scene, opts.loaders, 'Registrar', M.gate);
    this.neri = new MissionActor(opts.scene, opts.loaders, 'Neri', M.neri, true);
    this.cook = new MissionActor(opts.scene, opts.loaders, 'Cook', M.stallKeeper, true);
    this.master = new MissionActor(opts.scene, opts.loaders, 'Master Brandr', M.hall);
    this.kellan = new MissionActor(opts.scene, opts.loaders, 'Kellan', M.kellan);
    this.invitationButton.className = 'mission-invitation'; this.invitationButton.type = 'button';
    this.invitationButton.textContent = 'Inspect Arena invitation'; this.invitationButton.hidden = true;
    this.invitationButton.addEventListener('click', () => this.inspectInvitation()); document.body.appendChild(this.invitationButton);
    for (const actor of [this.registrar, this.neri, this.cook, this.master, this.kellan]) void actor.ready.catch(() => opts.notice('A story character could not load. Reload to retry.'));
    this.coverCollider = opts.world.createCollider(RAPIER.ColliderDesc.cuboid(1.8, 0.75, 0.65).setTranslation(M.cover.x, 0.75, M.cover.z - 1));
    this.buildProps();
    opts.scene.add(this.props);
    this.api.onChange = snapshot => { opts.changed(snapshot); this.invitationButton.hidden = !snapshot.state.flags.arena_ticket_collected; };
    this.ready = this.api.load().then(snapshot => {
      if (!snapshot || this.disposed) return;
      this.trainingReady = snapshot.state.flags.training_complete;
      const f = snapshot.state.flags;
      if (f.neri_search_accepted && !f.ambush_survived) {
        this.routePoint = M.route.length - 1;
        this.neri.position.set(M.checkpoint.x, M.checkpoint.y, M.checkpoint.z);
      }
      if (f.ambush_survived) this.neri.position.set(M.cover.x, M.cover.y, M.cover.z);
      if (f.mission_1a_complete) this.neri.position.set(M.hall.x - 3, M.hall.y, M.hall.z);
    }).catch(error => { opts.notice((error as Error).message); });
  }
  get supported(): boolean { return (this.api.snapshot?.state.zone ?? this.opts.zone()) === 'sindr'; }
  showUnavailable(): void {
    this.opts.unavailable();
    const zone = this.api.snapshot?.state.zone ?? this.opts.zone();
    this.show('Journey unavailable', `The ${zone} journey is not available yet. Your Drawing has been kept.`, [{ label: 'Close', run: () => this.close() }]);
  }
  get complete(): boolean { return this.api.snapshot?.state.flags.mission_1_complete === true; }
  get acting(): boolean { return performance.now() < this.gestureUntil; }
  get checkpoint(): { x: number; y: number; z: number } | null {
    const f = this.api.snapshot?.state.flags;
    return f?.hall_briefed ? M.yard : f?.mission_1a_complete ? M.hall : f?.neri_search_accepted ? M.checkpoint : null;
  }

  /** This promise resolves only after the server commits taking the pouch. */
  async gate(): Promise<void> {
    if (this.busy) throw new Error('The registrar is already speaking with you.');
    await this.question('Registrar', COPY.registrar, 'Sign in or continue', 'Return later');
    this.close();
    const drawing = await saveProgressAtGate();
    if (!drawing) throw new Error('Sign in to enter town.');
    this.opts.accountDrawing(drawing);
    await this.api.load();
    if (!this.supported) { this.showUnavailable(); throw new Error('This mission location is not available yet.'); }
    if (!this.api.snapshot?.state.flags.training_complete) await this.event('training_complete');
    if (this.api.needsReconnect || !this.api.online) {
      if (!this.api.online && new URLSearchParams(window.location.search).has('online')) throw new Error('The world connection is not ready. Reload to retry.');
      const url = new URL(window.location.href);
      url.searchParams.set('online', '1'); url.searchParams.delete('offline');
      window.location.assign(url.href);
      await new Promise<void>(() => {});
      return;
    }
    await this.event('register');
    if (!this.complete) {
      await this.question('Registrar', COPY.pouch, 'Reach for the pouch', 'Return later');
      this.close();
      this.opts.reach(); this.gestureUntil = performance.now() + 900;
      await new Promise(resolve => setTimeout(resolve, 650));
      await this.event('take_pouch');
      this.opts.notice(`Pouch received. ${this.api.snapshot!.balance.toLocaleString()} CHROMA carried.`);
    }
    await this.question('Registrar', COPY.clue, 'Enter town');
    this.close();
    // The shared world owns the ambush and its loot. Sign-in at the gate changes the connection identity.
    if (!this.api.online) {
      const url = new URL(window.location.href);
      url.searchParams.set('online', '1');
      url.searchParams.delete('offline');
      window.location.assign(url.href);
    }
  }

  contextOffer(): ContextOffer | null {
    if (!this.supported || this.panel || this.busy) return null;
    const hero = this.opts.controller.position;
    const near = (at: { x: number; y: number; z: number }, reach = 3.6) => Math.hypot(hero.x - at.x, hero.z - at.z) < reach && Math.abs(hero.y - at.y) < 3;
    const offer = (verb: string, at: { x: number; y: number; z: number }, act: () => void): ContextOffer => ({ verb, at: this.offerAt.set(at.x, at.y + 1.8, at.z), act });
    if (!this.complete) return this.trainingReady && near(M.gate, 6) ? offer('Speak with the registrar', M.gate, this.opts.retryGate) : null;
    const f = this.api.snapshot!.state.flags;
    if (f.mission_1a_complete && near(M.hall) && (!f.hall_briefed || hero.distanceTo(this.master.position) < hero.distanceTo(this.kellan.position))) return offer('Speak with Master Brandr', M.hall, () => this.talkMaster());
    if (f.hall_briefed && near(M.kellan)) return offer('Speak with Kellan', M.kellan, () => this.talkKellan());
    if (f.hall_briefed && !f.spar_completed && near(M.yard)) return offer('Begin supervised spar', M.yard, () => this.talkKellan());
    if (this.seated && !this.approach) return offer('Stand up', M.seat, () => { this.seated = false; });
    if (near(M.stall)) return offer('Talk with the cook', M.stallKeeper, () => this.talkCook());
    if (performance.now() >= this.returnAt && near(this.neri.position)) return offer('Talk with Neri', this.neri.position, () => this.talkNeri());
    return null;
  }

  private meal(): void {
    const items = this.api.snapshot?.items ?? {};
    const replies: Reply[] = [];
    if ((items[MEAL_ITEM] ?? 0) > 0) replies.push({ label: 'Sit and try your meal', run: async () => {
      this.opts.controller.place(M.seat.x, M.seat.y, M.seat.z); this.seated = true;
      const result = await this.event('eat_meal');
      if (result.applied) { this.opts.ate(); this.gestureUntil = performance.now() + 1000; }
      this.close(); this.approach = !this.api.snapshot!.state.flags.neri_met;
      if (!this.approach) this.show('Food stall', 'A hot meal. Your stamina is restored.', [{ label: 'Stand up', run: () => { this.seated = false; this.close(); } }]);
    } });
    replies.push({ label: `Buy a meal · ${HOME_MEAL_PRICE} CHROMA`, run: async () => {
      await this.event('buy_meal');
      this.opts.notice(`Meal bought for 5 CHROMA. ${this.api.snapshot!.balance.toLocaleString()} CHROMA carried.`);
      this.meal();
    } }, { label: 'Leave', run: () => this.close() });
    this.show('Food stall', 'A home meal costs 5 CHROMA. Eat it to restore your stamina.', replies);
  }

  private talkCook(): void {
    this.cook.pose('talk', 'idle');
    this.show('Cook', COPY.cookGreeting, [
      { label: 'Buy a home meal · 5 CHROMA', run: () => { this.cook.pose('idle'); this.meal(); } },
      { label: 'What is cooking?', run: () => this.show('Cook', COPY.cookMeal, [{ label: 'Buy a meal · 5 CHROMA', run: () => { this.cook.pose('idle'); this.meal(); } }, { label: 'Leave', run: () => { this.cook.pose('idle'); this.close(); } }]) },
      { label: 'Leave', run: () => { this.cook.pose('idle'); this.close(); } },
    ]);
  }

  private talkNeri(): void {
    const f = this.api.snapshot!.state.flags;
    this.neri.pose(this.seated ? 'sit' : 'talk', 'idle');
    if (f.mission_1a_complete) {
      this.show('Neri', f.invitation_identified ? 'We know what the invitation is now. We still need to find Tarin.' : "Kellan is at the Hall court. Let's ask him about it.", [{ label: 'Leave', run: () => this.close() }, { label: 'Inspect invitation', run: () => this.inspectInvitation() }]);
    } else if (f.arena_ticket_collected) {
      if (!f.invitation_inspected) { this.inspectInvitation(); return; }
      this.show('Neri', COPY.aftermath, [
        { label: 'Let us speak with Kellan', run: async () => { await this.event('kellan_lead'); this.close(); this.opts.notice("Search complete. Speak with the Master and Kellan at the Hall court, up the Rise."); } },
        { label: 'Inspect invitation', run: () => this.inspectInvitation() },
        { label: 'I will return later', run: () => this.close() },
      ]);
    } else if (f.ambush_survived) {
      this.show('Neri', 'Look at what they dropped. There may be something on the road.', [{ label: 'Search the drops', run: () => this.close() }]);
    } else if (!f.meal_eaten) {
      this.show('Neri', 'Enjoy your meal.', [{ label: 'Leave', run: () => this.close() }]);
    } else if (!f.neri_met) {
      this.show('Neri', COPY.neriGreeting, [
        { label: 'Of course. Sit down.', run: () => this.rapport() },
        { label: 'What is your name?', run: () => this.show('Neri', "I'm Neri. Is this seat free?", [{ label: 'Sit with me', run: () => this.rapport() }, { label: 'I would rather be alone', run: () => this.declineCompany() }]) },
        { label: 'I would rather be alone', run: () => this.declineCompany() },
      ]);
    } else if (!f.neri_search_accepted) this.searchRequest();
    else this.show('Neri', this.ambushing ? 'I will stay behind this cover.' : 'We can look along the road east of the market.', [{ label: 'Continue the search', run: () => this.close() }]);
  }

  private declineCompany(): void {
    this.approach = false; this.returnAt = performance.now() + 30000;
    this.show('Neri', 'Of course. Take care.', [{ label: 'Stand up', run: () => { this.seated = false; this.close(); } }]);
  }

  private rapport(): void {
    this.show('Neri', COPY.neriRapport, [
      { label: 'Still finding my way', run: async () => { await this.event('meet_neri'); this.show('Neri', "It takes a little getting used to. I know these streets, but today I've been walking in circles. There's someone I'm worried about.", [{ label: 'Listen', run: () => this.searchRequest() }]); } },
      { label: 'The food helps', run: async () => { await this.event('meet_neri'); this.show('Neri', "It does. I wish my brother were here to share it. There's something I wanted to ask you.", [{ label: 'Listen', run: () => this.searchRequest() }]); } },
      { label: 'I need to go', run: () => this.declineCompany() },
    ]);
  }

  private searchRequest(): void {
    this.show('Neri', COPY.neriRequest, [
      { label: 'I will help you look', run: async () => { await this.event('accept_search'); this.seated = false; this.close(); } },
      { label: 'Where was Tarin expected?', run: () => this.show('Neri', COPY.neriWhere, [{ label: 'Go on', run: () => this.searchRequest() }]) },
      { label: 'Not now', run: () => this.show('Neri', "All right. I'll be near the stall if you change your mind.", [{ label: 'Leave', run: () => { this.seated = false; this.close(); } }]) },
    ]);
  }

  private inspectInvitation(): void {
    this.show('Arena invitation', COPY.invitation, [
      { label: 'Put away', run: async () => {
        if (!this.api.snapshot!.state.flags.invitation_inspected) await this.event('inspect_invitation');
        this.close();
      } },
    ]);
  }

  private talkMaster(): void {
    if (this.api.snapshot!.state.flags.hall_briefed) { this.talkKellan(); return; }
    this.show('Master Brandr', COPY.master, [
      { label: 'We found an invitation while searching for Tarin', run: () => this.show('Master Brandr', COPY.briefing, [
        { label: 'Speak with Kellan', run: async () => { await this.event('hall_briefing'); this.close(); } },
        { label: 'Return later', run: () => this.close() },
      ]) },
      { label: 'Return later', run: () => this.close() },
    ]);
  }

  private talkKellan(): void {
    const f = this.api.snapshot!.state.flags;
    if (!f.spar_completed) this.show('Kellan', COPY.spar, [
      { label: 'Begin spar', run: async () => { await this.event('start_spar'); this.close(); this.opts.notice('Supervised spar: best both disciples. Guard, then answer their strike.'); } },
      { label: 'Practise later', run: () => this.close() },
    ]);
    else this.show('Kellan', COPY.identified, [
      { label: 'Keep the invitation', run: async () => { if (!f.invitation_identified) await this.event('identify_invitation'); this.close(); this.opts.notice('Kellan has identified the Arena invitation. Tarin remains missing.'); } },
    ]);
  }

  update(dt: number, alive: boolean): void {
    const hero = this.opts.controller.position;
    // One boundary across the approach, including paths around the visible registrar.
    if (!this.complete && hero.x > 51) this.opts.controller.place(51, hero.y, hero.z);
    const f = this.api.snapshot?.state.flags;
    if (this.seated && hero.distanceTo(new Vector3(M.seat.x, M.seat.y, M.seat.z)) > 1) this.seated = false;
    if (this.wasAlive && !alive) {
      this.seated = false; this.ambushing = false; this.deathPending = true; this.close();
      this.routePoint = M.route.length - 1;
      const checkpoint = f?.mission_1a_complete ? M.hall : M.checkpoint;
      this.neri.position.set(checkpoint.x - 2, checkpoint.y, checkpoint.z);
    }
    if (!this.wasAlive && alive) this.deathPending = false;
    this.wasAlive = alive;
    const escort = f?.neri_search_accepted && !f.ambush_survived && !this.ambushing && alive && !this.deathPending;
    if (escort && !this.panel && !this.busy) {
      const target = M.route[this.routePoint];
      if (target) {
        this.routeTarget.set(target.x, target.y, target.z);
        const distance = this.neri.position.distanceTo(this.routeTarget);
        if (distance < 0.3) this.routePoint++;
        else if (hero.distanceTo(this.neri.position) < 10) {
          this.neri.position.lerp(this.routeTarget, Math.min(1, dt * 1.6 / distance));
          this.neri.pose('walk');
        } else this.neri.pose('idle');
      } else if (hero.distanceTo(this.neri.position) < 7) {
        this.ambushing = true;
        if (!this.api.online) {
          this.show('Neri', 'Reconnect to the shared world to continue the search.', [{ label: 'Reconnect', run: () => { const u = new URL(location.href); u.searchParams.set('online', '1'); location.assign(u.href); } }, { label: 'Return later', run: () => { this.close(); this.ambushing = false; } }]);
        } else void this.event('start_ambush').then(() => {
          this.neri.position.set(M.cover.x, 0, M.cover.z); this.neri.pose('cower', 'idle');
          this.opts.notice('Robbers on the road. Neri is taking cover.');
        }).catch(error => { this.opts.notice((error as Error).message); this.ambushing = false; });
      }
    }
    if (f?.ambush_survived && !f.mission_1a_complete) {
      this.routeTarget.set(M.cover.x - 2, M.cover.y, M.cover.z - 3);
      const distance = this.neri.position.distanceTo(this.routeTarget);
      if (distance > 0.2) { this.neri.position.lerp(this.routeTarget, Math.min(1, dt * 1.6 / distance)); this.neri.pose('walk'); }
      else this.neri.pose('idle');
    }
    else if (this.ambushing) this.neri.pose('cower', 'idle');
    if (f?.meal_eaten && !f.neri_met && !f.neri_search_accepted) {
      const target = this.returnAt > performance.now() ? { x: 124, y: 0, z: 4 } : { x: M.seat.x + 1.5, y: M.seat.y, z: M.seat.z };
      this.routeTarget.set(target.x, target.y, target.z);
      const distance = this.neri.position.distanceTo(this.routeTarget);
      if (distance > 0.2) { this.neri.position.lerp(this.routeTarget, Math.min(1, dt * 1.6 / distance)); this.neri.pose('walk'); }
      else if (this.approach && !this.panel && !this.busy) { this.approach = false; this.talkNeri(); }
      else this.neri.pose(this.seated ? 'sit' : 'idle', 'idle');
    }
    if (f?.mission_1a_complete && alive && !this.panel) {
      if (!this.trail.length || this.trail[this.trail.length - 1]!.distanceTo(hero) > 1.5) this.trail.push(hero.clone());
      if (this.trail.length > 200) this.trail.shift();
      const target = this.trail[0];
      if (target && hero.distanceTo(this.neri.position) > 3) {
        const distance = this.neri.position.distanceTo(target);
        if (distance < 0.3) this.trail.shift();
        else { this.neri.position.lerp(target, Math.min(1, dt * 3 / distance)); this.neri.pose('walk'); }
      } else this.neri.pose('idle');
    }
    this.cookFacing.set(M.stallKeeper.x + Math.sin(M.stallKeeper.facing), M.stallKeeper.y, M.stallKeeper.z + Math.cos(M.stallKeeper.facing));
    this.cook.tick(dt, this.cookFacing);
    this.master.tick(dt, hero); this.kellan.tick(dt, hero);
    this.registrar.tick(dt, hero);
    this.neri.tick(dt, escort && this.routePoint < M.route.length ? this.routeTarget : hero, this.ambushing && !f?.ambush_survived);
    if (f?.neri_search_accepted && !f.invitation_identified && performance.now() > this.nextPoll && !this.polling) {
      this.nextPoll = performance.now() + 2000; this.polling = true;
      void this.api.load().catch(() => {}).finally(() => { this.polling = false; });
    }
  }

  private async event(event: MissionEvent): Promise<MissionSnapshot> {
    return this.api.choose(event);
  }

  private question(name: string, text: string, accept: string, cancel?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.show(name, text, [
        { label: accept, run: () => { this.close(); resolve(); } },
        ...(cancel ? [{ label: cancel, run: () => { this.close(); reject(new Error('Return to the registrar when you are ready.')); } }] : []),
      ]);
    });
  }

  private show(name: string, text: string, replies: Reply[]): void {
    this.close();
    this.lastFocus = document.activeElement as HTMLElement | null;
    if (document.pointerLockElement) document.exitPointerLock();
    const panel = document.createElement('section');
    panel.className = 'mission-dialogue'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', name);
    const title = document.createElement('h2'); title.textContent = name;
    const line = document.createElement('p'); line.textContent = text;
    const choices = document.createElement('div'); choices.className = 'mission-choices';
    for (const reply of replies) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'mission-choice'; button.textContent = reply.label;
      button.addEventListener('click', () => {
        if (this.busy) return;
        this.busy = true;
        for (const b of choices.querySelectorAll('button')) b.disabled = true;
        void Promise.resolve().then(() => reply.run()).catch(error => {
          let message = panel.querySelector('.mission-error');
          if (!message) { message = document.createElement('p'); message.className = 'mission-error'; message.setAttribute('role', 'alert'); panel.appendChild(message); }
          message.textContent = `${(error as Error).message} You can retry this choice.`;
        }).finally(() => { this.busy = false; for (const b of choices.querySelectorAll('button')) b.disabled = false; });
      });
      choices.appendChild(button);
    }
    panel.append(title, line, choices);
    panel.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) return;
      const first = buttons[0]!, last = buttons[buttons.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    this.panel = panel;
    document.body.classList.add('mission-open'); document.body.appendChild(panel);
    choices.querySelector('button')?.focus();
  }
  private close(): void {
    this.panel?.remove(); this.panel = null;
    document.body.classList.remove('mission-open');
    if (this.lastFocus?.isConnected) this.lastFocus.focus({ preventScroll: true });
  }

  private buildProps(): void {
    const wood = new MeshStandardMaterial({ color: 0x543728, roughness: 0.95 });
    const cover = new Mesh(new BoxGeometry(3.6, 1.5, 1.3), wood); cover.position.set(M.cover.x, 0.75, M.cover.z - 1); cover.castShadow = true; this.props.add(cover);
    const basket = new Mesh(new BoxGeometry(0.8, 0.4, 0.6), wood); basket.position.set(183, 0.25, 2.7); basket.rotation.z = 0.5; this.props.add(basket);
  }

  dispose(): void {
    this.disposed = true; this.close(); this.api.dispose(); this.registrar.dispose(); this.neri.dispose(); this.cook.dispose(); this.master.dispose(); this.kellan.dispose(); this.invitationButton.remove();
    this.opts.world.removeCollider(this.coverCollider, true);
    this.props.removeFromParent();
    const geometries = new Set<import('three').BufferGeometry>(), materials = new Set<import('three').Material>();
    this.props.traverse(node => { const mesh = node as Mesh; if (!mesh.isMesh) return; geometries.add(mesh.geometry); for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material); });
    for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
  }
}
