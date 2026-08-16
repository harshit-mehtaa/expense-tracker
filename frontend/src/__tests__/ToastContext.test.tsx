/**
 * Tests for ToastContext / ToastProvider / useToast.
 *
 * This is the application's ONLY error-surfacing channel: `lib/api.ts` dispatches an
 * `api:error` CustomEvent on request failure, and the listener here is what turns that
 * into something the user can actually see. If this breaks, every page fails silently.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider, useToast, type ToastVariant } from '@/contexts/ToastContext';

/** Renders buttons that fire toasts, so tests drive the real public API. */
function ToastHarness({
  toasts = [],
}: {
  toasts?: Array<{ title: string; description?: string; variant?: ToastVariant }>;
}) {
  const { toast } = useToast();
  return (
    <div>
      {toasts.map((t, i) => (
        <button key={i} onClick={() => toast(t)}>
          fire-{i}
        </button>
      ))}
      <button onClick={() => toasts.forEach((t) => toast(t))}>fire-all</button>
    </div>
  );
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe('useToast — outside provider', () => {
  it('throws a named error rather than silently returning null', () => {
    // React logs the boundary-less throw; suppress just for this assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Orphan() {
      useToast();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow('useToast must be used inside ToastProvider');
    spy.mockRestore();
  });
});

describe('ToastProvider — rendering toasts', () => {
  it('renders nothing until a toast is fired', () => {
    renderWithProvider(<ToastHarness />);
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('renders a toast title when fired', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastHarness toasts={[{ title: 'Saved' }]} />);

    await user.click(screen.getByRole('button', { name: 'fire-0' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('renders the description when one is supplied', async () => {
    const user = userEvent.setup();
    renderWithProvider(
      <ToastHarness toasts={[{ title: 'Saved', description: 'Budget created' }]} />,
    );

    await user.click(screen.getByRole('button', { name: 'fire-0' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('Budget created')).toBeInTheDocument();
  });

  it('omits the description element entirely when none is supplied', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProvider(<ToastHarness toasts={[{ title: 'Bare' }]} />);

    await user.click(screen.getByRole('button', { name: 'fire-0' }));
    await screen.findByText('Bare');

    // The description span carries text-gray-600; with no description it must not exist.
    expect(container.querySelector('.text-gray-600')).toBeNull();
  });

  it('renders multiple distinct toasts simultaneously', async () => {
    const user = userEvent.setup();
    renderWithProvider(
      <ToastHarness toasts={[{ title: 'First' }, { title: 'Second' }]} />,
    );

    await user.click(screen.getByRole('button', { name: 'fire-0' }));
    await user.click(screen.getByRole('button', { name: 'fire-1' }));

    expect(await screen.findByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});

describe('ToastProvider — variants', () => {
  const cases: Array<{ variant: ToastVariant; border: string; title: string }> = [
    { variant: 'default', border: 'border-gray-200', title: 'text-gray-900' },
    { variant: 'success', border: 'border-green-500', title: 'text-green-700' },
    { variant: 'error', border: 'border-red-500', title: 'text-red-700' },
    { variant: 'warning', border: 'border-yellow-500', title: 'text-yellow-700' },
  ];

  it.each(cases)(
    'applies the $variant border and title colour',
    async ({ variant, border, title }) => {
      const user = userEvent.setup();
      const { container } = renderWithProvider(
        <ToastHarness toasts={[{ title: 'Styled', variant }]} />,
      );

      await user.click(screen.getByRole('button', { name: 'fire-0' }));
      const titleEl = await screen.findByText('Styled');

      expect(titleEl.className).toContain(title);
      expect(container.querySelector(`.${border}`)).not.toBeNull();
    },
  );

  it('defaults to the "default" variant when none is given', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProvider(<ToastHarness toasts={[{ title: 'Plain' }]} />);

    await user.click(screen.getByRole('button', { name: 'fire-0' }));
    await screen.findByText('Plain');

    expect(container.querySelector('.border-gray-200')).not.toBeNull();
  });
});

describe('ToastProvider — 5-toast cap', () => {
  it('keeps only the 5 most recent toasts and evicts the oldest', async () => {
    const user = userEvent.setup();
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `Toast ${i + 1}` }));
    renderWithProvider(<ToastHarness toasts={six} />);

    await user.click(screen.getByRole('button', { name: 'fire-all' }));

    // The 6th push slices to the last 4 and appends — so 1 is gone, 2..6 remain.
    expect(await screen.findByText('Toast 6')).toBeInTheDocument();
    expect(screen.queryByText('Toast 1')).toBeNull();
    for (const n of [2, 3, 4, 5]) {
      expect(screen.getByText(`Toast ${n}`)).toBeInTheDocument();
    }
  });

  it('holds exactly 5 toasts, not 6', async () => {
    const user = userEvent.setup();
    const six = Array.from({ length: 6 }, (_, i) => ({ title: `T${i + 1}` }));
    const { container } = renderWithProvider(<ToastHarness toasts={six} />);

    await user.click(screen.getByRole('button', { name: 'fire-all' }));
    await screen.findByText('T6');

    // Each toast root carries the w-80 sizing class.
    expect(container.querySelectorAll('.w-80')).toHaveLength(5);
  });

  it('does not cap below 5', async () => {
    const user = userEvent.setup();
    const five = Array.from({ length: 5 }, (_, i) => ({ title: `K${i + 1}` }));
    renderWithProvider(<ToastHarness toasts={five} />);

    await user.click(screen.getByRole('button', { name: 'fire-all' }));

    expect(await screen.findByText('K5')).toBeInTheDocument();
    expect(screen.getByText('K1')).toBeInTheDocument();
  });
});

describe('ToastProvider — dismissal', () => {
  it('removes the toast when its close button is clicked (onOpenChange -> REMOVE)', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastHarness toasts={[{ title: 'Dismiss me' }]} />);

    await user.click(screen.getByRole('button', { name: 'fire-0' }));
    expect(await screen.findByText('Dismiss me')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '✕' }));

    expect(screen.queryByText('Dismiss me')).toBeNull();
  });

  it('dismissing one toast leaves the others intact', async () => {
    const user = userEvent.setup();
    renderWithProvider(<ToastHarness toasts={[{ title: 'Keep' }, { title: 'Drop' }]} />);

    await user.click(screen.getByRole('button', { name: 'fire-0' }));
    await user.click(screen.getByRole('button', { name: 'fire-1' }));
    await screen.findByText('Drop');

    // Second close button belongs to the second toast.
    const closers = screen.getAllByRole('button', { name: '✕' });
    await user.click(closers[1]);

    expect(screen.queryByText('Drop')).toBeNull();
    expect(screen.getByText('Keep')).toBeInTheDocument();
  });
});

describe('ToastProvider — api:error window event', () => {
  it('surfaces a dispatched api:error as an error toast with its message', async () => {
    renderWithProvider(<ToastHarness />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('api:error', { detail: { message: 'Server exploded' } }),
      );
    });

    expect(await screen.findByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Server exploded')).toBeInTheDocument();
  });

  it('falls back to a generic message when the event carries no detail', async () => {
    renderWithProvider(<ToastHarness />);

    act(() => {
      window.dispatchEvent(new CustomEvent('api:error'));
    });

    expect(
      await screen.findByText('Something went wrong. Please try again.'),
    ).toBeInTheDocument();
  });

  it('falls back when detail exists but has no message', async () => {
    renderWithProvider(<ToastHarness />);

    act(() => {
      window.dispatchEvent(new CustomEvent('api:error', { detail: { code: 'E_OOPS' } }));
    });

    expect(
      await screen.findByText('Something went wrong. Please try again.'),
    ).toBeInTheDocument();
  });

  it('renders api:error toasts with the error variant', async () => {
    const { container } = renderWithProvider(<ToastHarness />);

    act(() => {
      window.dispatchEvent(new CustomEvent('api:error', { detail: { message: 'Boom' } }));
    });
    await screen.findByText('Boom');

    expect(container.querySelector('.border-red-500')).not.toBeNull();
  });

  it('unsubscribes on unmount so a later event cannot toast into a dead tree', async () => {
    const { unmount } = renderWithProvider(<ToastHarness />);

    act(() => {
      window.dispatchEvent(new CustomEvent('api:error', { detail: { message: 'Before' } }));
    });
    await screen.findByText('Before');

    unmount();

    // If the listener leaked, this would attempt a state update on an unmounted
    // component — React reports that via console.error rather than throwing.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => {
      window.dispatchEvent(new CustomEvent('api:error', { detail: { message: 'After' } }));
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('caps api:error toasts at 5 as well', async () => {
    const { container } = renderWithProvider(<ToastHarness />);

    act(() => {
      for (let i = 1; i <= 6; i += 1) {
        window.dispatchEvent(
          new CustomEvent('api:error', { detail: { message: `Fail ${i}` } }),
        );
      }
    });

    expect(await screen.findByText('Fail 6')).toBeInTheDocument();
    expect(screen.queryByText('Fail 1')).toBeNull();
    expect(container.querySelectorAll('.w-80')).toHaveLength(5);
  });
});
