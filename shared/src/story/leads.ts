export interface LeadTarget {
  x: number;
  y: number;
  z: number;
  radius: number;
  name: string;
  locationName: string;
}

export interface Lead {
  id: string;
  title: string;
  description: string;
  cost: number;
  target: LeadTarget;
  rewardChroma: number;
  purchased: boolean;
  completed: boolean;
}

export const SINDR_LEADS: Lead[] = [
  {
    id: 'lead_slag_barrens_cache',
    title: 'Slag Barrens Cache',
    description: 'An abandoned caravan cart was left near the edge of the Slag Barrens. Shards and tools remain in the ash.',
    cost: 15,
    target: {
      x: 460,
      y: 0.5,
      z: 12,
      radius: 6,
      name: 'Caravan Wreck',
      locationName: 'Slag Barrens Edge',
    },
    rewardChroma: 45,
    purchased: false,
    completed: false,
  },
  {
    id: 'lead_gorge_watchpost',
    title: 'Gorge Road Watchpost',
    description: 'A deserted lookout post overlooking the narrow defile of the Gorge Road. Deserters were seen caching weapons.',
    cost: 15,
    target: {
      x: 310,
      y: 1.0,
      z: -16,
      radius: 6,
      name: 'Old Watchpost',
      locationName: 'Gorge Road',
    },
    rewardChroma: 50,
    purchased: false,
    completed: false,
  },
  {
    id: 'lead_east_fort_lockbox',
    title: 'East Fort Lockbox',
    description: 'A courier dropped a sealed lockbox in the crags outside the East Border Fort before the patrols caught up.',
    cost: 20,
    target: {
      x: 672,
      y: 0.5,
      z: -10,
      radius: 8,
      name: 'Lost Lockbox',
      locationName: 'East Border Fort Gate',
    },
    rewardChroma: 70,
    purchased: false,
    completed: false,
  },
];

export class LeadManager {
  private leads: Map<string, Lead> = new Map();
  activeLeadId: string | null = null;

  constructor(initialLeads: Lead[] = SINDR_LEADS) {
    for (const lead of initialLeads) {
      this.leads.set(lead.id, { ...lead });
    }
  }

  getAvailableLeads(): Lead[] {
    return Array.from(this.leads.values()).filter(l => !l.purchased && !l.completed);
  }

  getPurchasedLeads(): Lead[] {
    return Array.from(this.leads.values()).filter(l => l.purchased && !l.completed);
  }

  getActiveLead(): Lead | null {
    if (!this.activeLeadId) {
      const purchased = this.getPurchasedLeads();
      return purchased.length > 0 ? purchased[0]! : null;
    }
    return this.leads.get(this.activeLeadId) ?? null;
  }

  purchaseLead(id: string): Lead | null {
    const lead = this.leads.get(id);
    if (!lead || lead.purchased) return null;
    lead.purchased = true;
    this.activeLeadId = lead.id;
    return lead;
  }

  checkTargetReached(x: number, z: number): Lead | null {
    const active = this.getActiveLead();
    if (!active || active.completed) return null;
    const dist = Math.hypot(x - active.target.x, z - active.target.z);
    if (dist <= active.target.radius) {
      active.completed = true;
      if (this.activeLeadId === active.id) {
        this.activeLeadId = null;
      }
      return active;
    }
    return null;
  }
}
