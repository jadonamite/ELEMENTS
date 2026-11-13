import type { DatabaseSync } from 'node:sqlite';
import {
  type AgentGuidance,
  type DailyChronicle,
  type DailyJudgeReport,
  GAME_HOUR_MS,
  cleanLine,
  speaksBanished,
} from '@elements/shared';
import { getDatabase, getMerchantMindHistory } from '../../../db.js';
import { getDailyJudgeReportByDay, getLatestDailyJudgeReport, saveDailyJudgeReport } from '../db.js';
import { keepersIn, mindPlaces } from '../minds.js';
import { parseModelJson } from '../plans/agentPlan.js';
import type { ModelRouter } from '../router/modelRouter.js';

const DAY_MS = 24 * GAME_HOUR_MS;

/** The game day a moment falls in, counted from the first day this world kept a report. */
export function economyDayNumber(now: number, db: DatabaseSync = getDatabase()): number {
  const latest = getLatestDailyJudgeReport(db);
  const today = Math.floor(now / DAY_MS);
  if (!latest) return 1;
  const latestDay = Math.floor(latest.timestamp / DAY_MS);
  return latest.dayNumber + Math.max(0, today - latestDay);
}

/** The day's trade: coin moved through the ledger since the day began. */
function dayActivity(now: number, db: DatabaseSync): { totalTransactions: number; totalVolumeChroma: number } {
  const since = Math.floor(now / DAY_MS) * DAY_MS;
  const row = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS v FROM ledger_entries WHERE timestamp >= ? AND timestamp <= ?')
    .get(since, now) as { n: number; v: number } | undefined;
  return { totalTransactions: Number(row?.n ?? 0), totalVolumeChroma: Number(row?.v ?? 0) };
}

const allKeepers = () => mindPlaces().flatMap((p) => keepersIn(p));

export function createDeterministicChronicle(dayNumber: number, now: number, totalTransactions: number, totalVolumeChroma: number): DailyChronicle {
  const headline =
    totalVolumeChroma > 5000
      ? `Brisk trade as ${totalVolumeChroma.toLocaleString('en-US')} CHROMA changes hands`
      : `An even day in the market: ${totalVolumeChroma.toLocaleString('en-US')} CHROMA recorded`;
  return {
    dayNumber,
    title: `The Sindr Chronicle, day ${dayNumber}`,
    headline,
    paragraphs: [
      `The square hummed from first bell to dusk. Carts came in under light escort and the counting-house scribes noted ${totalTransactions} payments across the town.`,
      "The keepers held to the Lord's price rules through the day's swings, and the tribute was gathered as the shadows lengthened.",
    ],
    shortNotices: [
      'The watch reminds all: unbanked coin draws eyes in the alleys after dark.',
      'The Raid Hall appraises salvage daily at its door.',
      'Keep blades sheathed near the counting houses.',
    ],
    writtenAt: now,
  };
}

/** A report for a day with no judge verdicts yet: the chronicle alone, or the written one. */
export function createDeterministicJudgeReport(dayNumber: number, now: number, totalTransactions: number, totalVolumeChroma: number): DailyJudgeReport {
  return {
    dayNumber,
    date: new Date(now).toISOString().slice(0, 10),
    totalTransactions,
    totalVolumeChroma,
    chronicle: createDeterministicChronicle(dayNumber, now, totalTransactions, totalVolumeChroma),
    agentGuidance: {},
    timestamp: now,
  };
}

function saveMerged(dayNumber: number, now: number, db: DatabaseSync, patch: Partial<DailyJudgeReport>): DailyJudgeReport {
  const activity = dayActivity(now, db);
  const base = getDailyJudgeReportByDay(dayNumber, db) ?? createDeterministicJudgeReport(dayNumber, now, activity.totalTransactions, activity.totalVolumeChroma);
  const report: DailyJudgeReport = { ...base, ...activity, ...patch, dayNumber, timestamp: now };
  saveDailyJudgeReport(report, db);
  return report;
}

/** A chronicle from a model, kept only if it is complete and speaks no banished name. */
function acceptChronicle(raw: Partial<DailyChronicle> | undefined, fallback: DailyChronicle): DailyChronicle | null {
  if (!raw || typeof raw.title !== 'string' || typeof raw.headline !== 'string' || !Array.isArray(raw.paragraphs)) return null;
  const paragraphs = raw.paragraphs.filter((p): p is string => typeof p === 'string' && p.trim().length > 0 && !speaksBanished(p)).slice(0, 3);
  if (paragraphs.length === 0) return null;
  const notices = (Array.isArray(raw.shortNotices) ? raw.shortNotices : [])
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0 && !speaksBanished(n))
    .slice(0, 3);
  return {
    ...fallback,
    title: cleanLine(raw.title.slice(0, 80), fallback.title),
    headline: cleanLine(raw.headline.slice(0, 140), fallback.headline),
    paragraphs,
    shortNotices: notices.length > 0 ? notices : fallback.shortNotices,
  };
}

