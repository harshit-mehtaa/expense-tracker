/**
 * Tests for chartUtils — the shared recharts palette, per-instance SVG gradient
 * defs, and the custom tooltip.
 *
 * The tooltip's fallback chains (`entry.color ?? entry.stroke` and
 * `entry.name ?? dataKey ?? ''`) are exercised on BOTH sides: recharts populates
 * different fields depending on the series type, so a chart that renders correctly
 * as an Area can lose its legend swatch as a Line if only one side is covered.
 */
import { describe, it, expect } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import {
  CHART_PALETTE,
  useChartGradients,
  ChartGradDefs,
  CustomTooltip,
  AXIS_STYLE,
  GRID_STYLE,
} from '@/lib/chartUtils';

// ─── Palette ──────────────────────────────────────────────────────────────────

describe('CHART_PALETTE', () => {
  it('exposes the four semantic series colours as hex', () => {
    expect(CHART_PALETTE.income).toBe('#10b981');
    expect(CHART_PALETTE.expense).toBe('#f43f5e');
    expect(CHART_PALETTE.net).toBe('#6366f1');
    expect(CHART_PALETTE.neutral).toBe('#8b5cf6');
  });

  it('provides exactly 12 categorical slots', () => {
    expect(CHART_PALETTE.categorical).toHaveLength(12);
  });

  it('has no duplicate categorical colours, so adjacent pie slices stay distinct', () => {
    expect(new Set(CHART_PALETTE.categorical).size).toBe(12);
  });

  it('uses well-formed 6-digit hex throughout', () => {
    for (const c of CHART_PALETTE.categorical) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// ─── useChartGradients ────────────────────────────────────────────────────────

describe('useChartGradients', () => {
  it('returns the three gradient ids and a defs component', () => {
    const { result } = renderHook(() => useChartGradients());
    expect(result.current.gradIds.income).toMatch(/^grad-income-/);
    expect(result.current.gradIds.expense).toMatch(/^grad-expense-/);
    expect(result.current.gradIds.net).toMatch(/^grad-net-/);
    expect(typeof result.current.GradDefs).toBe('function');
  });

  it('strips colons from useId so the value is a legal SVG id / url(#…) target', () => {
    const { result } = renderHook(() => useChartGradients());
    for (const id of Object.values(result.current.gradIds)) {
      expect(id).not.toContain(':');
    }
  });

  it('gives two separate chart instances different ids, preventing defs collisions', () => {
    const a = renderHook(() => useChartGradients());
    const b = renderHook(() => useChartGradients());
    expect(a.result.current.gradIds.income).not.toBe(b.result.current.gradIds.income);
  });

  it('keeps the GradDefs component reference stable across re-renders', () => {
    // A changing reference would remount the <defs> subtree and flash the gradient fill.
    const { result, rerender } = renderHook(() => useChartGradients());
    const first = result.current.GradDefs;
    rerender();
    expect(result.current.GradDefs).toBe(first);
  });

  it('renders three linearGradients when the returned GradDefs is mounted', () => {
    const { result } = renderHook(() => useChartGradients());
    const { GradDefs } = result.current;
    const { container } = render(<svg><GradDefs /></svg>);
    expect(container.querySelectorAll('linearGradient')).toHaveLength(3);
  });
});

// ─── ChartGradDefs ────────────────────────────────────────────────────────────

describe('ChartGradDefs', () => {
  const ids = { income: 'i1', expense: 'e1', net: 'n1' };

  it('renders a linearGradient per supplied id', () => {
    const { container } = render(<svg><ChartGradDefs ids={ids} /></svg>);
    expect(container.querySelector('#i1')).toBeTruthy();
    expect(container.querySelector('#e1')).toBeTruthy();
    expect(container.querySelector('#n1')).toBeTruthy();
  });

  it('gives each gradient two stops fading 0.50 -> 0.05', () => {
    const { container } = render(<svg><ChartGradDefs ids={ids} /></svg>);
    const stops = container.querySelectorAll('#i1 stop');
    expect(stops).toHaveLength(2);
    expect(stops[0].getAttribute('stop-opacity')).toBe('0.5');
    expect(stops[1].getAttribute('stop-opacity')).toBe('0.05');
  });

  it('colours each gradient from the matching palette entry', () => {
    const { container } = render(<svg><ChartGradDefs ids={ids} /></svg>);
    expect(container.querySelector('#i1 stop')?.getAttribute('stop-color'))
      .toBe(CHART_PALETTE.income);
    expect(container.querySelector('#e1 stop')?.getAttribute('stop-color'))
      .toBe(CHART_PALETTE.expense);
    expect(container.querySelector('#n1 stop')?.getAttribute('stop-color'))
      .toBe(CHART_PALETTE.net);
  });
});

// ─── CustomTooltip ────────────────────────────────────────────────────────────

describe('CustomTooltip', () => {
  const entry = { color: '#6366f1', name: 'Income', value: 125000, dataKey: 'income' };

  it('renders nothing when inactive', () => {
    const { container } = render(<CustomTooltip active={false} payload={[entry]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when payload is undefined', () => {
    const { container } = render(<CustomTooltip active />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when payload is an empty array', () => {
    const { container } = render(<CustomTooltip active payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('formats the value with en-IN grouping by default', () => {
    render(<CustomTooltip active payload={[entry]} />);
    // 125000 -> lakh grouping, not 125,000.
    expect(screen.getByText('1,25,000')).toBeInTheDocument();
  });

  it('uses a supplied formatter instead of the default', () => {
    render(<CustomTooltip active payload={[entry]} formatter={(v) => `₹${v.toFixed(2)}`} />);
    expect(screen.getByText('₹125000.00')).toBeInTheDocument();
  });

  it('renders the label and its divider when a label is given', () => {
    const { container } = render(<CustomTooltip active payload={[entry]} label="April" />);
    expect(screen.getByText('April')).toBeInTheDocument();
    expect(container.querySelector('.border-t')).toBeTruthy();
  });

  it('omits the label block entirely when label is absent', () => {
    const { container } = render(<CustomTooltip active payload={[entry]} />);
    expect(container.querySelector('.border-t')).toBeNull();
  });

  it('omits the label block when label is an empty string', () => {
    const { container } = render(<CustomTooltip active payload={[entry]} label="" />);
    expect(container.querySelector('.border-t')).toBeNull();
  });

  it('uses entry.color for the swatch when present', () => {
    const { container } = render(<CustomTooltip active payload={[entry]} />);
    const swatch = container.querySelector('.rounded-full') as HTMLElement;
    expect(swatch.style.backgroundColor).toBe('rgb(99, 102, 241)'); // #6366f1
  });

  it('falls back to entry.stroke when color is absent (the Line-series shape)', () => {
    const strokeOnly = { stroke: '#10b981', name: 'Net', value: 10 };
    const { container } = render(<CustomTooltip active payload={[strokeOnly]} />);
    const swatch = container.querySelector('.rounded-full') as HTMLElement;
    expect(swatch.style.backgroundColor).toBe('rgb(16, 185, 129)'); // #10b981
  });

  it('uses entry.name for the series label when present', () => {
    render(<CustomTooltip active payload={[entry]} />);
    expect(screen.getByText('Income')).toBeInTheDocument();
  });

  it('falls back to dataKey when name is absent', () => {
    const noName = { color: '#000', dataKey: 'expense', value: 5 };
    render(<CustomTooltip active payload={[noName]} />);
    expect(screen.getByText('expense')).toBeInTheDocument();
  });

  it('renders a row even when both name and dataKey are absent', () => {
    const bare = { color: '#000', value: 7 };
    const { container } = render(<CustomTooltip active payload={[bare]} />);
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(1);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('treats a missing value as 0 rather than rendering undefined', () => {
    const noValue = { color: '#000', name: 'Empty' };
    render(<CustomTooltip active payload={[noValue]} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders one row per payload entry', () => {
    const multi = [entry, { color: '#f43f5e', name: 'Expense', value: 50000 }];
    const { container } = render(<CustomTooltip active payload={multi} />);
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(2);
    expect(screen.getByText('Income')).toBeInTheDocument();
    expect(screen.getByText('Expense')).toBeInTheDocument();
  });
});

// ─── Shared axis / grid style ─────────────────────────────────────────────────

describe('shared chart styles', () => {
  it('AXIS_STYLE hides the axis and tick lines and uses a theme-neutral tick fill', () => {
    expect(AXIS_STYLE.axisLine).toBe(false);
    expect(AXIS_STYLE.tickLine).toBe(false);
    expect(AXIS_STYLE.tick).toEqual({ fontSize: 11, fill: '#94a3b8' });
  });

  it('GRID_STYLE draws dashed horizontal-only lines', () => {
    expect(GRID_STYLE.strokeDasharray).toBe('3 3');
    expect(GRID_STYLE.vertical).toBe(false);
    expect(GRID_STYLE.stroke).toBe('rgba(148, 163, 184, 0.25)');
  });
});
