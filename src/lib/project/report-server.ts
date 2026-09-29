import 'server-only';

/**
 * The project section of a Full analysis (Batch 17, Part F), server side:
 * our estimate for a Project deal's report when the report is saved, and
 * the viewer's own locked figures when a report is read. Those are never
 * stored on the report: a teammate who can read it sees their own locked
 * figures, or none, never another member's.
 */
import type { createAdminClient } from '../supabase/admin';
import type { FinanceDefaults } from '../listing/deal';
import { projectColumnsFor, projectEstimateFor } from './read-server';
import { lockedFiguresFor } from './member-figures-server';
import { profitAfterWorksPcm } from './finance';
import { reportProjectFrom, reportProjectMineFrom, type ReportProject, type ReportProjectMine } from './report';

type Admin = ReturnType<typeof createAdminClient>;

/** Our estimate for a Full analysis of this deal; null unless it is a Project deal with its estimate. */
export async function reportProjectFor(admin: Admin, deal: { id: string; canonical_url: string; bedrooms: number | null }, income: { grossRevenue: number | null }, finance: Partial<FinanceDefaults> | null | undefined): Promise<ReportProject | null> {
  try {
    const card = (await projectColumnsFor(admin, [deal.canonical_url])).get(deal.canonical_url)?.project ?? null;
    if (!card) return null;
    const stored = await projectEstimateFor(admin, deal.id);
    if (!stored) return null;
    const e = stored.estimate;
    const gross = income.grossRevenue;
    const profit = gross !== null && Number.isFinite(gross) && gross > 0 ? profitAfterWorksPcm({ level: e.level, price: e.finance.price, value: e.value.value, bedrooms: deal.bedrooms ?? card.bedrooms, grossRevenue: gross, finance, refinancePct: e.finance.refinance?.pct }) : null;
    return reportProjectFrom(e, stored.estimatedAt, profit);
  } catch (err) {
    // A report without its project section beats no report.
    console.error('[project] report section failed:', (err as Error)?.message ?? err);
    return null;
  }
}

/** The viewer's locked figures on this deal, for the report they are reading; null without. */
export async function reportProjectMineFor(admin: Admin, userId: string, dealId: string): Promise<ReportProjectMine | null> {
  const w = (await lockedFiguresFor(admin, userId, [dealId])).get(dealId);
  if (!w?.figures) return null;
  return reportProjectMineFrom(w.figures, w.version, w.createdAt);
}
