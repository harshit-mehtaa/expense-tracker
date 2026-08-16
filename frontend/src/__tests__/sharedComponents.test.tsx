/**
 * Tests for the presentational components in src/components/shared.
 *
 * INRDisplay is covered separately in INRDisplay.test.tsx.
 * PageHeader and ErrorBoundary are deliberately NOT tested: neither has a single
 * importer anywhere in src/, so testing them would inflate coverage with code that
 * never runs in the application.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wallet } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { LoadingSpinner, PageLoader } from '@/components/shared/LoadingSpinner';
import { TablePagination } from '@/components/shared/TablePagination';
import { BankLogo } from '@/components/shared/BankLogo';
import { INRDisplay } from '@/components/shared/INRDisplay';

// ─── EmptyState ───────────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No accounts" />);
    expect(screen.getByRole('heading', { name: 'No accounts' })).toBeInTheDocument();
  });

  it('renders the description when supplied', () => {
    render(<EmptyState title="No accounts" description="Add one to get started" />);
    expect(screen.getByText('Add one to get started')).toBeInTheDocument();
  });

  it('omits the description paragraph when not supplied', () => {
    const { container } = render(<EmptyState title="No accounts" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders the icon when supplied', () => {
    const { container } = render(<EmptyState title="Empty" icon={Wallet} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('omits the icon wrapper when no icon is supplied', () => {
    const { container } = render(<EmptyState title="Empty" />);
    expect(container.querySelector('.bg-muted')).toBeNull();
  });

  it('renders the action button when BOTH label and handler are supplied', () => {
    render(<EmptyState title="Empty" actionLabel="Add budget" onAction={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add budget' })).toBeInTheDocument();
  });

  it('renders no button when the label is supplied without a handler', () => {
    render(<EmptyState title="Empty" actionLabel="Add budget" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders no button when the handler is supplied without a label', () => {
    render(<EmptyState title="Empty" onAction={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('invokes onAction when the button is clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<EmptyState title="Empty" actionLabel="Go" onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: 'Go' }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

// ─── LoadingSpinner ───────────────────────────────────────────────────────────

describe('LoadingSpinner', () => {
  it('exposes role="status" — other tests rely on this as the loading affordance', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('defaults its accessible name to "Loading..."', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading...');
  });

  it('uses a supplied label as the accessible name', () => {
    render(<LoadingSpinner label="Fetching budgets" />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Fetching budgets');
  });

  it('renders the label as visible text when supplied', () => {
    render(<LoadingSpinner label="Fetching budgets" />);
    expect(screen.getByText('Fetching budgets')).toBeInTheDocument();
  });

  it('renders no visible text when no label is supplied', () => {
    const { container } = render(<LoadingSpinner />);
    expect(container.querySelector('p')).toBeNull();
  });

  it.each([
    ['sm', 'h-4 w-4'],
    ['md', 'h-8 w-8'],
    ['lg', 'h-12 w-12'],
  ] as const)('applies the %s size classes', (size, expected) => {
    render(<LoadingSpinner size={size} />);
    expect(screen.getByRole('status').className).toContain(expected);
  });

  it('defaults to the md size', () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole('status').className).toContain('h-8 w-8');
  });

  it('merges a custom className onto the wrapper', () => {
    const { container } = render(<LoadingSpinner className="my-custom-class" />);
    expect(container.querySelector('.my-custom-class')).not.toBeNull();
  });
});

describe('PageLoader', () => {
  it('renders a large spinner labelled "Loading..."', () => {
    render(<PageLoader />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading...');
    expect(status.className).toContain('h-12 w-12');
  });
});

// ─── TablePagination ──────────────────────────────────────────────────────────

describe('TablePagination', () => {
  it('renders nothing at all when there are zero items', () => {
    const { container } = render(
      <TablePagination page={1} pageSize={10} total={0} onPageChange={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the 1-based range and total', () => {
    render(<TablePagination page={1} pageSize={10} total={95} onPageChange={() => {}} />);
    expect(screen.getByText(/Showing 1–10 of 95/)).toBeInTheDocument();
  });

  it('clamps the range end to the total on a partial last page', () => {
    // page 10 of pageSize 10 would end at 100, but there are only 95 items.
    render(<TablePagination page={10} pageSize={10} total={95} onPageChange={() => {}} />);
    expect(screen.getByText(/Showing 91–95 of 95/)).toBeInTheDocument();
  });

  it('renders the current page over the computed total pages', () => {
    render(<TablePagination page={3} pageSize={10} total={95} onPageChange={() => {}} />);
    // ceil(95/10) = 10
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
  });

  it('disables Previous on the first page', () => {
    render(<TablePagination page={1} pageSize={10} total={95} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('disables Next on the last page', () => {
    render(<TablePagination page={10} pageSize={10} total={95} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
  });

  it('disables both controls when there is only one page', () => {
    render(<TablePagination page={1} pageSize={10} total={5} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('enables both controls in the middle of the range', () => {
    render(<TablePagination page={5} pageSize={10} total={95} onPageChange={() => {}} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();
  });

  it('requests the previous page number when Previous is clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<TablePagination page={5} pageSize={10} total={95} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: /previous/i }));

    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it('requests the next page number when Next is clicked', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<TablePagination page={5} pageSize={10} total={95} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(onPageChange).toHaveBeenCalledWith(6);
  });
});

// ─── BankLogo ─────────────────────────────────────────────────────────────────

describe('BankLogo — known banks', () => {
  it.each([
    ['HDFC Bank', 'HDFC'],
    ['State Bank of India', 'SBI'],
    ['ICICI Bank', 'ICICI'],
    ['Axis Bank', 'AXIS'],
    ['Kotak Mahindra Bank', 'K'],
    ['Punjab National Bank', 'PNB'],
    ['Bank of Baroda', 'BoB'],
    ['Canara Bank', 'CAN'],
    ['IDFC First Bank', 'IDFC'],
    ['IndusInd Bank', 'IIB'],
    ['Federal Bank', 'F'],
    ['RBL Bank', 'RBL'],
    ['HSBC India', 'HSBC'],
    ['Citi Bank', 'CITI'],
    ['American Express', 'AMEX'],
  ])('maps %s to the %s badge', (bankName, label) => {
    render(<BankLogo bankName={bankName} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('matches the SBI alias as well as the full name', () => {
    render(<BankLogo bankName="SBI" />);
    expect(screen.getByText('SBI')).toBeInTheDocument();
  });

  it('applies the brand background colour for a known bank', () => {
    const { container } = render(<BankLogo bankName="HDFC Bank" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveStyle({ backgroundColor: '#004C8F' });
  });

  it('renders the accent stripe for a bank that defines one', () => {
    const { container } = render(<BankLogo bankName="HDFC Bank" />);
    expect(container.querySelector('.absolute.inset-x-0.bottom-0')).not.toBeNull();
  });

  it('renders no accent stripe for a bank without one', () => {
    const { container } = render(<BankLogo bankName="Axis Bank" />);
    expect(container.querySelector('.absolute.inset-x-0.bottom-0')).toBeNull();
  });

  it('uses the bank name in the accessible label', () => {
    render(<BankLogo bankName="HDFC Bank" />);
    expect(screen.getByLabelText('HDFC Bank logo')).toBeInTheDocument();
  });
});

describe('BankLogo — unknown banks fall back', () => {
  it('derives initials from a multi-word name, stripping filler words', () => {
    // "Bank" is stripped, leaving Zorp / Trust / Holdings -> ZTH
    render(<BankLogo bankName="Zorp Trust Holdings Bank" />);
    expect(screen.getByText('ZTH')).toBeInTheDocument();
  });

  it('uses the first three letters for a single-word name', () => {
    render(<BankLogo bankName="Zorpington" />);
    expect(screen.getByText('ZOR')).toBeInTheDocument();
  });

  it('assigns a deterministic fallback colour from the name hash', () => {
    const { container: a } = render(<BankLogo bankName="Zorpington" />);
    const { container: b } = render(<BankLogo bankName="Zorpington" />);
    const colorA = (a.querySelector('span') as HTMLElement).style.backgroundColor;
    const colorB = (b.querySelector('span') as HTMLElement).style.backgroundColor;
    expect(colorA).toBe(colorB);
    expect(colorA).not.toBe('');
  });

  it('falls back to white foreground for an unknown bank', () => {
    const { container } = render(<BankLogo bankName="Zorpington" />);
    expect(container.querySelector('span')).toHaveStyle({ color: '#ffffff' });
  });
});

describe('BankLogo — no usable name', () => {
  it('renders the generic icon when the name reduces to nothing', () => {
    // Every word is a stripped filler word, so getInitials returns ''.
    const { container } = render(<BankLogo bankName="Bank Limited" />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders the generic icon and label when bankName is undefined', () => {
    const { container } = render(<BankLogo />);
    expect(screen.getByLabelText('Bank logo')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders the generic icon when bankName is null', () => {
    render(<BankLogo bankName={null} />);
    expect(screen.getByLabelText('Bank logo')).toBeInTheDocument();
  });

  it('treats a whitespace-only name as absent', () => {
    render(<BankLogo bankName="   " />);
    expect(screen.getByLabelText('Bank logo')).toBeInTheDocument();
  });
});

describe('BankLogo — sizing', () => {
  it.each([
    ['sm', 'h-8 w-8'],
    ['md', 'h-10 w-10'],
    ['lg', 'h-12 w-12'],
  ] as const)('applies the %s size classes', (size, expected) => {
    const { container } = render(<BankLogo bankName="HDFC Bank" size={size} />);
    expect((container.querySelector('span') as HTMLElement).className).toContain(expected);
  });

  it('defaults to the md size', () => {
    const { container } = render(<BankLogo bankName="HDFC Bank" />);
    expect((container.querySelector('span') as HTMLElement).className).toContain('h-10 w-10');
  });

  it('merges a custom className', () => {
    const { container } = render(<BankLogo bankName="HDFC Bank" className="ring-4" />);
    expect((container.querySelector('span') as HTMLElement).className).toContain('ring-4');
  });
});

// ─── INRDisplay colour props ──────────────────────────────────────────────────
// INRDisplay's formatting behaviour is covered in INRDisplay.test.tsx; these close
// the colour-prop branches that file does not reach.

describe('INRDisplay — colour props', () => {
  it('forces green with the positive prop, regardless of sign', () => {
    const { container } = render(<INRDisplay amount={-500} positive />);
    expect(container.querySelector('span')!.className).toContain('text-green-600');
  });

  it('forces red with the negative prop, regardless of sign', () => {
    const { container } = render(<INRDisplay amount={500} negative />);
    expect(container.querySelector('span')!.className).toContain('text-red-600');
  });

  it('colorCode renders zero as muted rather than green or red', () => {
    const { container } = render(<INRDisplay amount={0} colorCode />);
    const cls = container.querySelector('span')!.className;
    expect(cls).toContain('text-muted-foreground');
    expect(cls).not.toContain('text-green-600');
    expect(cls).not.toContain('text-red-600');
  });

  it('colorCode renders a positive amount green', () => {
    const { container } = render(<INRDisplay amount={500} colorCode />);
    expect(container.querySelector('span')!.className).toContain('text-green-600');
  });

  it('colorCode renders a negative amount red', () => {
    const { container } = render(<INRDisplay amount={-500} colorCode />);
    expect(container.querySelector('span')!.className).toContain('text-red-600');
  });

  it('uses a custom fallback for a null amount', () => {
    render(<INRDisplay amount={null} fallback="n/a" />);
    expect(screen.getByText('n/a')).toBeInTheDocument();
  });
});
