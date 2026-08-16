/**
 * ErrorBoundary — the app's only guard against a render throw taking down the whole tree.
 *
 * It sat unused with zero importers until it was wired into AppShell, which is why a
 * single component crash previously blanked the entire page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

/** Throws on first render, then succeeds — lets us test recovery. */
function Boom({ throwNow }: { throwNow: boolean }) {
  if (throwNow) throw new Error('kaboom');
  return <p>recovered content</p>;
}

// MockInstance's generics don't unify with console.error's overloads; the spy is
// only ever used for assertion and restore, so the loose shape is honest here.
let errorSpy: { mockRestore: () => void } | undefined;

afterEach(() => {
  errorSpy?.mockRestore();
  errorSpy = undefined;
});

/** React logs caught errors via console.error; silence it so output stays readable. */
function silenceReactErrorLog() {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
}

describe('ErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>);
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('catches a render throw and shows the fallback instead of unmounting the tree', () => {
    silenceReactErrorLog();
    render(<ErrorBoundary><Boom throwNow /></ErrorBoundary>);

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('logs the error with its component stack for diagnosis', () => {
    silenceReactErrorLog();
    render(<ErrorBoundary><Boom throwNow /></ErrorBoundary>);

    expect(errorSpy).toHaveBeenCalledWith(
      '[ErrorBoundary]',
      expect.objectContaining({ message: 'kaboom' }),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });

  it('renders a custom fallback when one is supplied', () => {
    silenceReactErrorLog();
    render(
      <ErrorBoundary fallback={<p>custom fallback</p>}>
        <Boom throwNow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('custom fallback')).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/i)).toBeNull();
  });

  it('"Try again" clears the error so a now-healthy child renders', async () => {
    silenceReactErrorLog();
    const user = userEvent.setup();

    function Harness() {
      // Flips to non-throwing before the retry, mimicking a transient failure.
      return <ErrorBoundary><Boom throwNow={false} /></ErrorBoundary>;
    }

    const { rerender } = render(<ErrorBoundary><Boom throwNow /></ErrorBoundary>);
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    rerender(<Harness />);

    expect(await screen.findByText('recovered content')).toBeInTheDocument();
  });
});

// ─── Integration: does it actually contain a page crash in the real shell? ─────

describe('AppShell containment', () => {
  it('a throwing page shows the fallback while the shell survives', async () => {
    silenceReactErrorLog();

    // Mirrors AppShell's structure: the boundary wraps only the routed outlet, so the
    // chrome around it must remain interactive when a page throws.
    render(
      <div>
        <nav>Sidebar nav</nav>
        <main>
          <ErrorBoundary><Boom throwNow /></ErrorBoundary>
        </main>
      </div>,
    );

    // The page is replaced by the fallback...
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    // ...but the surrounding chrome is untouched. Before this was wired up, React
    // unmounted the entire tree and the user got a blank screen.
    expect(screen.getByText('Sidebar nav')).toBeInTheDocument();
  });
});
