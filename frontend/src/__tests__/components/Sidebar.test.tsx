/**
 * Regression guard for the "orphan <li>" bug: NavItem always renders an <li> root,
 * and Tailwind preflight only resets list-style on ul/ol — an <li> with no list
 * ancestor keeps the browser's default disc marker. Every <li> in the sidebar must
 * have a ul/ol ancestor, or the marker silently reappears.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Sidebar } from '@/components/layout/Sidebar';
import { renderPage } from '../support/renderPage';
import { ADMIN_USER, MEMBER_USER } from '../support/fixtures';

describe('Sidebar', () => {
  it('renders every <li> inside a <ul>/<ol> ancestor, for both roles', async () => {
    for (const user of [ADMIN_USER, MEMBER_USER]) {
      const { container, unmount } = renderPage(<Sidebar />, { user });
      await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());

      const items = container.querySelectorAll('li');
      expect(items.length).toBeGreaterThan(0);
      items.forEach((li) => {
        expect(li.closest('ul, ol')).not.toBeNull();
      });

      unmount();
    }
  });
});
