import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { PageLoader } from '@/components/shared/LoadingSpinner';
import { useFY } from '@/contexts/FYContext';
import { fetchProfitAndLoss } from '@/api/dashboard';
import { formatINRShort } from '@/lib/indianFormat';
import {
  useChartGradients,
  CHART_PALETTE,
  CustomTooltip,
  AXIS_STYLE,
  GRID_STYLE,
} from '@/lib/chartUtils';

export default function ProfitLossPage() {
  const { selectedFY } = useFY();
  const { gradIds, GradDefs } = useChartGradients();

  const { data, isLoading } = useQuery({
    queryKey: ['profit-and-loss', selectedFY],
    queryFn: () => fetchProfitAndLoss(selectedFY),
  });

  if (isLoading) return <PageLoader />;

  const summary = data?.summary;
  const monthly = data?.monthly ?? [];
  const expenseCategories = data?.expenseCategories ?? [];
  const incomeCategories = data?.incomeCategories ?? [];

  const hasMonthlyData = monthly.some((m) => m.income > 0 || m.expense > 0);

  const expensePieData = expenseCategories.slice(0, 9).map((item, i) => ({
    name: item.categoryName,
    value: item.total,
    color: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length],
  }));

  const expenseBarData = expenseCategories.slice(0, 15).map((item) => ({
    name: item.categoryName,
    amount: item.total,
  }));

  const incomePieData = incomeCategories.slice(0, 9).map((item, i) => ({
    name: item.categoryName,
    value: item.total,
    color: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length],
  }));

  const incomeBarData = incomeCategories.slice(0, 15).map((item) => ({
    name: item.categoryName,
    amount: item.total,
  }));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Profit &amp; Loss</h1>
        <p className="text-muted-foreground text-sm mt-1">FY {selectedFY} · Income vs expenses breakdown</p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border bg-card p-5 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Income</p>
            <INRDisplay amount={summary.totalIncome} short className="text-2xl font-bold text-green-600 dark:text-green-400" />
          </div>
          <div className="rounded-xl border bg-card p-5 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Expenses</p>
            <INRDisplay amount={summary.totalExpense} short className="text-2xl font-bold text-rose-600 dark:text-rose-400" />
          </div>
          <div className="rounded-xl border bg-card p-5 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Net Savings</p>
            <INRDisplay
              amount={summary.netSavings}
              short
              colorCode
              className="text-2xl font-bold"
            />
          </div>
          <div className="rounded-xl border bg-card p-5 space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Savings Rate</p>
            <p className={`text-2xl font-bold tabular-nums ${summary.savingsRate >= 0 ? 'text-green-600 dark:text-green-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {summary.savingsRate.toFixed(1)}%
            </p>
          </div>
        </div>
      )}

      {/* Monthly trend */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Monthly Trend</h2>
        <div className="rounded-xl border bg-card p-4">
          {!hasMonthlyData ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              No data for this financial year
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={monthly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <GradDefs />
                <CartesianGrid {...GRID_STYLE} />
                <XAxis dataKey="month" {...AXIS_STYLE} />
                <YAxis tickFormatter={(v) => formatINRShort(v)} width={72} {...AXIS_STYLE} />
                <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                <Area
                  type="natural"
                  dataKey="income"
                  name="Income"
                  stroke={CHART_PALETTE.income}
                  fill={`url(#${gradIds.income})`}
                  strokeWidth={2}
                />
                <Area
                  type="natural"
                  dataKey="expense"
                  name="Expenses"
                  stroke={CHART_PALETTE.expense}
                  fill={`url(#${gradIds.expense})`}
                  strokeWidth={2}
                />
                <Area
                  type="natural"
                  dataKey="net"
                  name="Net Savings"
                  stroke={CHART_PALETTE.net}
                  fill={`url(#${gradIds.net})`}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Expense breakdown */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Expense Breakdown</h2>
        {expenseCategories.length === 0 ? (
          <div className="text-center py-8 border rounded-xl text-muted-foreground text-sm">
            No expense data for this financial year
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-xl border bg-card p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={expenseBarData} layout="vertical" margin={{ left: 80, top: 4, right: 8, bottom: 0 }}>
                  <CartesianGrid {...GRID_STYLE} horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} {...AXIS_STYLE} />
                  <YAxis type="category" dataKey="name" width={75} {...AXIS_STYLE} />
                  <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                  <Bar
                    dataKey="amount"
                    name="Spent"
                    fill={CHART_PALETTE.expense}
                    radius={[0, 4, 4, 0]}
                    animationDuration={600}
                    animationEasing="ease-out"
                    activeBar={{ fill: '#fb7185', radius: [0, 4, 4, 0] }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={expensePieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={44}
                    outerRadius={88}
                    paddingAngle={2}
                    strokeWidth={0}
                    label={false}
                  >
                    {expensePieData.map((_entry, i) => (
                      <Cell key={i} fill={CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {expenseCategories.map((item, i) => (
                  <div key={item.categoryId ?? i} className="flex items-center justify-between text-sm py-1 border-b border-muted last:border-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length] }}
                      />
                      <span>{item.categoryName}</span>
                    </div>
                    <INRDisplay amount={item.total} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Income breakdown */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Income Sources</h2>
        {incomeCategories.length === 0 ? (
          <div className="text-center py-8 border rounded-xl text-muted-foreground text-sm">
            No income data for this financial year
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-xl border bg-card p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={incomeBarData} layout="vertical" margin={{ left: 80, top: 4, right: 8, bottom: 0 }}>
                  <CartesianGrid {...GRID_STYLE} horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} {...AXIS_STYLE} />
                  <YAxis type="category" dataKey="name" width={75} {...AXIS_STYLE} />
                  <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                  <Bar
                    dataKey="amount"
                    name="Received"
                    fill={CHART_PALETTE.income}
                    radius={[0, 4, 4, 0]}
                    animationDuration={600}
                    animationEasing="ease-out"
                    activeBar={{ fill: '#34d399', radius: [0, 4, 4, 0] }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={incomePieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={44}
                    outerRadius={88}
                    paddingAngle={2}
                    strokeWidth={0}
                    label={false}
                  >
                    {incomePieData.map((_entry, i) => (
                      <Cell key={i} fill={CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip formatter={formatINRShort} />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {incomeCategories.map((item, i) => (
                  <div key={item.categoryId ?? i} className="flex items-center justify-between text-sm py-1 border-b border-muted last:border-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length] }}
                      />
                      <span>{item.categoryName}</span>
                    </div>
                    <INRDisplay amount={item.total} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
