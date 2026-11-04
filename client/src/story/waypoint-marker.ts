import {
  Camera,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Lead } from '../../../shared/src/story/leads.js';

export class WaypointMarker {
  private group = new Group();
  private beaconMesh: Mesh;
  private ringMesh: Mesh;
  private activeLead: Lead | null = null;
  private hudElement: HTMLElement;

  constructor(private scene: Scene) {
    const beaconMat = new MeshBasicMaterial({
      color: 0xffaa22,
      transparent: true,
      opacity: 0.55,
      side: DoubleSide,
    });
    this.beaconMesh = new Mesh(new CylinderGeometry(0.12, 0.6, 24, 16), beaconMat);
    this.beaconMesh.position.y = 12;
    this.group.add(this.beaconMesh);

    const ringMat = new MeshBasicMaterial({
      color: 0xffc844,
      transparent: true,
      opacity: 0.8,
      side: DoubleSide,
    });
    this.ringMesh = new Mesh(new RingGeometry(1.2, 1.8, 24).rotateX(-Math.PI / 2), ringMat);
    this.ringMesh.position.y = 0.05;
    this.group.add(this.ringMesh);

    this.group.visible = false;
    this.scene.add(this.group);

    // Screen HUD Waypoint indicator
    this.hudElement = document.createElement('div');
    this.hudElement.id = 'lead-waypoint-hud';
    this.hudElement.className = 'lead-marker-hud';
    this.hudElement.style.display = 'none';
    document.body.appendChild(this.hudElement);
  }

  setLead(lead: Lead | null): void {
    this.activeLead = lead;
    if (lead && !lead.completed) {
      this.group.position.set(lead.target.x, lead.target.y, lead.target.z);
      this.group.visible = true;
      this.hudElement.style.display = 'block';
    } else {
      this.group.visible = false;
      this.hudElement.style.display = 'none';
    }
  }

  update(delta: number, camera: Camera, playerPos: Vector3): void {
    if (!this.activeLead || this.activeLead.completed || !this.group.visible) {
      this.hudElement.style.display = 'none';
      return;
    }

    // Pulse beacon and rotate ring
    this.ringMesh.rotation.z += delta * 1.5;

    const targetPos = new Vector3(this.activeLead.target.x, this.activeLead.target.y + 1.5, this.activeLead.target.z);
    const dist = Math.round(playerPos.distanceTo(targetPos));

    // Project 3D position to 2D screen coordinates
    const screenPos = targetPos.clone().project(camera);
    const isBehind = screenPos.z > 1.0;

    const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-(screenPos.y * 0.5) + 0.5) * window.innerHeight;

    if (!isBehind && screenPos.z < 1.0) {
      this.hudElement.style.display = 'block';
      this.hudElement.style.left = `${Math.max(20, Math.min(window.innerWidth - 180, x - 80))}px`;
      this.hudElement.style.top = `${Math.max(40, Math.min(window.innerHeight - 80, y - 40))}px`;
      this.hudElement.innerHTML = `
        <div class="lead-marker-badge">
          <span class="lead-marker-title">${this.activeLead.title}</span>
          <span class="lead-marker-dist">${dist}m</span>
        </div>
      `;
    } else {
      // Off-screen indicator pinned to top of screen
      this.hudElement.style.display = 'block';
      this.hudElement.style.left = `${window.innerWidth / 2 - 80}px`;
      this.hudElement.style.top = '30px';
      this.hudElement.innerHTML = `
        <div class="lead-marker-badge offscreen">
          <span class="lead-marker-title">${this.activeLead.title}</span>
          <span class="lead-marker-dist">${dist}m</span>
        </div>
      `;
    }
  }

  dispose(): void {
    this.hudElement.remove();
    this.group.clear();
    this.scene.remove(this.group);
  }
}
