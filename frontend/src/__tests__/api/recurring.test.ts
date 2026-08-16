/**
 * Tests for the recurring-rules API wrappers.
 *
 * fetchRecurringRules is the odd one out: it string-concatenates `?targetUserId=` onto
 * the path while every sibling passes an axios params object. That divergence is exactly
 * the shape that silently sends one member's request scoped to another, so both forms are
 * asserted on the wire here.
 */
import { describe, it, expect } from 'vitest';
import {
  fetchRecurringRules,
  createRecurringRule,
  updateRecurringRule,
  deleteRecurringRule,
  triggerGenerate,
  type CreateRecurringRuleInput,
} from '@/api/recurring';
import { capture } from './captureRequest';

const TARGET = 'clm1234567890abcdefghij';

const INPUT: CreateRecurringRuleInput = {
  amount: 125000,
  type: 'EXPENSE',
  description: 'Monthly rent',
  frequency: 'MONTHLY',
  categoryId: 'cat-rent',
};

describe('fetchRecurringRules — path-concatenated scoping', () => {
  it('appends ?targetUserId when a member is selected', async () => {
    const c = capture('get', '/recurring', { data: [] });
    await fetchRecurringRules(TARGET);

    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
  });

  it('sends a bare path with NO query string when no member is selected', async () => {
    const c = capture('get', '/recurring', { data: [] });
    await fetchRecurringRules();

    // Not merely absent from params — the concatenation must not emit a dangling '?'.
    expect(c.seen?.params.has('targetUserId')).toBe(false);
    expect(c.seen?.url).not.toContain('?');
  });

  it('returns the rule list unwrapped', async () => {
    const rules = [{ id: 'r1', frequency: 'MONTHLY', isActive: true }];
    capture('get', '/recurring', { data: rules });
    expect(await fetchRecurringRules()).toEqual(rules);
  });
});

describe('createRecurringRule — params-object scoping', () => {
  it('sends targetUserId as a query param and the input as the body', async () => {
    const c = capture('post', '/recurring', { data: { id: 'r1' } });
    await createRecurringRule(INPUT, TARGET);

    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
    expect(c.seen?.body).toEqual(INPUT);
  });

  it('omits targetUserId when not supplied', async () => {
    const c = capture('post', '/recurring', { data: { id: 'r1' } });
    await createRecurringRule(INPUT);

    expect(c.seen?.params.has('targetUserId')).toBe(false);
    expect(c.seen?.body).toEqual(INPUT);
  });

  it('returns the created rule unwrapped', async () => {
    capture('post', '/recurring', { data: { id: 'r-new', frequency: 'MONTHLY' } });
    const created = await createRecurringRule(INPUT);
    expect(created).toEqual({ id: 'r-new', frequency: 'MONTHLY' });
  });
});

describe('updateRecurringRule / deleteRecurringRule — addressed by id', () => {
  it('PUTs to the id path with the partial body and no user param', async () => {
    const c = capture('put', '/recurring/r1', { data: { id: 'r1', isActive: false } });
    const result = await updateRecurringRule('r1', { isActive: false });

    expect(c.seen?.method).toBe('PUT');
    expect(c.seen?.url).toContain('/recurring/r1');
    expect(c.seen?.body).toEqual({ isActive: false });
    expect(c.seen?.params.has('targetUserId')).toBe(false);
    expect(result).toEqual({ id: 'r1', isActive: false });
  });

  it('supports updating frequency and nextRunDate together', async () => {
    const c = capture('put', '/recurring/r1', { data: { id: 'r1' } });
    await updateRecurringRule('r1', { frequency: 'QUARTERLY', nextRunDate: '2026-07-01' });
    expect(c.seen?.body).toEqual({ frequency: 'QUARTERLY', nextRunDate: '2026-07-01' });
  });

  it('DELETEs by id and resolves void', async () => {
    const c = capture('delete', '/recurring/r1', { data: null });
    await expect(deleteRecurringRule('r1')).resolves.toBeUndefined();

    expect(c.seen?.method).toBe('DELETE');
    expect(c.seen?.url).toContain('/recurring/r1');
  });
});

describe('triggerGenerate', () => {
  it('POSTs with targetUserId when supplied and returns the generated count', async () => {
    const c = capture('post', '/recurring/generate', { data: { generated: 3 } });
    const result = await triggerGenerate(TARGET);

    expect(c.seen?.params.get('targetUserId')).toBe(TARGET);
    expect(result).toEqual({ generated: 3 });
  });

  it('omits targetUserId when not supplied', async () => {
    const c = capture('post', '/recurring/generate', { data: { generated: 0 } });
    const result = await triggerGenerate();

    expect(c.seen?.params.has('targetUserId')).toBe(false);
    expect(result).toEqual({ generated: 0 });
  });
});
