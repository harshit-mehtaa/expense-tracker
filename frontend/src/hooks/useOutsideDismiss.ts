import { useEffect, useRef, type RefObject } from 'react';

/**
 * Close a hand-rolled popover when the user presses outside it.
 *
 * - Mouse / pen: on `pointerdown`. Radix menu triggers (account menu, row actions)
 *   preventDefault their pointerdown, which suppresses the compatibility `mousedown` —
 *   a mousedown listener never fired, leaving the popover open under the menu.
 * - Touch: on `click`. A finger landing to start a scroll fires pointerdown but no click,
 *   so scrolling past an open popover must not close it; a completed tap still does.
 */
export function useOutsideDismiss(ref: RefObject<HTMLElement>, open: boolean, onDismiss: () => void): void {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const isOutside = (target: EventTarget | null) =>
      !!ref.current && !ref.current.contains(target as Node);

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' && isOutside(e.target)) dismiss.current();
    };
    const onClick = (e: MouseEvent) => {
      if (isOutside(e.target)) dismiss.current();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('click', onClick);
    };
  }, [open, ref]);
}
