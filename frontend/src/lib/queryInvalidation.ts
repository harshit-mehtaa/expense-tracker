import type { QueryClient } from '@tanstack/react-query';

/**
 * Call this from every mutation that changes a transaction's amount, category, or
 * FY-relevance, so both financial-report widgets invalidate together — Dashboard's
 * Spend by Category card and Reports.tsx's spending tab share this pair of query keys,
 * and a mutation that only invalidates one leaves the other silently stale.
 */
export function invalidateFinancialReports(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['profit-and-loss'] });
  qc.invalidateQueries({ queryKey: ['report-spending'] });
}

/**
 * Call this from every mutation that creates, edits, or deletes a transaction (directly
 * or via import/bulk/recurring-generate), so Dashboard, Reports, and — when the
 * mutation can move money or touch a loan — Accounts/Loans all invalidate together.
 *
 * `['budgets']` and `['budgets-actuals']` are TWO DIFFERENT top-level query keys, not
 * one prefix-matched family: `useBudgetsVsActuals.ts` reads `['budgets', 'vs-actuals',
 * ...]` (Dashboard's widget), but `Budgets.tsx`'s own page reads `['budgets-actuals',
 * ...]` — invalidating only `['budgets']` leaves the standalone Budgets page silently
 * stale. This was caught by review after 8 call sites had already copy-pasted a
 * `['budgets']`-only block, one of the exact "duplication causes drift" bugs a shared
 * helper exists to prevent — hence this helper, not another inline copy.
 *
 * `includeAccountsAndLoans` defaults to true. Pass `false` only when the mutation
 * structurally cannot move money or touch a loan (e.g. a categoryId-only PUT) — verify
 * against the backend service's actual gating logic before doing so, don't assume.
 */
export function invalidateTransactionMutationCaches(
  qc: QueryClient,
  { includeAccountsAndLoans = true }: { includeAccountsAndLoans?: boolean } = {},
) {
  qc.invalidateQueries({ queryKey: ['transactions'] });
  qc.invalidateQueries({ queryKey: ['budgets'] });
  qc.invalidateQueries({ queryKey: ['budgets-actuals'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  invalidateFinancialReports(qc);
  if (includeAccountsAndLoans) {
    qc.invalidateQueries({ queryKey: ['accounts'] });
    qc.invalidateQueries({ queryKey: ['loans'] });
  }
}
