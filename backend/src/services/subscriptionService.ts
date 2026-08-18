import { PaymentMode, Prisma, RecurringFrequency, TransactionType } from '@prisma/client';
import prisma from '../config/prisma';
import { AppError } from '../utils/AppError';
import { ownerScopedWhere } from '../utils/resolveTargetUserId';
import { priceAsOf, currentPrice, annualisedCost } from '../utils/subscriptionPricing';

/**
 * Subscriptions — recurring paid services, with the RecurringRule that charges them.
 *
 * Single-owner, so this uses the shared `ownerScopedWhere` rather than a bespoke
 * predicate. Loans need their own because they are co-ownable; a subscription is not,
 * and borrowing a loan-shaped predicate here would imply a sharing model that does not
 * exist.
 *
 * The subscription OWNS its rule: `recurringService` refuses to mutate or delete a rule
 * carrying a `subscriptionId`, so everything that moves money for a subscription passes
 * through this file.
 */

const subscriptionInclude = {
  prices: { orderBy: { effectiveFrom: 'desc' } },
  recurringRule: {
    select: {
      id: true, frequency: true, nextRunDate: true, isActive: true,
      // How the charge is actually paid. These live on the rule because the rule is the
      // spec for every generated transaction; without them the UI could collect a
      // payment method at creation and then never show it back.
      paymentMode: true, bankAccountId: true, categoryId: true,
      bankAccount: { select: { id: true, bankName: true, accountType: true, accountNumberLast4: true } },
      category: { select: { id: true, name: true, icon: true, color: true } },
    },
  },
} as const;

export interface CreateSubscriptionInput {
  name: string;
  vendor?: string | null;
  amount: number;
  frequency: RecurringFrequency;
  startDate: string;
  nextRunDate?: string | null;
  trialEndDate?: string | null;
  cancellationUrl?: string | null;
  notes?: string | null;
  bankAccountId?: string | null;
  categoryId?: string | null;
  paymentMode?: string | null;
}

/**
 * A linked account or category must belong to the subscription's owner.
 *
 * Mirrors the bank-account check in transactionService. Without it, a member could
 * attach another member's account and the generated charge would debit it.
 */
async function assertLinkedRecordsOwned(
  userId: string,
  bankAccountId?: string | null,
  categoryId?: string | null,
) {
  if (bankAccountId) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: bankAccountId, userId }, select: { id: true },
    });
    if (!account) throw AppError.notFound('Bank account');
  }
  if (categoryId) {
    // Categories may be global (userId null) or personal; a personal one must be theirs.
    const category = await prisma.category.findFirst({
      where: { id: categoryId, OR: [{ userId }, { userId: null }] }, select: { id: true },
    });
    if (!category) throw AppError.notFound('Category');
  }
}

/**
 * Spend-derived metrics.
 *
 * These describe BILLING, not engagement: a Netflix charge says nothing about whether
 * anyone watched it. What they do answer is "am I being charged what I think I am" —
 * `priceMismatch` flags a real charge that does not match the price on record, which is
 * usually a rise nobody got round to entering.
 */
function deriveUsage(
  transactions: { amount: Prisma.Decimal; date: Date }[],
  prices: { amount: number; effectiveFrom: Date }[],
) {
  if (!transactions.length) {
    return {
      chargeCount: 0,
      totalPaid: 0,
      averageCharge: 0,
      firstChargeDate: null as Date | null,
      lastChargeDate: null as Date | null,
      priceMismatch: null as null | { date: Date; charged: number; expected: number },
    };
  }

  const sorted = [...transactions].sort((a, b) => a.date.getTime() - b.date.getTime());
  const totalPaid = sorted.reduce((sum, t) => sum + Number(t.amount), 0);

  // Walk newest-first and report the most recent disagreement, which is the one worth
  // acting on — older ones are usually the same unrecorded rise seen again.
  let priceMismatch: null | { date: Date; charged: number; expected: number } = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const charge = sorted[i];
    const expected = priceAsOf(prices, charge.date);
    if (expected === null) continue;
    const charged = Number(charge.amount);
    // Paisa tolerance: a rounded charge is not a price change.
    if (Math.abs(charged - expected) > 0.01) {
      priceMismatch = { date: charge.date, charged, expected };
      break;
    }
  }

  return {
    chargeCount: sorted.length,
    totalPaid: Math.round(totalPaid * 100) / 100,
    averageCharge: Math.round((totalPaid / sorted.length) * 100) / 100,
    firstChargeDate: sorted[0].date,
    lastChargeDate: sorted[sorted.length - 1].date,
    priceMismatch,
  };
}

