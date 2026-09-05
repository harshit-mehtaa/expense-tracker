import React, { useId, useMemo } from 'react';
import type { TooltipProps } from 'recharts';

// ── Color palette ─────────────────────────────────────────────────────────────

export const CHART_PALETTE = {
  income: '#10b981',   // emerald-500
  expense: '#f43f5e',  // rose-500
  net: '#6366f1',      // indigo-500
  neutral: '#8b5cf6',  // violet-500
  // 12-slot categorical palette for pie / multi-series
  categorical: [
    '#6366f1', '#10b981', '#f43f5e', '#f59e0b',
    '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6',
    '#f97316', '#84cc16', '#0ea5e9', '#a78bfa',
  ],
} as const;

// ── SVG gradient defs ─────────────────────────────────────────────────────────

export interface GradientIds {
  income: string;
  expense: string;
  net: string;
}

/**
 * Hook that generates unique SVG gradient IDs and the <defs> element to inject
 * into a recharts container. Prevents ID collisions when multiple charts are
 * rendered on the same page.
 *
 * Usage:
 *   const { gradIds, GradDefs } = useChartGradients();
 *   <AreaChart>
 *     <GradDefs />
 *     <Area fill={`url(#${gradIds.income})`} ... />
 *   </AreaChart>
 */
export function useChartGradients(): { gradIds: GradientIds; GradDefs: () => React.ReactElement } {
  const uid = useId().replace(/:/g, '');
  const gradIds: GradientIds = {
    income:  `grad-income-${uid}`,
    expense: `grad-expense-${uid}`,
    net:     `grad-net-${uid}`,
  };

  // useMemo gives React a stable component reference across renders so it never
  // unmounts/remounts the <defs> subtree (which would cause gradient fill to flash).
  // gradIds values come from useId() and are stable for the component's lifetime.
  const GradDefs = useMemo(() => () => <ChartGradDefs ids={gradIds} />, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { gradIds, GradDefs };
}

/**
 * Module-level SVG gradient definitions component. Stable reference ensures React
 * never unmounts/remounts the <defs> subtree between renders, preventing gradient flash.
 */
export function ChartGradDefs({ ids }: { ids: GradientIds }): React.ReactElement {
  return (
    <defs>
      <linearGradient id={ids.income} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={CHART_PALETTE.income}  stopOpacity={0.50} />
        <stop offset="95%" stopColor={CHART_PALETTE.income}  stopOpacity={0.05} />
      </linearGradient>
      <linearGradient id={ids.expense} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={CHART_PALETTE.expense} stopOpacity={0.50} />
        <stop offset="95%" stopColor={CHART_PALETTE.expense} stopOpacity={0.05} />
      </linearGradient>
      <linearGradient id={ids.net} x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%"  stopColor={CHART_PALETTE.net}     stopOpacity={0.50} />
        <stop offset="95%" stopColor={CHART_PALETTE.net}     stopOpacity={0.05} />
      </linearGradient>
    </defs>
  );
}

// ── Custom tooltip ─────────────────────────────────────────────────────────────

interface CustomTooltipProps extends TooltipProps<number, string> {
  formatter?: (value: number) => string;
}

export function CustomTooltip({ active, payload, label, formatter }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const fmt = formatter ?? ((v: number) => v.toLocaleString('en-IN'));

  return (
    <div className="bg-card text-card-foreground border border-border rounded-xl shadow-xl px-3.5 py-2.5 text-sm min-w-[160px]">
      {label && (
        <>
          <p className="font-semibold text-foreground mb-1">{label}</p>
          <div className="border-t border-border mb-1.5" />
        </>
      )}
      <div className="space-y-1">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: (entry.color ?? entry.stroke) as string }}
              />
              {entry.name ?? (entry.dataKey as string) ?? ''}
            </span>
            <span className="font-medium tabular-nums">{fmt(entry.value ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shared axis + grid props ──────────────────────────────────────────────────

// slate-400 (#94a3b8) is legible on both light and dark backgrounds without
// requiring dynamic theme detection, since recharts SVG attrs can't use CSS vars.
export const AXIS_STYLE = {
  axisLine: false,
  tickLine: false,
  tick: { fontSize: 11, fill: '#94a3b8' }, // slate-400 — works light + dark
} as const;

export const GRID_STYLE = {
  strokeDasharray: '3 3',
  stroke: 'rgba(148, 163, 184, 0.25)', // slate-400 at 25% opacity — subtle in both modes
  vertical: false,
} as const;

// ── Category-report helpers (shared by Reports.tsx and Dashboard.tsx) ─────────

/** The two shapes this app's report endpoints actually return: a flat
 *  `categoryName` (profit-and-loss) or a nested `category.name`
 *  (spending-by-category). `PnLCategoryRow`/`SpendingByCategoryRow` in
 *  api/dashboard.ts both satisfy this structurally. */
interface ReportCategoryLike {
  categoryName?: string;
  category?: { name: string } | null;
}

interface ReportTotalLike {
  total: number;
}

/** Falls back through both response shapes this app's report endpoints return:
 *  a nested `category.name` (spending-by-category) or a flat `categoryName`
 *  (profit-and-loss). Never assume one shape — both are real API responses. */
export function reportCategoryName(item: ReportCategoryLike): string {
  return item.categoryName ?? item.category?.name ?? 'Uncategorized';
}

export function sortReportCategories<T extends ReportCategoryLike>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    reportCategoryName(a).localeCompare(reportCategoryName(b), undefined, { sensitivity: 'base' }),
  );
}

/** Top N by total (descending), then re-sorted alphabetically WITHIN that
 *  slice — correct for a legend/bar-label list where rank doesn't need to be
 *  visually obvious, wrong for a ranked leaderboard (see Dashboard.tsx's own
 *  spend-by-category widget, which deliberately does NOT use this — it needs
 *  to stay in descending-total order). */
export function topReportCategoriesByTotal<T extends ReportCategoryLike & ReportTotalLike>(items: T[], count: number): T[] {
  return sortReportCategories(
    [...items]
      .sort((a, b) => Number(b.total ?? 0) - Number(a.total ?? 0))
      .slice(0, count),
  );
}
