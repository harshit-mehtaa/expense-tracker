/**
 * Colour handling for member avatars.
 *
 * Lives outside the page component so the hex guard is unit-testable: it defends against
 * a real failure mode where an invalid `colorTag` renders a transparent circle with white
 * text, i.e. a blank cell wherever the avatar is shown without an accompanying name.
 */

/**
 * Every value clears WCAG AA (4.5:1) against white text — required because in compact
 * mode the letter on the circle is the only content identifying the member.
 */
export const MEMBER_AVATAR_COLORS = [
  '#4f46e5', '#047857', '#e11d48', '#b45309',
  '#0e7490', '#7c3aed', '#db2777', '#0369a1',
] as const;

/** For members absent from the active list (e.g. deactivated). Also AA-compliant (4.76:1). */
export const MEMBER_FALLBACK_COLOR = '#64748b';

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * `colorTag` is a free-form string on User (schema.prisma:241) and is not validated by
 * the admin routes, so a value like `6366f1` (missing '#') can reach the UI. The CSSOM
 * silently drops an invalid `background-color`, so trust it only if it parses as hex.
 */
export function resolveAvatarColor(color?: string | null, fallback?: string): string {
  if (color && HEX_COLOR.test(color)) return color;
  return fallback ?? MEMBER_FALLBACK_COLOR;
}

/**
 * Assigns each member a colour by position in the family list, keyed by user id.
 * Positional assignment guarantees no two members share a colour (up to the palette
 * length) — a name hash cannot, and collisions matter once the name is hidden.
 */
export function buildMemberColorMap(members: { id: string }[]): Map<string, string> {
  const byId = new Map<string, string>();
  members.forEach((m, i) => byId.set(m.id, MEMBER_AVATAR_COLORS[i % MEMBER_AVATAR_COLORS.length]));
  return byId;
}

/** First user-perceived character, uppercased. Spread avoids splitting surrogate pairs. */
export function avatarInitial(name: string): string {
  return [...name][0]?.toUpperCase() ?? '';
}
