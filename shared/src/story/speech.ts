/**
 * Who says what, and when. A query is a concept ("talk", "fight_started") plus facts about the speaker,
 * the player and the world. Every rule for that concept whose criteria all hold is a candidate; the one
 * whose matched criteria weigh the most wins, ties broken at random. A spoken rule can write facts with
 * an expiry (cooldowns, "already said this") and hand a follow-up concept to listeners, which is checked
 * again when the line ends, so a conversation stops by itself once its conditions no longer hold.
 */

export type FactValue = string | number | boolean;
export type Facts = Readonly<Record<string, FactValue>>;

export interface Criterion {
  fact: string;
  /** Defaults to '='. A missing fact fails every test except '!='. */
  op?: '=' | '!=' | '>=' | '<=' | '>' | '<';
  value: FactValue;
  /** How much this criterion counts toward the rule's score. Defaults to 1. */
  weight?: number;
}

/** Priority, highest first: a conversation the player started, guards and fights, reactions, chatter. */
export type SpeechTier = 'conversation' | 'alert' | 'reaction' | 'ambient';
export const TIER_ORDER: readonly SpeechTier[] = ['conversation', 'alert', 'reaction', 'ambient'];

export interface RememberFact {
  fact: string;
  value?: FactValue;
  seconds: number;
  /** 'speaker' facts are read back as self.<fact>, 'world' facts as world.<fact>. Defaults to 'speaker'. */
  scope?: 'speaker' | 'world';
}

export interface FollowUp {
  concept: string;
  /** 'listeners' broadcasts to everyone in earshot, best match answers; 'self' continues the same speaker. */
  to: 'listeners' | 'self';
  facts?: Facts;
}

export interface SpeechRule {
  /** Unique, e.g. smith_sindr/greeting_dim. */
  id: string;
  concept: string;
  criteria: readonly Criterion[];
  lines: readonly string[];
  tier?: SpeechTier;
  remember?: readonly RememberFact[];
  then?: FollowUp;
}

export interface SpeechQuery {
  concept: string;
  speakerId: string;
  facts: Facts;
}

export interface SpeechResponse {
  rule: SpeechRule;
  /** The line as written in the rule, blanks not yet filled. */
  line: string;
  score: number;
  tier: SpeechTier;
  speakerId: string;
}

interface Remembered { value: FactValue; until: number }

/** Facts written by spoken rules, each with an expiry in seconds of game time, plus each speaker's last line. */
export class SpeechMemory {
  private readonly bySpeaker = new Map<string, Map<string, Remembered>>();
  private readonly world = new Map<string, Remembered>();
  private readonly lastLine = new Map<string, string>();

  remember(speakerId: string, fact: RememberFact, now: number): void {
    const store = fact.scope === 'world' ? this.world : this.speakerStore(speakerId);
    store.set(fact.fact, { value: fact.value ?? true, until: now + fact.seconds });
  }

  /** Live remembered facts for a speaker, as self.<fact> and world.<fact>. */
  factsFor(speakerId: string, now: number): Record<string, FactValue> {
    const out: Record<string, FactValue> = {};
    const read = (store: Map<string, Remembered> | undefined, prefix: string) => {
      if (!store) return;
      for (const [fact, r] of store) {
        if (r.until <= now) store.delete(fact);
        else out[prefix + fact] = r.value;
      }
    };
    read(this.bySpeaker.get(speakerId), 'self.');
    read(this.world, 'world.');
    return out;
  }

  lastLineOf(speakerId: string): string | undefined {
    return this.lastLine.get(speakerId);
  }

  setLastLine(speakerId: string, line: string): void {
    this.lastLine.set(speakerId, line);
  }

  private speakerStore(speakerId: string): Map<string, Remembered> {
    let store = this.bySpeaker.get(speakerId);
    if (!store) this.bySpeaker.set(speakerId, (store = new Map()));
    return store;
  }
}

function holds(c: Criterion, facts: Facts): boolean {
  const have = facts[c.fact];
  const op = c.op ?? '=';
  if (have === undefined) return op === '!=';
  switch (op) {
    case '=': return have === c.value;
    case '!=': return have !== c.value;
    case '>=': return have >= c.value;
    case '<=': return have <= c.value;
    case '>': return have > c.value;
    case '<': return have < c.value;
  }
}

/** Score of a rule against facts: the summed weight of its criteria, or -1 when any fails. */
export function scoreRule(rule: SpeechRule, facts: Facts): number {
  let score = 0;
  for (const c of rule.criteria) {
    if (!holds(c, facts)) return -1;
    score += c.weight ?? 1;
  }
  return score;
}

/** The rules, indexed by concept, and the matching, line choice and memory writes. */
export class SpeechRules {
  private readonly byConcept = new Map<string, SpeechRule[]>();

  constructor(rules: readonly SpeechRule[], private readonly rng: () => number = Math.random) {
    for (const rule of rules) {
      const list = this.byConcept.get(rule.concept);
      if (list) list.push(rule);
      else this.byConcept.set(rule.concept, [rule]);
    }
  }

