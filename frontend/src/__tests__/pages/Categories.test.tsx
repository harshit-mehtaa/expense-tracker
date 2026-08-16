/**
 * Categories page — smoke.
 *
 * The ONE page in the app with a real query-error branch (:254-256), so this is the
 * only smoke test that can assert an error MESSAGE rather than an error toast. Every
 * other page renders a failed load identically to empty data.
 *
 * Leg 4 (money) is skipped: this page renders no monetary values.
 *
 * Handler count: 1 page-specific (/categories, already in base) + 5 base.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import CategoriesPage from '@/pages/admin/Categories';
import { renderPage, failOnConsoleError } from '../support/renderPage';
import { url } from '../support/handlers';
import { CATEGORIES } from '../support/fixtures';

failOnConsoleError();

const categoryHandlers = (data: unknown = CATEGORIES) => [
  http.get(url('/categories'), () => HttpResponse.json({ data })),
];

describe('Categories page — smoke', () => {
  it('shows loading, then renders categories (the loading->loaded transition)', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });

    expect(screen.getByText(/Loading categories/i)).toBeInTheDocument();

    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.queryByText(/Loading categories/i)).toBeNull();
  });

  it('renders the page heading', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });
    expect(
      await screen.findByRole('heading', { level: 1, name: /categories/i }),
    ).toBeInTheDocument();
  });

  it('renders every category from the API', async () => {
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });
    expect(await screen.findByText('Food')).toBeInTheDocument();
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
  });

  it('renders the real error branch when the request fails', async () => {
    // Unique in the app: an actual isError branch with its own copy, so this asserts the
    // literal message rather than falling back to the toast.
    renderPage(<CategoriesPage />, {
      route: '/categories',
      handlers: [
        http.get(url('/categories'), () =>
          HttpResponse.json({ message: 'Server exploded' }, { status: 500 })),
      ],
    });

    expect(
      await screen.findByText('Failed to load categories. Please refresh the page.'),
    ).toBeInTheDocument();
  });

  it('opens the add-category form when the primary action is clicked', async () => {
    const user = userEvent.setup();
    renderPage(<CategoriesPage />, { route: '/categories', handlers: categoryHandlers() });
    await screen.findByText('Food');

    await user.click(screen.getByRole('button', { name: /add category/i }));

    // The form's submit button reuses the "Add Category" label, so match the modal
    // heading (h2) rather than a button name that is deliberately ambiguous.
    expect(
      await screen.findByRole('heading', { level: 2, name: /add category/i }),
    ).toBeInTheDocument();
  });
});
