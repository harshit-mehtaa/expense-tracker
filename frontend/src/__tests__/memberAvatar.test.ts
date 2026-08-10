import { describe, it, expect } from 'vitest';
import {
  MEMBER_AVATAR_COLORS,
  MEMBER_FALLBACK_COLOR,
  avatarInitial,
  buildMemberColorMap,
  resolveAvatarColor,
} from '@/lib/memberAvatar';

/** WCAG relative luminance / contrast ratio. */
function contrastWithWhite(hex: string): number {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (lum + 0.05);
}

describe('resolveAvatarColor', () => {
  it('uses a valid colorTag', () => {
    expect(resolveAvatarColor('#6366f1', '#000000')).toBe('#6366f1');
  });

  it('accepts 3-digit hex', () => {
    expect(resolveAvatarColor('#abc')).toBe('#abc');
  });

  // The blank-cell bug: a truthy but invalid value would reach style={{ backgroundColor }},
  // be dropped by the CSSOM, and leave a transparent circle with white text.
  it.each(['6366f1', 'indigo', '#12345', 'red; background-image:url(//x)', '#gggggg', ''])(
    'rejects invalid colorTag %j and uses the fallback',
    (bad) => {
      expect(resolveAvatarColor(bad, '#4f46e5')).toBe('#4f46e5');
    },
  );

  it('falls back when colorTag is null or undefined', () => {
    expect(resolveAvatarColor(null, '#4f46e5')).toBe('#4f46e5');
    expect(resolveAvatarColor(undefined, '#4f46e5')).toBe('#4f46e5');
  });

  it('uses the shared default when no fallback is supplied', () => {
    expect(resolveAvatarColor(null)).toBe(MEMBER_FALLBACK_COLOR);
  });
});

describe('buildMemberColorMap', () => {
  it('gives every member a distinct colour up to the palette length', () => {
    const members = Array.from({ length: MEMBER_AVATAR_COLORS.length }, (_, i) => ({ id: `u${i}` }));
    const map = buildMemberColorMap(members);
    expect(new Set(map.values()).size).toBe(MEMBER_AVATAR_COLORS.length);
  });

  // The property a name hash could not provide: same-initial members never collide.
  it('separates members whose names share an initial', () => {
    const map = buildMemberColorMap([{ id: 'amma' }, { id: 'appa' }]);
    expect(map.get('amma')).not.toBe(map.get('appa'));
  });

  it('wraps around past the palette length', () => {
    const members = Array.from({ length: MEMBER_AVATAR_COLORS.length + 1 }, (_, i) => ({ id: `u${i}` }));
    const map = buildMemberColorMap(members);
    expect(map.get(`u${MEMBER_AVATAR_COLORS.length}`)).toBe(map.get('u0'));
  });

  it('returns undefined for an unknown id, so callers get the shared default', () => {
    const map = buildMemberColorMap([{ id: 'a' }]);
    expect(resolveAvatarColor(null, map.get('deactivated'))).toBe(MEMBER_FALLBACK_COLOR);
  });
});

describe('avatarInitial', () => {
  it('uppercases the first letter', () => {
    expect(avatarInitial('harshit')).toBe('H');
  });

  it('handles non-Latin scripts', () => {
    expect(avatarInitial('अनिता')).toBe('अ');
  });

  // charAt(0) would return a lone surrogate here and render as U+FFFD.
  it('does not split surrogate pairs', () => {
    expect(avatarInitial('🙂Papa')).toBe('🙂');
  });
});

describe('palette accessibility', () => {
  it.each([...MEMBER_AVATAR_COLORS, MEMBER_FALLBACK_COLOR])(
    '%s meets WCAG AA against white text',
    (color) => {
      expect(contrastWithWhite(color)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
