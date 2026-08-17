/**
 * Official brand marks for category icons.
 *
 * The stored icon is a plain string, so it can only hold an emoji — fine for "Groceries",
 * a poor stand-in for Netflix. These resolve a real logo where the brand permits one.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getBrandMark } from '@/lib/brandIcons';
import { CategoryIcon } from '@/components/shared/CategoryIcon';

describe('getBrandMark', () => {
  it('resolves a brand by name, with its own colour', () => {
    const netflix = getBrandMark('Netflix')!;
    expect(netflix.title).toBe('Netflix');
    expect(netflix.hex.toUpperCase()).toBe('E50914');
    expect(netflix.path.length).toBeGreaterThan(20);
  });

  it('is case- and punctuation-insensitive, like the backend styling', () => {
    expect(getBrandMark('  NETFLIX  ')?.title).toBe('Netflix');
    expect(getBrandMark('you-tube')).toBeNull(); // not a real brand key
    expect(getBrandMark('Google Pay')?.title).toBe('Google Pay');
  });

  it('falls back to the leading word so "Netflix Premium" still resolves', () => {
    expect(getBrandMark('Netflix Premium')?.title).toBe('Netflix');
    expect(getBrandMark('Spotify Family')?.title).toBe('Spotify');
  });

  it('does not substring-match, so Apple never matches Pineapple', () => {
    expect(getBrandMark('Pineapple')).toBeNull();
    expect(getBrandMark('Applesauce')).toBeNull();
  });

  it('returns null for an ordinary category', () => {
    expect(getBrandMark('Groceries')).toBeNull();
    expect(getBrandMark('Travel')).toBeNull();
    expect(getBrandMark('')).toBeNull();
    expect(getBrandMark(null)).toBeNull();
  });

  it('returns null for brands Simple Icons has removed on trademark grounds', () => {
    // Amazon, Prime Video, Disney+ and Hotstar are not shipped. They keep their emoji —
    // the boundary is what the brands permit, not effort.
    expect(getBrandMark('Amazon Prime')).toBeNull();
    expect(getBrandMark('Disney+')).toBeNull();
    expect(getBrandMark('Hotstar')).toBeNull();
  });
});

describe('CategoryIcon', () => {
  it('renders the official mark for a brand, in the brand colour', () => {
    render(<CategoryIcon name="Netflix" icon="🎥" />);
    const svg = screen.getByRole('img', { name: 'Netflix' });
    expect(svg).toBeInTheDocument();
    expect(svg.getAttribute('fill')?.toUpperCase()).toBe('#E50914');
  });

  it('prefers the mark over the stored emoji', () => {
    render(<CategoryIcon name="Netflix" icon="🎥" />);
    expect(screen.queryByText('🎥')).not.toBeInTheDocument();
  });

  it('falls back to the emoji for a category with no brand', () => {
    render(<CategoryIcon name="Groceries" icon="🛒" />);
    expect(screen.getByText('🛒')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('falls back to the emoji for a brand that is not shipped', () => {
    render(<CategoryIcon name="Amazon Prime" icon="📦" />);
    expect(screen.getByText('📦')).toBeInTheDocument();
  });

  it('renders a placeholder when there is neither a brand nor an emoji', () => {
    const { container } = render(<CategoryIcon name="Whatever" icon={null} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('names the brand for a screen reader rather than leaving a bare path', () => {
    render(<CategoryIcon name="Spotify" icon="🎧" />);
    expect(screen.getByRole('img', { name: 'Spotify' })).toBeInTheDocument();
  });
});
