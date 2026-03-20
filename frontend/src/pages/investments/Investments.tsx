import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { TrendingUp, Plus, Trash2, Edit2, Layers } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { investmentsApi, type Investment, type FD, type RD } from '@/api/investments';
import { useFY } from '@/contexts/FYContext';
import { cn } from '@/lib/utils';

const INV_TYPES: Record<string, string> = {
  STOCKS_INDIA: 'Indian Stocks', STOCKS_FOREIGN: 'Foreign Stocks', MUTUAL_FUND: 'Mutual Fund',
  ELSS: 'ELSS', PPF: 'PPF', NPS: 'NPS', EPF: 'EPF', SGB: 'SGB', GOLD_ETF: 'Gold ETF',
  BONDS: 'Bonds', CRYPTO: 'Crypto', OTHER: 'Other',
};

const TYPE_COLORS: Record<string, string> = {
  STOCKS_INDIA: '#FF9933', STOCKS_FOREIGN: '#1E90FF', MUTUAL_FUND: '#138808',
  ELSS: '#006400', PPF: '#8B4513', NPS: '#4B0082', EPF: '#800000',
  SGB: '#FFD700', GOLD_ETF: '#DAA520', BONDS: '#2F4F4F', CRYPTO: '#FF6347', OTHER: '#808080',
};

const fdSchema = z.object({
  bankName: z.string().min(1, 'Required'),
  principalAmount: z.coerce.number().positive(),
  interestRate: z.coerce.number().positive(),
  tenureMonths: z.coerce.number().int().positive(),
  startDate: z.string(),
  maturityDate: z.string(),
  interestPayoutType: z.enum(['CUMULATIVE', 'MONTHLY', 'QUARTERLY']).default('CUMULATIVE'),
  isTaxSaver: z.boolean().default(false),
  tdsApplicable: z.boolean().default(true),
  notes: z.string().optional(),
});

const invSchema = z.object({
  type: z.string(),
  name: z.string().min(1, 'Required'),
  currency: z.string().default('INR'),
  exchange: z.string().optional(),
  unitsOrQuantity: z.coerce.number().positive(),
  purchasePricePerUnit: z.coerce.number().positive(),
  purchaseDate: z.string(),
  purchaseExchangeRate: z.coerce.number().optional(),
  currentPricePerUnit: z.coerce.number().positive(),
  isTaxSaving: z.boolean().default(false),
  folioNumber: z.string().optional(),
  isin: z.string().optional(),
  tickerSymbolNSE: z.string().optional(),
  tickerSymbolForeign: z.string().optional(),
  notes: z.string().optional(),
});

type FDForm = z.infer<typeof fdSchema>;
type InvForm = z.infer<typeof invSchema>;

type TabType = 'portfolio' | 'fd' | 'rd' | 'sip';

