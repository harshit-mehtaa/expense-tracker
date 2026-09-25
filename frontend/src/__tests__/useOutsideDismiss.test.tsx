/**
 * useOutsideDismiss: close a hand-rolled popover on an outside press.
 * - mouse/pen: on pointerdown — Radix triggers preventDefault pointerdown, which
 *   suppresses the compatibility mousedown the old listeners waited for.
 * - touch: on click — a finger landing to start a scroll fires pointerdown but no
 *   click, so scrolling past an open popover must not close it; a tap still does.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { useOutsideDismiss } from '@/hooks/useOutsideDismiss';

function Harness({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useOutsideDismiss(ref, open, onDismiss);
  return (
    <>
      <div ref={ref} data-testid="inside">popover</div>
      <div data-testid="outside">page</div>
    </>
  );
}

// jsdom has no PointerEvent, so fireEvent.pointerDown drops `pointerType`; set it by hand.
const pointerDown = (el: Element, pointerType: string) => {
  const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(el, event);
};

describe('useOutsideDismiss', () => {
  it('dismisses on a mouse pointerdown outside', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness open onDismiss={onDismiss} />);
    pointerDown(getByTestId('outside'), 'mouse');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a pen pointerdown outside', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness open onDismiss={onDismiss} />);
    pointerDown(getByTestId('outside'), 'pen');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does NOT dismiss when a touch lands outside (could be the start of a scroll)', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness open onDismiss={onDismiss} />);
    pointerDown(getByTestId('outside'), 'touch');
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on a click outside (a completed tap)', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness open onDismiss={onDismiss} />);
    fireEvent.click(getByTestId('outside'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('ignores presses inside the popover', () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(<Harness open onDismiss={onDismiss} />);
    pointerDown(getByTestId('inside'), 'mouse');
    fireEvent.click(getByTestId('inside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('does nothing while closed, and removes its listeners on close', () => {
    const onDismiss = vi.fn();
    const { getByTestId, rerender } = render(<Harness open={false} onDismiss={onDismiss} />);
    pointerDown(getByTestId('outside'), 'mouse');
    rerender(<Harness open onDismiss={onDismiss} />);
    rerender(<Harness open={false} onDismiss={onDismiss} />);
    fireEvent.click(getByTestId('outside'));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