type SubscriptionRow = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;

function decorate(
  subscription: SubscriptionRow,
  transactions: { amount: Prisma.Decimal; date: Date }[] = [],
) {
  const prices = subscription.prices.map((p) => ({
    amount: Number(p.amount),
    effectiveFrom: p.effectiveFrom,
  }));
  const price = currentPrice(prices);
  const frequency = subscription.recurringRule?.frequency;

  return {
    ...subscription,
    prices: subscription.prices.map((p) => ({ ...p, amount: Number(p.amount) })),
    currentPrice: price,
    annualisedCost: price !== null && frequency ? annualisedCost(price, frequency) : null,
    nextRenewalDate: subscription.recurringRule?.nextRunDate ?? null,
    usage: deriveUsage(transactions, prices),
  };
}

export async function listSubscriptions(userId?: string) {
  const subscriptions = await prisma.subscription.findMany({
    where: userId ? { userId, deletedAt: null } : { deletedAt: null },
    include: subscriptionInclude,
    orderBy: { createdAt: 'desc' },
  });

  if (!subscriptions.length) return [];

  // One grouped query rather than one per subscription — the list is unbounded and a
  // per-row query would be an N+1 that grows with the user's history.
  const charges = await prisma.transaction.findMany({
    where: {
      subscriptionId: { in: subscriptions.map((s) => s.id) },
      deletedAt: null,
      // No template exclusion needed: a rule's spec lives on the rule itself now, so
      // nothing scaffolding-shaped is in the ledger. The previous `isRecurring: false`
      // filter was also subtly wrong — routes/transactions.ts lets a user set that flag
      // on a genuine transaction, so it hid real charges.
    },
    select: { subscriptionId: true, amount: true, date: true },
  });

  const bySubscription = new Map<string, { amount: Prisma.Decimal; date: Date }[]>();
  for (const charge of charges) {
    if (!charge.subscriptionId) continue;
    const list = bySubscription.get(charge.subscriptionId) ?? [];
    list.push({ amount: charge.amount, date: charge.date });
    bySubscription.set(charge.subscriptionId, list);
  }

  return subscriptions.map((s) => decorate(s, bySubscription.get(s.id) ?? []));
}

export async function getSubscription(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const subscription = await prisma.subscription.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    include: subscriptionInclude,
  });
  if (!subscription) return null;

  const charges = await prisma.transaction.findMany({
    where: { subscriptionId: id, deletedAt: null },
    select: { amount: true, date: true },
  });

  return decorate(subscription, charges);
}

/**
 * Creates the whole chain in one transaction: template transaction -> recurring rule ->
 * subscription -> opening price. A partial chain would be worse than no subscription at
 * all — an orphaned rule keeps charging with nothing on screen explaining why.
 *
 * A trial sets the rule's first run to the trial end date, so the engine generates
 * nothing until it converts. That needs no special case in the generator.
 */
