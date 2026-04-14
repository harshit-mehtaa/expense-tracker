/**
 * Tests for INRDisplay component tooltip behaviour.
 *
 * When `short=true` and the amount is abbreviated (>= 1 lakh), the component
 * must expose the full formatted amount via the native `title` attribute so
 * users can hover to see the exact figure.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { INRDisplay } from '../components/shared/INRDisplay';

describe('INRDisplay — title tooltip when short', () => {
  it('sets title to full amount when short=true and amount >= 1 lakh (crore range)', () => {
    const { container } = render(<INRDisplay amount={12500000} short />);
    const span = container.querySelector('span')!;
    expect(span.textContent).toBe('₹1.3Cr');
    expect(span.title).toBe('₹1,25,00,000');
  });

  it('sets title to full amount when short=true and amount is in lakh range', () => {
    const { container } = render(<INRDisplay amount={1500000} short />);
    const span = container.querySelector('span')!;
    expect(span.textContent).toBe('₹15.0L');
    expect(span.title).toBe('₹15,00,000');
  });

  it('does NOT set title when short=true but amount < 1 lakh (already full)', () => {
    const { container } = render(<INRDisplay amount={50000} short />);
    const span = container.querySelector('span')!;
    // formatINRShort returns full number for sub-lakh — no tooltip needed
    expect(span.title).toBe('');
  });

  it('does NOT set title when short=false', () => {
    const { container } = render(<INRDisplay amount={12500000} />);
    const span = container.querySelector('span')!;
    expect(span.title).toBe('');
  });

  it('adds cursor-help class when abbreviated', () => {
    const { container } = render(<INRDisplay amount={5000000} short />);
    const span = container.querySelector('span')!;
    expect(span.className).toContain('cursor-help');
  });

  it('does NOT add cursor-help class when not abbreviated', () => {
    const { container } = render(<INRDisplay amount={50000} short />);
    const span = container.querySelector('span')!;
    expect(span.className).not.toContain('cursor-help');
  });

  it('handles negative abbreviated amounts correctly', () => {
    const { container } = render(<INRDisplay amount={-10000000} short colorCode />);
    const span = container.querySelector('span')!;
    expect(span.textContent).toBe('-₹1.0Cr');
    expect(span.title).toBe('-₹1,00,00,000');
  });

  it('handles exactly 1 lakh (boundary)', () => {
    const { container } = render(<INRDisplay amount={100000} short />);
    const span = container.querySelector('span')!;
    expect(span.title).toBe('₹1,00,000');
  });

  it('handles null/undefined without error', () => {
    const { container } = render(<INRDisplay amount={null} short />);
    expect(container.textContent).toBe('—');
  });
});