  /** Best-scoring rule for the query, without speaking it. Null when nothing matches. */
  match(query: SpeechQuery, memory?: SpeechMemory, now = 0): { rule: SpeechRule; score: number } | null {
    const facts = memory ? { ...query.facts, ...memory.factsFor(query.speakerId, now) } : query.facts;
    let best: SpeechRule[] = [];
    let bestScore = -1;
    for (const rule of this.byConcept.get(query.concept) ?? []) {
      if (rule.lines.length === 0) continue;
      const score = scoreRule(rule, facts);
      if (score < 0 || score < bestScore) continue;
      if (score > bestScore) { best = []; bestScore = score; }
      best.push(rule);
    }
    if (best.length === 0) return null;
    return { rule: best[Math.floor(this.rng() * best.length)]!, score: bestScore };
  }

  /** Matches, picks a line that is not the speaker's last one, and writes the rule's facts to memory. */
  speak(query: SpeechQuery, memory?: SpeechMemory, now = 0): SpeechResponse | null {
    const found = this.match(query, memory, now);
    if (!found) return null;
    const { rule, score } = found;
    const last = memory?.lastLineOf(query.speakerId);
    const fresh = rule.lines.filter(l => l !== last);
    const pool = fresh.length > 0 ? fresh : rule.lines;
    const line = pool[Math.floor(this.rng() * pool.length)]!;
    if (memory) {
      memory.setLastLine(query.speakerId, line);
      for (const fact of rule.remember ?? []) memory.remember(query.speakerId, fact, now);
    }
    return { rule, line, score, tier: rule.tier ?? 'ambient', speakerId: query.speakerId };
  }

  /**
   * A broadcast: every listener is matched against the concept and the best-scoring one answers.
   * Used for follow-ups to listeners and for one event heard by a crowd ("fight started").
   */
  answer(concept: string, listeners: readonly { speakerId: string; facts: Facts }[], memory?: SpeechMemory, now = 0): SpeechResponse | null {
    let best: { speakerId: string; facts: Facts }[] = [];
    let bestScore = -1;
    for (const listener of listeners) {
      const found = this.match({ concept, ...listener }, memory, now);
      if (!found || found.score < bestScore) continue;
      if (found.score > bestScore) { best = []; bestScore = found.score; }
      best.push(listener);
    }
    if (best.length === 0) return null;
    const who = best[Math.floor(this.rng() * best.length)]!;
    return this.speak({ concept, ...who }, memory, now);
  }
}

export interface TrafficLimits {
  /** Ambient-tier voices allowed at once. */
  maxAmbient: number;
  /** Alert and reaction voices allowed at once, beside the conversation. */
  maxAlerts: number;
  /** Least time between the start of one ambient line and the next. */
  ambientGapSeconds: number;
}

interface Voice { speakerId: string; tier: SpeechTier; until: number }

/**
 * Keeps a street from talking over itself: one conversation voice, a few alerts and reactions, and a
 * capped, spaced trickle of chatter. A higher tier may cut the lowest-tier voice to make room.
 */
export class SpeechTraffic {
  private voices: Voice[] = [];
  private lastAmbientStart = -Infinity;

  constructor(private readonly limits: TrafficLimits) {}

  /** Asks to start a line. Returns the speakers it cut off (empty when none), or null when refused. */
  request(speakerId: string, tier: SpeechTier, seconds: number, now: number): string[] | null {
    this.voices = this.voices.filter(v => v.until > now && v.speakerId !== speakerId);
    const cut: string[] = [];
    if (tier === 'conversation') {
      for (const v of this.voices) if (v.tier === 'conversation') cut.push(v.speakerId);
    } else if (tier === 'ambient') {
      if (now - this.lastAmbientStart < this.limits.ambientGapSeconds) return null;
      if (this.count('ambient') >= this.limits.maxAmbient) return null;
    } else if (this.count('alert') + this.count('reaction') >= this.limits.maxAlerts) {
      // Room only by cutting a lower-priority alert-class voice: an alert may cut a reaction.
      const rank = TIER_ORDER.indexOf(tier);
      const lower = this.voices.find(v => (v.tier === 'alert' || v.tier === 'reaction') && TIER_ORDER.indexOf(v.tier) > rank);
      if (!lower) return null;
      cut.push(lower.speakerId);
    }
    this.voices = this.voices.filter(v => !cut.includes(v.speakerId));
    this.voices.push({ speakerId, tier, until: now + seconds });
    if (tier === 'ambient') this.lastAmbientStart = now;
    return cut;
  }

  /** The speaker stopped early (walked off, conversation closed). */
  end(speakerId: string): void {
    this.voices = this.voices.filter(v => v.speakerId !== speakerId);
  }

  speaking(now: number): readonly string[] {
    return this.voices.filter(v => v.until > now).map(v => v.speakerId);
  }

  private count(tier: SpeechTier): number {
    return this.voices.reduce((n, v) => n + (v.tier === tier ? 1 : 0), 0);
  }
}