export async function createSubscription(userId: string, data: CreateSubscriptionInput) {
  await assertLinkedRecordsOwned(userId, data.bankAccountId, data.categoryId);

  const now = new Date();
  const startDate = new Date(data.startDate);
  const trialEndDate = data.trialEndDate ? new Date(data.trialEndDate) : null;
  const isTrial = trialEndDate !== null && trialEndDate > now;

  /**
   * `startDate` is METADATA — when the user began paying for this service. It must never
   * drive billing.
   *
   * Falling back to it did: the form's only date question is "Start date", so answering
   * it honestly ("Netflix, since 2020") set the rule's nextRunDate to 2020. The scheduler
   * runs unattended every hour and catches up to MAX_CATCH_UP_PER_RULE, so within the
   * hour that silently posted ~80 real transactions across six financial years, moving
   * every report, budget and tax figure, with no warning and no undo.
   *
   * `createRecurringRule` never had this problem because it defaults to today and names
   * the field "next run date". Clamping restores that safety: billing starts today at the
   * earliest, unless the caller explicitly asks for a later date.
   */
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const firstRun = data.nextRunDate
    ? new Date(data.nextRunDate)
    : (trialEndDate && trialEndDate > startOfToday ? trialEndDate : startOfToday);

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.create({
      data: {
        userId,
        name: data.name,
        vendor: data.vendor ?? null,
        status: isTrial ? 'TRIALING' : 'ACTIVE',
        cancellationUrl: data.cancellationUrl ?? null,
        startDate,
        trialEndDate,
        notes: data.notes ?? null,
      },
    });

    // Opening price effective from the start date, so a charge on day one resolves.
    await tx.subscriptionPrice.create({
      data: {
        subscriptionId: subscription.id,
        amount: new Prisma.Decimal(data.amount),
        effectiveFrom: startDate,
      },
    });


    // The rule carries its own spec now — no ledger-visible template row, so a
    // subscription no longer puts a charge that never happened into the ledger.
    await tx.recurringRule.create({
      data: {
        userId,
        frequency: data.frequency,
        nextRunDate: firstRun,
        isActive: true,
        subscriptionId: subscription.id,
        amount: new Prisma.Decimal(data.amount),
        type: 'EXPENSE' as TransactionType,
        description: data.name,
        categoryId: data.categoryId ?? null,
        bankAccountId: data.bankAccountId ?? null,
        paymentMode: (data.paymentMode as PaymentMode | null) ?? null,
      },
    });

    return tx.subscription.findFirstOrThrow({
      where: { id: subscription.id },
      include: subscriptionInclude,
    });
  }).then((s) => decorate(s));
}

export interface UpdateSubscriptionInput {
  name?: string;
  vendor?: string | null;
  cancellationUrl?: string | null;
  notes?: string | null;
  trialEndDate?: string | null;
  frequency?: RecurringFrequency;
  nextRunDate?: string | null;
  /** How it is paid. Settable at creation but, until now, never changeable — so moving a
   *  subscription to a different card meant deleting and re-creating it, losing the price
   *  history that makes past charges explainable. */
  paymentMode?: string | null;
  bankAccountId?: string | null;
  categoryId?: string | null;
  /** Metadata — when the user actually started paying. Moves the OPENING price row's
   *  effectiveFrom with it (amount and note untouched), so the two never disagree. Never
   *  feeds billing: `createSubscription` clamps the first real charge to today regardless
   *  of this value, and nothing here changes that. */
  startDate?: string;
}

/**
 * Descriptive fields and the schedule. Price is deliberately NOT updatable here —
 * changing what you pay goes through `recordPriceChange`, so it lands in the history
 * that generation reads rather than silently overwriting it.
 */
