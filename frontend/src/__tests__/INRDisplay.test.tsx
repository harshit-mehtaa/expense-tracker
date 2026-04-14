/**
 * Tests for INRDisplay component abbreviated amount behaviour.
 *
 * When `short=true` and the amount is abbreviated (>= 1 lakh), the component
 * renders the abbreviated form plus the full exact amount below it in small text.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { INRDisplay } from '../components/shared/INRDisplay';

describe('INRDisplay — full amount shown below abbreviated form', () => {
  it('shows abbreviated and full amount when short=true and amount >= 1 lakh (crore range)', () => {
    const { container } = render(<INRDisplay amount={12500000} short />);
    expect(container.textContent).toContain('₹1.3Cr');
    expect(container.textContent).toContain('₹1,25,00,000');
  });

  it('shows abbreviated and full amount in lakh range', () => {
    const { container } = render(<INRDisplay amount={1500000} short />);
    expect(container.textContent).toContain('₹15.0L');
    expect(container.textContent).toContain('₹15,00,000');
  });

  it('full amount is in a separate span with muted styling', () => {
    const { container } = render(<INRDisplay amount={10000000} short />);
    const spans = container.querySelectorAll('span');
    // outer wrapper + abbreviated span + full-amount span = 3
    expect(spans.length).toBe(3);
    const fullAmountSpan = spans[2];
    expect(fullAmountSpan.className).toContain('text-muted-foreground');
    expect(fullAmountSpan.className).toContain('text-xs');
  });

  it('does NOT show secondary full amount when short=true but amount < 1 lakh', () => {
    const { container } = render(<INRDisplay amount={50000} short />);
    // Only one span, no secondary text
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(container.textContent).toBe('₹50,000');
  });

  it('does NOT show secondary full amount when short=false', () => {
    const { container } = render(<INRDisplay amount={12500000} />);
    const spans = container.querySelectorAll('span');
    expect(spans.length).toBe(1);
    expect(container.textContent).toBe('₹1,25,00,000');
  });

  it('handles negative abbreviated amounts correctly', () => {
    const { container } = render(<INRDisplay amount={-10000000} short colorCode />);
    expect(container.textContent).toContain('-₹1.0Cr');
    expect(container.textContent).toContain('-₹1,00,00,000');
  });

  it('handles exactly 1 lakh (boundary — shows full amount below)', () => {
    const { container } = render(<INRDisplay amount={100000} short />);
    expect(container.textContent).toContain('₹1.0L');
    expect(container.textContent).toContain('₹1,00,000');
  });

  it('handles null/undefined without error', () => {
    const { container } = render(<INRDisplay amount={null} short />);
    expect(container.textContent).toBe('—');
  });
});
