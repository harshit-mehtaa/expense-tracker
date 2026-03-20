import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { useFY } from '@/contexts/FYContext';
import api from '@/lib/api';

const COLORS = ['#FF9933', '#138808', '#000080', '#9B2335', '#2E86C1', '#8E44AD', '#117A65', '#784212', '#D4AC0D'];

export default function ReportsPage() {
  const { selectedFY } = useFY();

  const { data: spendingByCat = [] } = useQuery({
    queryKey: ['report-spending', selectedFY],
    queryFn: () => api.get<{ data: any[] }>(`/reports/spending-by-category?fy=${selectedFY}`).then((r) => r.data.data),
  });

  const { data: netWorth } = useQuery({
    queryKey: ['report-networth'],
    queryFn: () => api.get<{ data: any }>('/reports/net-worth-statement').then((r) => r.data.data),
  });

  const pieData = spendingByCat.slice(0, 9).map((item: any, i: number) => ({
    name: item.category?.name ?? 'Uncategorized',
    value: item.total,
    color: COLORS[i % COLORS.length],
  }));

  const barData = spendingByCat.slice(0, 15).map((item: any) => ({
    name: item.category?.name ?? 'Uncategorized',
    amount: item.total,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground text-sm mt-1">FY {selectedFY} · Family financial overview</p>
      </div>

      {/* Net Worth Statement */}
      {netWorth && (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">Net Worth Statement</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-1 rounded-lg border bg-card p-5 space-y-3">
              <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Assets</h3>
              {Object.entries(netWorth.assets).map(([key, val]) => {
                const labels: Record<string, string> = {
                  bankBalances: 'Bank Balances', fixedDeposits: 'Fixed Deposits',
                  recurringDeposits: 'Recurring Deposits', investments: 'Investments',
                  gold: 'Gold', realEstate: 'Real Estate',
                };
                return (
                  <div key={key} className="flex justify-between text-sm">
                    <span>{labels[key] ?? key}</span>
                    <INRDisplay amount={val as number} />
                  </div>
                );
              })}
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Total Assets</span>
                <INRDisplay amount={netWorth.totalAssets} />
              </div>
            </div>
            <div className="rounded-lg border bg-card p-5 space-y-3">
              <h3 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">Liabilities</h3>
              <div className="flex justify-between text-sm">
                <span>Loans Outstanding</span>
                <INRDisplay amount={netWorth.liabilities.loans} />
              </div>
              <div className="border-t pt-2 flex justify-between font-semibold">
                <span>Total Liabilities</span>
                <INRDisplay amount={netWorth.totalLiabilities} />
              </div>
            </div>
            <div className="rounded-lg border bg-card p-5 flex flex-col items-center justify-center text-center">
              <p className="text-sm text-muted-foreground">Net Worth</p>
              <INRDisplay amount={netWorth.netWorth} short className="text-4xl font-bold mt-2" />
              <p className="text-sm text-muted-foreground mt-2">
                Assets − Liabilities
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Spending by Category */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Spending by Category — FY {selectedFY}</h2>
        {spendingByCat.length === 0 ? (
          <div className="text-center py-8 border rounded-lg text-muted-foreground">No spending data for this FY</div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Bar Chart */}
            <div className="rounded-lg border bg-card p-4">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                  <YAxis type="category" dataKey="name" width={75} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(val: number) => [`₹${val.toLocaleString('en-IN')}`, 'Spent']} />
                  <Bar dataKey="amount" fill="#FF9933" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pie Chart + Table */}
            <div className="space-y-4">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false}>
                    {pieData.map((entry: any, i: number) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip formatter={(val: number) => [`₹${val.toLocaleString('en-IN')}`, '']} />
                </PieChart>
              </ResponsiveContainer>

              <div className="space-y-1 max-h-64 overflow-y-auto">
                {spendingByCat.map((item: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1 border-b border-muted last:border-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: COLORS[i % COLORS.length] }}
                      />
                      <span>{item.category?.name ?? 'Uncategorized'}</span>
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