export async function updateSubscription(
  requesterId: string,
  id: string,
  data: UpdateSubscriptionInput,
  requesterRole = 'MEMBER',
) {
  const existing = await prisma.subscription.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    include: { recurringRule: { select: { id: true } } },
  });
  if (!existing) throw AppError.notFound('Subscription');

  const scheduleChanged = data.frequency !== undefined || data.nextRunDate !== undefined;
  const paymentChanged = data.paymentMode !== undefined
    || data.bankAccountId !== undefined
    || data.categoryId !== undefined;

  // Same ownership check the create path runs. Without it a requester could point their
  // subscription at somebody else's account or category by id, and the rule would happily
  // generate charges against it.
  if (data.bankAccountId || data.categoryId) {
    await assertLinkedRecordsOwned(existing.userId, data.bankAccountId, data.categoryId);
  }

  await prisma.$transaction(async (tx) => {
    // startDate is metadata (see UpdateSubscriptionInput) but it seeded the OPENING
    // SubscriptionPrice row at creation — `effectiveFrom: startDate`
    // (createSubscription, above). Left behind, the two disagree and priceAsOf() returns
    // null for the gap between them, silently making early charges "unexplained." The
    // opening row is identified by being the EARLIEST effectiveFrom, not by insertion
    // order — recordPriceChange has no guard against backdating before startDate, so
    // "first created" would be the wrong row to trust.
    if (data.startDate !== undefined) {
      const newStartDate = new Date(data.startDate);
      const prices = await tx.subscriptionPrice.findMany({
        where: { subscriptionId: id },
        orderBy: { effectiveFrom: 'asc' },
      });
      const [opening, nextPrice] = prices;
      if (nextPrice && newStartDate.getTime() >= nextPrice.effectiveFrom.getTime()) {
        throw AppError.badRequest(
          `Start date must be before the next recorded price change on ${nextPrice.effectiveFrom.toISOString().slice(0, 10)}`,
        );
      }
      if (opening) {
        // Only `effectiveFrom` moves — `amount`/`note` are never in this payload. Does
        // not contradict recordPriceChange's "never edits an existing row": that
        // invariant is about the recorded PRICE (what was actually paid), which this
        // never touches. Correcting when it started is not the same claim as correcting
        // what it cost.
        await tx.subscriptionPrice.update({
          where: { id: opening.id },
          data: { effectiveFrom: newStartDate },
        });
      }
    }

    await tx.subscription.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.vendor !== undefined && { vendor: data.vendor }),
        ...(data.cancellationUrl !== undefined && { cancellationUrl: data.cancellationUrl }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.trialEndDate !== undefined && {
          trialEndDate: data.trialEndDate ? new Date(data.trialEndDate) : null,
        }),
        ...(data.startDate !== undefined && { startDate: new Date(data.startDate) }),
      },
    });

    // Extending a trial must move the first charge with it. Creation couples the two
    // (nextRunDate = trialEndDate); update did not, so a trial extended to 01/10 still
    // billed on 01/09 while the card and the dashboard both said the trial was live.
    const movesTrial = data.trialEndDate !== undefined
      && data.trialEndDate !== null
      && existing.status === 'TRIALING'
      && data.nextRunDate === undefined;

    if ((scheduleChanged || movesTrial || paymentChanged) && existing.recurringRule) {
      await tx.recurringRule.update({
        where: { id: existing.recurringRule.id },
        data: {
          ...(data.frequency !== undefined && { frequency: data.frequency }),
          ...(data.nextRunDate !== undefined && data.nextRunDate !== null && {
            nextRunDate: new Date(data.nextRunDate),
          }),
          ...(movesTrial && { nextRunDate: new Date(data.trialEndDate as string) }),
          // `null` clears deliberately; `undefined` means the field was not sent at all.
          ...(data.paymentMode !== undefined && {
            paymentMode: (data.paymentMode as PaymentMode | null) ?? null,
          }),
          ...(data.bankAccountId !== undefined && { bankAccountId: data.bankAccountId ?? null }),
          ...(data.categoryId !== undefined && { categoryId: data.categoryId ?? null }),
        },
      });
    }
  });

  return getSubscription(requesterId, id, requesterRole);
}

/**
 * Records a new price from a date forward.
 *
 * Never edits an existing row: past charges were billed at the old price and the history
 * is what proves it. Re-recording the same effectiveFrom updates that row instead of
 * inserting a duplicate, because two prices at the same instant would make "the price on
 * that date" ambiguous (the DB enforces this too).
 */
