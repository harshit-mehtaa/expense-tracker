import { useState, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { CommandPalette } from '@/components/shared/CommandPalette';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

export function AppShell() {
  const [showPalette, setShowPalette] = useState(false);
  const location = useLocation();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette((v) => !v);
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-6">
          {/*
            Wraps only the routed page, so a crash inside one page shows the fallback
            while the sidebar, header and navigation stay usable — rather than React
            unmounting the whole tree and leaving a blank screen.

            Keyed on pathname so navigating away from a crashed page resets the boundary.
            Without the key, once a page throws, every subsequent route renders the
            fallback until a full reload.
          */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} />
    </div>
  );
}
