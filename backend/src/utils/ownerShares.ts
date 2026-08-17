import { AppError } from './AppError';

/**
 * Ownership shares for co-ownable records (loans, properties).
 *
 * Extracted because `loanService` and `investmentService` each carried a copy of this
 * ~25-line invariant, and the copies drifted: a rounding bug was fixed in the loan one
 * and left in the property one, where it stayed exploitable. A financial invariant
 * duplicated per domain will keep diverging exactly like that.
 */

export interface OwnerShareInput {
  userId: string;
  sharePercent: number;
}

export interface OwnerShareRow {
  userId: string;
  sharePercent: number;
}

/**
 * Validates and rounds an owner set, defaulting to the record's own user at 100%.
 *
 * `label` names the domain in the error text ("Loan owner", "Property owner") — the
 * messages are user-facing, so they should say what the user was editing.
 */
export function normalizeOwnerShares(
  defaultUserId: string,
  owners: OwnerShareInput[] | undefined,
  label: string,
): OwnerShareRow[] {
  const rows = owners?.length ? owners : [{ userId: defaultUserId, sharePercent: 100 }];
  const seen = new Set<string>();
  let totalShare = 0;

  const normalized = rows.map((owner) => {
    const sharePercent = Number(owner.sharePercent);
    if (!owner.userId) throw AppError.validationError(`${label} is required`);
    if (seen.has(owner.userId)) {
      throw AppError.validationError(`A ${label.toLowerCase()} can only be added once`);
    }
    if (!Number.isFinite(sharePercent)) {
      throw AppError.validationError('Owner share must be greater than 0 and at most 100');
    }

    // Round BEFORE validating, not after. Validating the raw value let 0.001 pass the
    // `> 0` check and then store as 0 — and because the visibility predicates key on
    // owner membership alone, with no share threshold, that 0% row still granted full
    // view, edit and delete rights on the record.
    const roundedShare = Math.round(sharePercent * 100) / 100;
    if (roundedShare <= 0 || roundedShare > 100) {
      throw AppError.validationError('Owner share must be greater than 0 and at most 100');
    }

    seen.add(owner.userId);
    totalShare += roundedShare;
    return { userId: owner.userId, sharePercent: roundedShare };
  });

  if (Math.abs(totalShare - 100) > 0.01) {
    throw AppError.validationError(`${label} shares must add up to 100%`);
  }

  return normalized;
}

/**
 * Refuses an owner set that drops the record's primary owner, unless the requester is
 * that owner or an admin.
 *
 * The empty-array default above protects the primary owner only when the array is EMPTY.
 * A non-empty array is written verbatim with `deleteMany: {}`, so without this a 1%
 * co-owner could send `[{ self, 100 }]` and remove the primary owner from their own
 * record.
 */
export function assertPrimaryOwnerRetained(
  owners: OwnerShareInput[],
  primaryUserId: string,
  requesterId: string,
  requesterRole: string,
  label: string,
): void {
  if (owners.length === 0) return;
  if (owners.some((owner) => owner.userId === primaryUserId)) return;
  if (requesterRole === 'ADMIN' || requesterId === primaryUserId) return;

  throw AppError.forbidden(
    `Only the ${label.toLowerCase()} or an admin can remove the primary owner`,
  );
}

/**
 * The share a given user holds, as a fraction.
 *
 * Returns 0 for a non-owner. The ONLY fallback to 100% is a record with no owner rows at
 * all, which is how records created before co-ownership existed are represented.
 *
 * Deliberately does NOT fall back to 100% when `primaryUserId === scopedUserId`. That
 * fallback meant a record whose owner rows omit the primary still reported the primary at
 * 100% while every co-owner also reported their share — the same property counted more
 * than once across the family, in net worth and in tax relief.
 */
export function ownerShareMultiplier(
  // `sharePercent` is typed loosely because callers pass it straight from Prisma, where
  // it is a Decimal. Narrowing to number|string would force a cast at every call site,
  // and a cast is exactly the kind of thing that hides a real type mismatch later.
  owners: { userId: string; sharePercent: unknown }[] | null | undefined,
  scopedUserId: string | undefined,
): number {
  if (!scopedUserId) return 1;
  const rows = owners ?? [];
  const own = rows.find((owner) => owner.userId === scopedUserId);
  if (own) return Number(own.sharePercent) / 100;
  return rows.length === 0 ? 1 : 0;
}
