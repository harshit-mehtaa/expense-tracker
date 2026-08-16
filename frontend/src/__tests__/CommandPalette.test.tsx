/**
 * Tests for CommandPalette — the global transaction search overlay.
 *
 * Uses real timers rather than fake ones: the component debounces input by 300ms and
 * focuses via a 30ms timeout, and Testing Library's findBy* default timeout (1000ms)
 * comfortably covers both. Fake timers would have to be threaded through userEvent,
 * which buys nothing here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse, delay } from 'msw';
import React from 'react';
import { server } from './mswServer';
import { CommandPalette } from '@/components/shared/CommandPalette';

const API = 'http://localhost:3000';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const RESULTS = [
  {
    id: 'tx-1',
    description: 'Coffee at Blue Tokai',
    amount: 450,
    type: 'EXPENSE' as const,
    date: '2025-06-01T00:00:00.000Z',
    categoryName: 'Food',
  },
  {
    id: 'tx-2',
    description: 'Salary credit',
    amount: 125000,
    type: 'INCOME' as const,
    date: '2025-06-02T00:00:00.000Z',
  },
];

function searchHandler(results: typeof RESULTS = RESULTS, delayMs = 0) {
  return http.get(`${API}/transactions`, async () => {
    if (delayMs) await delay(delayMs);
    return HttpResponse.json({ data: results });
  });
}

function renderPalette(props: Partial<React.ComponentProps<typeof CommandPalette>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandPalette open={props.open ?? true} onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  navigate.mockClear();
});

describe('CommandPalette — closed', () => {
  it('renders nothing when open is false', () => {
    const { container } = renderPalette({ open: false });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CommandPalette — open, before typing', () => {
  it('renders the search input', () => {
    renderPalette();
    expect(screen.getByPlaceholderText('Search transactions…')).toBeInTheDocument();
  });

  it('prompts the user to type', () => {
    renderPalette();
    expect(screen.getByText('Type to search transactions')).toBeInTheDocument();
  });

  it('shows the Esc hint while the query is empty', () => {
    renderPalette();
    expect(screen.getByText('Esc')).toBeInTheDocument();
  });

  it('shows no clear button while the query is empty', () => {
    renderPalette();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('CommandPalette — searching', () => {
  it('shows a searching indicator while the request is in flight', async () => {
    server.use(searchHandler(RESULTS, 300));
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'coffee');

    expect(await screen.findByText('Searching…')).toBeInTheDocument();
  });

  it('renders matching transactions after debounce', async () => {
    server.use(searchHandler());
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'coffee');

    expect(await screen.findByText('Coffee at Blue Tokai')).toBeInTheDocument();
    expect(screen.getByText('Salary credit')).toBeInTheDocument();
  });

  it('renders an expense as a negative Indian-formatted amount', async () => {
    server.use(searchHandler());
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'coffee');
    await screen.findByText('Coffee at Blue Tokai');

    expect(screen.getByText('-₹450.00')).toBeInTheDocument();
  });

  it('renders income as a positive Indian-formatted amount with lakh grouping', async () => {
    server.use(searchHandler());
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'salary');
    await screen.findByText('Salary credit');

    expect(screen.getByText('₹1,25,000.00')).toBeInTheDocument();
  });

  it('appends the category name when the result has one', async () => {
    server.use(searchHandler());
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'coffee');
    await screen.findByText('Coffee at Blue Tokai');

    expect(screen.getByText(/· Food/)).toBeInTheDocument();
  });

  it('omits the category separator when the result has none', async () => {
    server.use(searchHandler([RESULTS[1]]));
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'salary');
    await screen.findByText('Salary credit');

    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('reports when a query returns nothing', async () => {
    server.use(searchHandler([]));
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'nonsense');

    expect(await screen.findByText('No results for "nonsense"')).toBeInTheDocument();
  });

  it('sends the typed query and a result limit to the API', async () => {
    let captured: string | undefined;
    server.use(
      http.get(`${API}/transactions`, ({ request }) => {
        captured = request.url;
        return HttpResponse.json({ data: [] });
      }),
    );
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'coffee');
    await screen.findByText('No results for "coffee"');

    expect(captured).toContain('search=coffee');
    expect(captured).toContain('limit=8');
  });
});

describe('CommandPalette — clearing the query', () => {
  it('shows a clear button once text is entered', async () => {
    const user = userEvent.setup();
    renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'a');

    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.queryByText('Esc')).toBeNull();
  });

  it('clears the input when the clear button is clicked', async () => {
    const user = userEvent.setup();
    renderPalette();
    const input = screen.getByPlaceholderText('Search transactions…') as HTMLInputElement;

    await user.type(input, 'coffee');
    await user.click(screen.getByRole('button'));

    expect(input.value).toBe('');
    expect(await screen.findByText('Type to search transactions')).toBeInTheDocument();
  });
});

describe('CommandPalette — dismissal', () => {
  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores other keys', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();

    await user.keyboard('{Enter}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes when the backdrop itself is clicked', async () => {
    const user = userEvent.setup();
    const { container, onClose } = renderPalette();

    await user.click(container.firstElementChild as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT close when a click lands inside the panel', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPalette();

    await user.click(screen.getByPlaceholderText('Search transactions…'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('detaches the Escape listener once closed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandPalette open onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommandPalette open={false} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CommandPalette — selecting a result', () => {
  it('navigates to transactions and closes', async () => {
    server.use(searchHandler());
    const user = userEvent.setup();
    const { onClose } = renderPalette();

    await user.type(screen.getByPlaceholderText('Search transactions…'), 'coffee');
    await user.click(await screen.findByText('Coffee at Blue Tokai'));

    expect(navigate).toHaveBeenCalledWith('/transactions');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
