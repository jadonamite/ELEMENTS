import type { DatabaseSync } from 'node:sqlite';
import type { AgentPlan, DailyJudgeReport } from '@elements/shared';
import { getDatabase } from '../../db.js';

export function ensureAgentTables(db: DatabaseSync = getDatabase()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_plans (
      agent_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, phase)
    );

    CREATE TABLE IF NOT EXISTS daily_judge_reports (
      day_number INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      report_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function saveAgentPlan(
  agentId: string,
  plan: AgentPlan,
  db: DatabaseSync = getDatabase(),
): void {
  ensureAgentTables(db);
  db.prepare(
    `INSERT INTO agent_plans (agent_id, phase, plan_json, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(agent_id, phase) DO UPDATE SET
       plan_json = excluded.plan_json,
       created_at = excluded.created_at`,
  ).run(agentId, plan.phase, JSON.stringify(plan), plan.createdAt);
}

export function getAgentPlan(
  agentId: string,
  phase: string,
  db: DatabaseSync = getDatabase(),
): AgentPlan | null {
  ensureAgentTables(db);
  const row = db
    .prepare('SELECT plan_json FROM agent_plans WHERE agent_id = ? AND phase = ?')
    .get(agentId, phase) as { plan_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.plan_json) as AgentPlan;
  } catch {
    return null;
  }
}

export function getLatestAgentPlan(
  agentId: string,
  db: DatabaseSync = getDatabase(),
): AgentPlan | null {
  ensureAgentTables(db);
  const row = db
    .prepare('SELECT plan_json FROM agent_plans WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(agentId) as { plan_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.plan_json) as AgentPlan;
  } catch {
    return null;
  }
}

export function saveDailyJudgeReport(
  report: DailyJudgeReport,
  db: DatabaseSync = getDatabase(),
): void {
  ensureAgentTables(db);
  db.prepare(
    `INSERT INTO daily_judge_reports (day_number, date, report_json, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day_number) DO UPDATE SET
       date = excluded.date,
       report_json = excluded.report_json,
       created_at = excluded.created_at`,
  ).run(report.dayNumber, report.date, JSON.stringify(report), report.timestamp);
}

export function getLatestDailyJudgeReport(
  db: DatabaseSync = getDatabase(),
): DailyJudgeReport | null {
  ensureAgentTables(db);
  const row = db
    .prepare('SELECT report_json FROM daily_judge_reports ORDER BY day_number DESC LIMIT 1')
    .get() as { report_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.report_json) as DailyJudgeReport;
  } catch {
    return null;
  }
}

export function getDailyJudgeReportByDay(
  dayNumber: number,
  db: DatabaseSync = getDatabase(),
): DailyJudgeReport | null {
  ensureAgentTables(db);
  const row = db
    .prepare('SELECT report_json FROM daily_judge_reports WHERE day_number = ?')
    .get(dayNumber) as { report_json: string } | undefined;

  if (!row) return null;
  try {
    return JSON.parse(row.report_json) as DailyJudgeReport;
  } catch {
    return null;
  }
}
