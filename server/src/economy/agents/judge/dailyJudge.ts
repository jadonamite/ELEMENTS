import type { DatabaseSync } from 'node:sqlite';
import {
  type DailyChronicle,
  type DailyJudgeReport,
  type AgentGuidance,
  SINDR_MERCHANTS,
} from '@elements/shared';
import { getDatabase, getMerchantMindHistory } from '../../../db.js';
import { getLedgerHistory } from '../../ledgerService.js';
import { saveDailyJudgeReport } from '../db.js';
import type { ModelRouter } from '../router/modelRouter.js';

export interface DailyJudgeOptions {
  dayNumber: number;
  router: ModelRouter;
  db?: DatabaseSync;
  now?: number;
}

export function createDeterministicChronicle(
  dayNumber: number,
  now: number,
  totalTransactions: number,
  totalVolumeChroma: number,
): DailyChronicle {
  const headline =
    totalVolumeChroma > 5000
      ? `Brisk Trading across Sindr as ${totalVolumeChroma.toLocaleString()} CHROMA Changes Hands`
      : `Even Keel in the Market: ${totalVolumeChroma.toLocaleString()} CHROMA Recorded on Day ${dayNumber}`;

  return {
    dayNumber,
    title: `The Sindr Chronicle: Day ${dayNumber}`,
    headline,
    paragraphs: [
      `The square hummed from first bell to twilight. Caravans arrived under light escort, discharging regional wares onto the flagstones while counting-house scribes noted ${totalTransactions} transactions across the district.`,
      `Merchants held steady to the price statutes, navigating demand swings without insolvencies. The Lord's tribute was gathered as the shadows lengthened, keeping the roads clear and the garrison supplied.`,
    ],
    shortNotices: [
      'Garrison reminder: unbanked coin invites unwanted eyes in the alleys after sunset.',
      'Raid Hall reports regular salvage appraisals at the western gate.',
      'Keep arms sheathed within ten paces of the counting-house entrance.',
    ],
    writtenAt: now,
  };
}

export function createDeterministicJudgeReport(
  dayNumber: number,
  now: number,
  totalTransactions: number,
  totalVolumeChroma: number,
  agentIds: string[],
): DailyJudgeReport {
  const dateStr = new Date(now).toISOString().split('T')[0] ?? `Day-${dayNumber}`;
  const chronicle = createDeterministicChronicle(
    dayNumber,
    now,
    totalTransactions,
    totalVolumeChroma,
  );

  const agentGuidance: Record<string, AgentGuidance> = {};
  for (const id of agentIds) {
    agentGuidance[id] = {
      agentId: id,
      verdict: 'Compliant with guild balance directives.',
      score: 85,
      directive:
        'Continue steady stock rotation and maintain solvent reserves above the emergency floor.',
    };
  }

  return {
    dayNumber,
    date: dateStr,
    totalTransactions,
    totalVolumeChroma,
    chronicle,
    agentGuidance,
    timestamp: now,
  };
}

export async function runDailyJudge(options: DailyJudgeOptions): Promise<DailyJudgeReport> {
  const now = options.now ?? Date.now();
  const db = options.db ?? getDatabase();
  const { dayNumber, router } = options;

  const dateStr = new Date(now).toISOString().split('T')[0] ?? `Day-${dayNumber}`;

  // Gather daily market activity
  const ledgerEntries = getLedgerHistory(undefined, 200, db);
  let totalVolumeChroma = 0;
  let totalTransactions = ledgerEntries.length;

  for (const entry of ledgerEntries) {
    totalVolumeChroma += entry.amount;
  }

  const agentSummaries: Array<{
    id: string;
    latestThought: string;
    recentActionsCount: number;
  }> = [];

  const agentIds = SINDR_MERCHANTS.map((m) => m.id);

  for (const merchantId of agentIds) {
    const history = getMerchantMindHistory(merchantId, 5, db);
    agentSummaries.push({
      id: merchantId,
      latestThought:
        history?.latestThought ?? 'Shelves balanced and trade steady across the square.',
      recentActionsCount: history?.actions.length ?? 0,
    });
  }

  // Fallback template report prepared in advance
  const fallbackReport = createDeterministicJudgeReport(
    dayNumber,
    now,
    totalTransactions,
    totalVolumeChroma,
    agentIds,
  );

  const systemPrompt = [
    'You are the World Director and Daily Judge for the realm of Sindr.',
    'Review the day market performance, merchant thoughts, and trade volume.',
    '1. Score each agent (0-100) on trade prudence and adherence to their persona.',
    '2. Issue short directive guidance per agent for tomorrow (cannot alter rules, only strategic guidance).',
    '3. Write a public Market Chronicle in the town voice with title, headline, 2 rich paragraphs, and 3 short notices for the notice board.',
    'Respond ONLY with valid JSON in this exact structure:',
    '{ "chronicle": { "title": "string", "headline": "string", "paragraphs": ["string"], "shortNotices": ["string"] }, "agentGuidance": { "agent_id": { "verdict": "string", "score": 85, "directive": "string" } } }',
  ].join(' ');

  try {
    const modelResult = await router.route({
      intent: 'judge',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: JSON.stringify({
            dayNumber,
            date: dateStr,
            totalTransactions,
            totalVolumeChroma,
            agents: agentSummaries,
          }),
        },
      ],
      responseFormat: { type: 'json_object' },
    });

    if (modelResult?.content) {
      let cleaned = modelResult.content.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
      }

      const parsed = JSON.parse(cleaned) as {
        chronicle?: Partial<DailyChronicle>;
        agentGuidance?: Record<string, Partial<AgentGuidance>>;
      };

      if (parsed.chronicle && parsed.agentGuidance) {
        const chronicle: DailyChronicle = {
          dayNumber,
          title: parsed.chronicle.title ?? fallbackReport.chronicle.title,
          headline: parsed.chronicle.headline ?? fallbackReport.chronicle.headline,
          paragraphs:
            Array.isArray(parsed.chronicle.paragraphs) && parsed.chronicle.paragraphs.length > 0
              ? parsed.chronicle.paragraphs
              : fallbackReport.chronicle.paragraphs,
          shortNotices:
            Array.isArray(parsed.chronicle.shortNotices) && parsed.chronicle.shortNotices.length > 0
              ? parsed.chronicle.shortNotices
              : fallbackReport.chronicle.shortNotices,
          writtenAt: now,
        };

        const agentGuidance: Record<string, AgentGuidance> = {};
        for (const id of agentIds) {
          const raw = parsed.agentGuidance[id];
          agentGuidance[id] = {
            agentId: id,
            verdict: raw?.verdict ?? fallbackReport.agentGuidance[id]?.verdict ?? 'Compliant.',
            score: typeof raw?.score === 'number' ? raw.score : 80,
            directive:
              raw?.directive ??
              fallbackReport.agentGuidance[id]?.directive ??
              'Maintain steady trade.',
          };
        }

        const report: DailyJudgeReport = {
          dayNumber,
          date: dateStr,
          totalTransactions,
          totalVolumeChroma,
          chronicle,
          agentGuidance,
          timestamp: now,
        };

        saveDailyJudgeReport(report, db);
        return report;
      }
    }
  } catch (err) {
    console.warn(`[DailyJudge] NEAR AI Judge call failed (${err instanceof Error ? err.message : String(err)}); using deterministic daily report.`);
  }

  // Save fallback report if model call did not return valid JSON
  saveDailyJudgeReport(fallbackReport, db);
  return fallbackReport;
}