export default function InvestmentsPage() {
  const { selectedFY } = useFY();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabType>('portfolio');
  const [showInvForm, setShowInvForm] = useState(false);
  const [showFDForm, setShowFDForm] = useState(false);
  const [editingFD, setEditingFD] = useState<FD | null>(null);

  const { data: portfolio } = useQuery({ queryKey: ['portfolio'], queryFn: investmentsApi.getPortfolioSummary });
  const { data: investments = [] } = useQuery({ queryKey: ['investments'], queryFn: () => investmentsApi.getAll() });
  const { data: fds = [] } = useQuery({ queryKey: ['fds'], queryFn: () => investmentsApi.getFDs() });
  const { data: rds = [] } = useQuery({ queryKey: ['rds'], queryFn: () => investmentsApi.getRDs() });
  const { data: sips = [] } = useQuery({ queryKey: ['sips'], queryFn: investmentsApi.getSIPs });
  const { data: tracker80C } = useQuery({ queryKey: ['tax-80c', selectedFY], queryFn: () => investmentsApi.get80CSummary(selectedFY) });

  const fdForm = useForm<FDForm>({ resolver: zodResolver(fdSchema), defaultValues: { interestPayoutType: 'CUMULATIVE', isTaxSaver: false, tdsApplicable: true } });
  const invForm = useForm<InvForm>({ resolver: zodResolver(invSchema), defaultValues: { type: 'MUTUAL_FUND', currency: 'INR', isTaxSaving: false } });

  const createFDMutation = useMutation({
    mutationFn: (data: FDForm) => investmentsApi.createFD(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['fds'] }); setShowFDForm(false); fdForm.reset(); setEditingFD(null); },
  });

  const deleteFDMutation = useMutation({
    mutationFn: investmentsApi.deleteFD,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fds'] }),
  });

  const createInvMutation = useMutation({
    mutationFn: (data: InvForm) => investmentsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['investments', 'portfolio'] }); setShowInvForm(false); invForm.reset(); },
  });

  const deleteInvMutation = useMutation({
    mutationFn: investmentsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['investments', 'portfolio'] }),
  });

  // Asset allocation pie chart data
  const pieData = portfolio
    ? Object.entries(portfolio.byType).map(([type, val]) => ({
        name: INV_TYPES[type] ?? type,
        value: val.current,
        color: TYPE_COLORS[type] ?? '#808080',
      })).filter((d) => d.value > 0)
    : [];

  const tabs = [
    { id: 'portfolio' as const, label: 'Portfolio' },
    { id: 'fd' as const, label: `FD (${fds.length})` },
    { id: 'rd' as const, label: `RD (${rds.length})` },
    { id: 'sip' as const, label: `SIP (${sips.length})` },
  ];

  const invCurrency = invForm.watch('currency');
  const invType = invForm.watch('type');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Investments & Portfolio</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowFDForm(true)}><Plus className="h-4 w-4 mr-1" /> Add FD</Button>
          <Button onClick={() => setShowInvForm(true)}><Plus className="h-4 w-4 mr-1" /> Add Investment</Button>
        </div>
      </div>

      {/* Portfolio Summary Cards */}
      {portfolio && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Total Invested</p>
            <INRDisplay amount={portfolio.totalInvested} short className="text-2xl font-bold" />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">Current Value</p>
            <INRDisplay amount={portfolio.totalCurrentValue} short className="text-2xl font-bold" />
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">P&L</p>
            <INRDisplay
              amount={portfolio.absoluteGain}
              short colorCode
              className={cn('text-2xl font-bold', portfolio.absoluteGain >= 0 ? 'text-green-600' : 'text-red-600')}
            />
            <p className={cn('text-sm', portfolio.absoluteReturnPct >= 0 ? 'text-green-600' : 'text-red-600')}>
              {portfolio.absoluteReturnPct >= 0 ? '+' : ''}{portfolio.absoluteReturnPct.toFixed(2)}%
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">XIRR</p>
            <p className={cn('text-2xl font-bold', (portfolio.xirr ?? 0) >= 0 ? 'text-green-600' : 'text-red-600')}>
              {portfolio.xirr != null ? `${(portfolio.xirr * 100).toFixed(2)}%` : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Portfolio Tab */}
      {tab === 'portfolio' && (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Holdings Table */}
          <div className="lg:col-span-2 space-y-3">
            {investments.length === 0 ? (
              <div className="text-center py-12 border rounded-lg">
                <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="font-medium">No investments yet</p>
                <p className="text-sm text-muted-foreground">Add stocks, mutual funds, ELSS, or other investments</p>
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-3">Name</th>
                      <th className="text-right px-4 py-3">Type</th>
                      <th className="text-right px-4 py-3">Invested</th>
                      <th className="text-right px-4 py-3">Current</th>
                      <th className="text-right px-4 py-3">P&L</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {investments.map((inv) => (
                      <tr key={inv.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium">{inv.name}</p>
                          {inv.currency !== 'INR' && <p className="text-xs text-muted-foreground">{inv.currency} · {inv.exchange}</p>}
                          {inv.isTaxSaving && <span className="text-xs bg-green-100 text-green-700 px-1 rounded">80C</span>}
                        </td>
                        <td className="text-right px-4 py-3 text-muted-foreground">{INV_TYPES[inv.type]}</td>
                        <td className="text-right px-4 py-3"><INRDisplay amount={inv.investedINR} /></td>
                        <td className="text-right px-4 py-3"><INRDisplay amount={inv.currentValueINR} /></td>
                        <td className="text-right px-4 py-3">
                          <INRDisplay amount={inv.gainINR} colorCode />
                          <p className={cn('text-xs', inv.gainPct >= 0 ? 'text-green-600' : 'text-red-600')}>
                            {inv.gainPct >= 0 ? '+' : ''}{inv.gainPct.toFixed(2)}%
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <Button variant="ghost" size="icon" onClick={() => deleteInvMutation.mutate(inv.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 80C Tracker */}
            {tracker80C && (
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-sm">80C Utilization (FY {selectedFY})</p>
                  <p className="text-sm"><INRDisplay amount={tracker80C.utilized} /> / ₹1,50,000</p>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${Math.min(tracker80C.pctUtilized, 100)}%` }}
                  />
                </div>
                {tracker80C.remaining > 0 && (
                  <p className="text-xs text-orange-600 mt-1"><INRDisplay amount={tracker80C.remaining} /> remaining</p>
                )}
              </div>
            )}
          </div>

          {/* Asset Allocation Pie */}
          <div className="rounded-lg border bg-card p-4">
            <h3 className="font-semibold mb-4 flex items-center gap-2"><Layers className="h-4 w-4" /> Asset Allocation</h3>
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false}>
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(val: number) => [`₹${(val / 100000).toFixed(1)}L`, '']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1 mt-2">
                  {pieData.map((entry) => (
                    <div key={entry.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        {entry.name}
                      </span>
                      <INRDisplay amount={entry.value} short />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-center text-muted-foreground text-sm py-8">No investments added yet</p>
            )}
          </div>
        </div>
      )}

      {/* FD Tab */}
      {tab === 'fd' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fds.length === 0 ? (
            <div className="col-span-full text-center py-12 border rounded-lg">
              <p className="font-medium">No Fixed Deposits added yet</p>
              <p className="text-sm text-muted-foreground mt-1">Track FD maturity dates and interest</p>
            </div>
          ) : fds.map((fd) => {
            const today = new Date();
            const maturity = new Date(fd.maturityDate);
            const daysToMaturity = Math.ceil((maturity.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const statusColor = fd.status === 'MATURED' ? 'text-gray-500' : daysToMaturity <= 30 ? 'text-yellow-600' : 'text-green-600';
            return (
              <div key={fd.id} className="rounded-lg border bg-card p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{fd.bankName}</p>
                    <p className="text-sm text-muted-foreground">{fd.interestRate}% · {fd.tenureMonths}M · {fd.interestPayoutType}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => deleteFDMutation.mutate(fd.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><p className="text-muted-foreground">Principal</p><INRDisplay amount={fd.principalAmount} className="font-semibold" /></div>
                  <div><p className="text-muted-foreground">At Maturity</p><INRDisplay amount={fd.maturityAmount} className="font-semibold text-green-600" /></div>
                  <div><p className="text-muted-foreground">Start</p><p>{new Date(fd.startDate).toLocaleDateString('en-IN')}</p></div>
                  <div><p className="text-muted-foreground">Maturity</p><p className={statusColor}>{new Date(fd.maturityDate).toLocaleDateString('en-IN')}</p></div>
                </div>
                <div className="flex gap-2">
                  {fd.isTaxSaver && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">80C</span>}
                  {daysToMaturity > 0 && daysToMaturity <= 30 && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Maturing soon</span>}
                  {fd.status === 'MATURED' && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Matured</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* RD Tab */}
      {tab === 'rd' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rds.length === 0 ? (
            <div className="col-span-full text-center py-12 border rounded-lg">
              <p className="font-medium">No Recurring Deposits added yet</p>
            </div>
          ) : rds.map((rd) => (
            <div key={rd.id} className="rounded-lg border bg-card p-5 space-y-3">
              <p className="font-semibold">{rd.bankName}</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-muted-foreground">Monthly</p><INRDisplay amount={rd.monthlyInstallment} className="font-semibold" /></div>
                <div><p className="text-muted-foreground">Rate</p><p>{rd.interestRate}%</p></div>
                <div><p className="text-muted-foreground">Deposited</p><INRDisplay amount={rd.totalDeposited} /></div>
                <div><p className="text-muted-foreground">At Maturity</p><INRDisplay amount={rd.maturityAmount} className="text-green-600 font-semibold" /></div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full"
                  style={{ width: `${Math.min((rd.installmentsPaid / rd.tenureMonths) * 100, 100)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{rd.installmentsPaid}/{rd.tenureMonths} installments · Matures {new Date(rd.maturityDate).toLocaleDateString('en-IN')}</p>
            </div>
          ))}
        </div>
      )}

      {/* SIP Tab */}
      {tab === 'sip' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sips.length === 0 ? (
            <div className="col-span-full text-center py-12 border rounded-lg">
              <p className="font-medium">No SIPs added yet</p>
              <p className="text-sm text-muted-foreground mt-1">Link SIPs to mutual fund investments</p>
            </div>
          ) : sips.map((sip) => (
            <div key={sip.id} className="rounded-lg border bg-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{sip.fundName}</p>
                <span className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  sip.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600',
                )}>
                  {sip.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><p className="text-muted-foreground">Monthly</p><INRDisplay amount={sip.monthlyAmount} className="font-semibold" /></div>
                <div><p className="text-muted-foreground">SIP Date</p><p>{sip.sipDate}th of month</p></div>
                <div><p className="text-muted-foreground">Started</p><p>{new Date(sip.startDate).toLocaleDateString('en-IN')}</p></div>
                <div><p className="text-muted-foreground">Current Value</p><INRDisplay amount={(sip.investment as any).currentValueINR ?? Number((sip.investment as any).unitsOrQuantity ?? 0) * Number((sip.investment as any).currentPricePerUnit ?? 0)} className="text-green-600" /></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add FD Form */}
      {showFDForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">Add Fixed Deposit</h2>
            <form onSubmit={fdForm.handleSubmit((data) => createFDMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1"><Label>Bank Name</Label><Input {...fdForm.register('bankName')} /></div>
                <div className="space-y-1"><Label>Principal (₹)</Label><Input {...fdForm.register('principalAmount')} type="number" /></div>
                <div className="space-y-1"><Label>Rate (% p.a.)</Label><Input {...fdForm.register('interestRate')} type="number" step="0.01" /></div>
                <div className="space-y-1"><Label>Tenure (months)</Label><Input {...fdForm.register('tenureMonths')} type="number" /></div>
                <div className="space-y-1">
                  <Label>Payout Type</Label>
                  <select {...fdForm.register('interestPayoutType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="CUMULATIVE">Cumulative</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                  </select>
                </div>
                <div className="space-y-1"><Label>Start Date</Label><Input {...fdForm.register('startDate')} type="date" /></div>
                <div className="space-y-1"><Label>Maturity Date</Label><Input {...fdForm.register('maturityDate')} type="date" /></div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2"><input type="checkbox" {...fdForm.register('isTaxSaver')} className="rounded" /><span className="text-sm">Tax Saver FD (80C)</span></label>
                <label className="flex items-center gap-2"><input type="checkbox" {...fdForm.register('tdsApplicable')} className="rounded" /><span className="text-sm">TDS Applicable</span></label>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => { setShowFDForm(false); fdForm.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createFDMutation.isPending}>Add FD</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Investment Form */}
      {showInvForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">Add Investment</h2>
            <form onSubmit={invForm.handleSubmit((data) => createInvMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Type</Label>
                  <select {...invForm.register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(INV_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label>Currency</Label>
                  <select {...invForm.register('currency')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-1"><Label>Name</Label><Input {...invForm.register('name')} placeholder="Fund name / Stock name" /></div>
                {(invType === 'STOCKS_FOREIGN' || invCurrency !== 'INR') && (
                  <div className="space-y-1">
                    <Label>Exchange</Label>
                    <select {...invForm.register('exchange')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                      <option value="">— Select —</option>
                      <option value="NSE">NSE</option><option value="BSE">BSE</option>
                      <option value="NYSE">NYSE</option><option value="NASDAQ">NASDAQ</option>
                      <option value="LSE">LSE</option><option value="SGX">SGX</option>
                    </select>
                  </div>
                )}
                <div className="space-y-1"><Label>Units / Qty</Label><Input {...invForm.register('unitsOrQuantity')} type="number" step="0.0001" /></div>
                <div className="space-y-1"><Label>Buy Price (per unit)</Label><Input {...invForm.register('purchasePricePerUnit')} type="number" step="0.01" /></div>
                {invCurrency !== 'INR' && (
                  <div className="space-y-1">
                    <Label>Exchange Rate at Purchase (₹/1 {invCurrency})</Label>
                    <Input {...invForm.register('purchaseExchangeRate')} type="number" step="0.01" placeholder="e.g. 83.5" />
                  </div>
                )}
                <div className="space-y-1"><Label>Current Price (per unit)</Label><Input {...invForm.register('currentPricePerUnit')} type="number" step="0.01" /></div>
                <div className="space-y-1"><Label>Purchase Date</Label><Input {...invForm.register('purchaseDate')} type="date" /></div>
                <div className="space-y-1"><Label>Folio / ISIN</Label><Input {...invForm.register('folioNumber')} placeholder="Optional" /></div>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" {...invForm.register('isTaxSaving')} className="rounded" /><span className="text-sm">80C Eligible (ELSS/PPF/NPS etc.)</span></label>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => { setShowInvForm(false); invForm.reset(); }}>Cancel</Button>
                <Button type="submit" disabled={createInvMutation.isPending}>Add Investment</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