export async function recordPriceChange(
  requesterId: string,
  id: string,
  amount: number,
  effectiveFrom: string,
  note?: string | null,
  requesterRole = 'MEMBER',
) {
  const subscription = await prisma.subscription.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    include: { recurringRule: { select: { id: true } } },
  });
  if (!subscription) throw AppError.notFound('Subscription');

  const effective = new Date(effectiveFrom);

  await prisma.$transaction(async (tx) => {
    await tx.subscriptionPrice.upsert({
      where: { subscriptionId_effectiveFrom: { subscriptionId: id, effectiveFrom: effective } },
      update: { amount: new Prisma.Decimal(amount), note: note ?? null },
      create: {
        subscriptionId: id,
        amount: new Prisma.Decimal(amount),
        effectiveFrom: effective,
        note: note ?? null,
      },
    });

    // Keep the rule's own amount in step so anything reading it directly sees the
    // current price. Generation resolves from the price history regardless, so this is
    // a mirror, not the source.
    if (subscription.recurringRule) {
      await tx.recurringRule.update({
        where: { id: subscription.recurringRule.id },
        data: { amount: new Prisma.Decimal(amount) },
      });
    }
  });

  return getSubscription(requesterId, id, requesterRole);
}

/**
 * Cancellation is NOT deletion. The charges already made are real spending and stay in
 * the ledger; what has to stop is future generation. Status and `isActive` are set in
 * one transaction so the two can never disagree — a cancelled subscription that kept
 * billing was pre-mortem #3 for this feature.
 */
export async function cancelSubscription(
  requesterId: string,
  id: string,
  reason?: string | null,
  requesterRole = 'MEMBER',
) {
  const subscription = await prisma.subscription.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    include: { recurringRule: { select: { id: true } } },
  });
  if (!subscription) throw AppError.notFound('Subscription');
  if (subscription.status === 'CANCELLED') {
    throw AppError.conflict('This subscription is already cancelled');
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
    });
    if (subscription.recurringRule) {
      await tx.recurringRule.update({
        where: { id: subscription.recurringRule.id },
        data: { isActive: false },
      });
    }
  });

  return getSubscription(requesterId, id, requesterRole);
}

/** Resumes a cancelled subscription, billing from `nextRunDate` onward. */
export async function resumeSubscription(
  requesterId: string,
  id: string,
  nextRunDate: string,
  requesterRole = 'MEMBER',
) {
  const subscription = await prisma.subscription.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    include: { recurringRule: { select: { id: true } } },
  });
  if (!subscription) throw AppError.notFound('Subscription');
  if (subscription.status === 'ACTIVE') {
    throw AppError.conflict('This subscription is already active');
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id },
      data: { status: 'ACTIVE', cancelledAt: null, cancelReason: null },
    });
    if (subscription.recurringRule) {
      // Forward-dated deliberately: resuming must not backfill the cancelled period.
      await tx.recurringRule.update({
        where: { id: subscription.recurringRule.id },
        data: { isActive: true, nextRunDate: new Date(nextRunDate) },
      });
    }
  });

  return getSubscription(requesterId, id, requesterRole);
}

/**
 * SOFT delete. `vision.md` forbids new hard deletes on financial records, and this is
 * one: `SubscriptionPrice` is the proof of what past charges were billed at, and a hard
 * delete would cascade it away and leave historical spend unexplainable. The generated
 * transactions would survive (their FK is SET NULL) but nothing would say what they were
 * for or whether the amount was right.
 *
 * Billing stops the same way cancellation stops it — the owned rule is deactivated —
 * so a deleted subscription cannot keep charging.
 */
export async function deleteSubscription(requesterId: string, id: string, requesterRole = 'MEMBER') {
  const subscription = await prisma.subscription.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    include: { recurringRule: { select: { id: true } } },
  });
  if (!subscription) throw AppError.notFound('Subscription');

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });

    if (subscription.recurringRule) {
      // Stop the money. Without this the rule stays active and keeps generating charges
      // for a subscription that no longer appears anywhere in the UI.
      await tx.recurringRule.update({
        where: { id: subscription.recurringRule.id },
        data: { isActive: false },
      });
    }
  });
}

/** Snapshot fetch for the audit trail — not an authorization check. */
export async function getSubscriptionForAudit(
  requesterId: string,
  id: string,
  requesterRole = 'MEMBER',
) {
  return prisma.subscription.findFirst({
    where: { ...ownerScopedWhere(id, requesterId, requesterRole), deletedAt: null },
    include: subscriptionInclude,
  });
}
