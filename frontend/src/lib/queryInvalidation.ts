import type { QueryClient } from '@tanstack/react-query';

/**
 * Call this from every mutation that changes a transaction's amount, category, or
 * FY-relevance, so both financial-report widgets invalidate together — Dashboard's
 * Spend by Category card and Reports.tsx's spending tab share this pair of query keys,
 * and a mutation that only invalidates one leaves the other silently stale.
 *
 * NOT YET a closed invariant: as of the quick-add task, this is called by
 * AddTransactionModal's create mutation and the SIP/insurance-link/refund-link
 * mutations in Transactions.tsx, but NOT by editMutation, deleteMutation,
 * convertMutation (transfer), importMutation, or RecurringRules' apply/generate
 * mutations — those still only invalidate transactions/loans/budgets. Don't treat
 * "every mutation" as already true; it's the target, not the current state.
 */
export function invalidateFinancialReports(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['profit-and-loss'] });
  qc.invalidateQueries({ queryKey: ['report-spending'] });
}