/**
 * The evening chronicle for the notice board, written on the free providers from the day's trade and what the
 * keepers thought. Falls back to the written chronicle; never blocks.
 */
export async function runEveningChronicle(options: { router: ModelRouter; db?: DatabaseSync; now?: number }): Promise<{ report: DailyJudgeReport; source: string }> {
  const now = options.now ?? Date.now();
  const db = options.db ?? getDatabase();
  const dayNumber = economyDayNumber(now, db);
  const activity = dayActivity(now, db);
  const fallback = createDeterministicChronicle(dayNumber, now, activity.totalTransactions, activity.totalVolumeChroma);
  const keepers = allKeepers().map((k) => ({ name: k.name, shop: k.merchant?.name, thought: getMerchantMindHistory(k.id, 1, db)?.latestThought }));

  const result = await options.router.route({
    intent: 'chronicle',
    messages: [
      {
        role: 'system',
        content: [
          "You write the evening chronicle pinned to the notice board of Sindr, a forge town under the Lord's Edict, which banished the old names of the elements.",
          'Write in the town voice: a title, a headline, 2 short paragraphs and 3 short notices, from the numbers and the keepers given. Name keepers, never travellers.',
          'Never use the words fire, flame, water, earth, air or wind: say Crimson, Azure, Ochre, Pale, embers, hearth or brazier.',
          'Reply with JSON only: { "title": "", "headline": "", "paragraphs": ["", ""], "shortNotices": ["", "", ""] }',
        ].join(' '),
      },
      { role: 'user', content: JSON.stringify({ dayNumber, ...activity, keepers }) },
    ],
    responseFormat: { type: 'json_object' },
  });

  const chronicle = acceptChronicle(parseModelJson<Partial<DailyChronicle>>(result?.content) ?? undefined, fallback);
  const report = saveMerged(dayNumber, now, db, { chronicle: chronicle ?? fallback });
  return { report, source: chronicle && result ? `${result.provider}:${result.model}` : 'written' };
}

let judgeOffLogged = false;

/**
 * The daily judge, on NEAR AI only: scores each keeper and leaves a directive for tomorrow's plans. When NEAR AI
 * has no key or has refused the account, the judge stays off: one log line, no calls, yesterday's directives
 * stand.
 */
export async function runDailyJudge(options: { router: ModelRouter; db?: DatabaseSync; now?: number; log?: (line: string) => void }): Promise<DailyJudgeReport | null> {
  const now = options.now ?? Date.now();
  const db = options.db ?? getDatabase();
  const log = options.log ?? ((line: string) => console.log(`[judge] ${line}`));
  const { router } = options;

  if (!router.judgeAvailable()) {
    if (!judgeOffLogged) {
      log(`daily judge off: ${router.offReason('nearai') ?? 'no NEAR_AI_API_KEY'}`);
      judgeOffLogged = true;
    }
    return null;
  }

  const dayNumber = economyDayNumber(now, db);
  const keepers = allKeepers();
  const activity = dayActivity(now, db);
  const result = await router.route({
    intent: 'judge',
    messages: [
      {
        role: 'system',
        content: [
          'You are the daily judge of the shopkeepers of Sindr. Score each keeper 0 to 100 on prudent trade and staying in character, and give one short directive for tomorrow.',
          'Directives guide plans only; they cannot change prices or rules.',
          'Reply with JSON only: { "agentGuidance": { "<id>": { "verdict": "", "score": 80, "directive": "" } } }',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          dayNumber,
          ...activity,
          keepers: keepers.map((k) => ({ id: k.id, name: k.name, character: k.character, latestThought: getMerchantMindHistory(k.id, 1, db)?.latestThought })),
        }),
      },
    ],
    responseFormat: { type: 'json_object' },
  });

  const parsed = parseModelJson<{ agentGuidance?: Record<string, Partial<AgentGuidance>> }>(result?.content)?.agentGuidance;
  if (!parsed) {
    if (result === null && !router.judgeAvailable() && !judgeOffLogged) {
      log(`daily judge off: ${router.offReason('nearai') ?? 'refused'}`);
      judgeOffLogged = true;
    }
    return null;
  }
  const agentGuidance: Record<string, AgentGuidance> = {};
  for (const k of keepers) {
    const raw = parsed[k.id];
    if (!raw || typeof raw.directive !== 'string' || speaksBanished(raw.directive)) continue;
    agentGuidance[k.id] = {
      agentId: k.id,
      verdict: typeof raw.verdict === 'string' ? cleanLine(raw.verdict.slice(0, 200), 'Judged.') : 'Judged.',
      score: typeof raw.score === 'number' ? Math.max(0, Math.min(100, Math.round(raw.score))) : 50,
      directive: raw.directive.slice(0, 200),
    };
  }
  log(`judged ${Object.keys(agentGuidance).length} keepers on ${result?.provider}/${result?.model}`);
  return saveMerged(dayNumber, now, db, { agentGuidance });
}

/** Lets the judge log its "off" line again (tests). */
export function resetJudgeLog(): void {
  judgeOffLogged = false;
}
