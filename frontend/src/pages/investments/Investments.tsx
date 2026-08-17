import { useState, useCallback, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  IndianRupee,
  Layers,
  Landmark,
  Pencil,
  Plus,
  Repeat,
  ShieldCheck,
  Trash2,
  TrendingUp,
  WalletCards,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CHART_PALETTE } from '@/lib/chartUtils';
import { formatDate, formatNextOccurrence } from '@/lib/dateFormat';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { INRDisplay } from '@/components/shared/INRDisplay';
import { TablePagination } from '@/components/shared/TablePagination';
import { investmentsApi, type FD, type Investment, type RD, type SIP } from '@/api/investments';
import { useFY } from '@/contexts/FYContext';
import { useMemberSelector } from '@/hooks/useMemberSelector';
import { cn } from '@/lib/utils';

const INV_TYPES: Record<string, string> = {
  STOCKS_INDIA: 'Indian Stocks', STOCKS_FOREIGN: 'Foreign Stocks', MUTUAL_FUND: 'Mutual Fund',
  ELSS: 'ELSS', PPF: 'PPF', NPS: 'NPS', EPF: 'EPF', SGB: 'SGB', GOLD_ETF: 'Gold ETF',
  BONDS: 'Bonds', CRYPTO: 'Crypto', OTHER: 'Other',
};

const INVESTMENT_TYPE_VALUES = Object.keys(INV_TYPES) as [keyof typeof INV_TYPES, ...(keyof typeof INV_TYPES)[]];
const EXCHANGE_VALUES = ['NSE', 'BSE', 'NYSE', 'NASDAQ', 'LSE', 'SGX', 'OTHER'] as const;

const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
);

const optionalPositiveNumber = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().positive().optional(),
);

const optionalExchange = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.enum(EXCHANGE_VALUES).optional(),
);

const optionalDate = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
);

const DEFAULT_INV_FORM = {
  type: 'MUTUAL_FUND' as const,
  currency: 'INR',
  isTaxSaving: false,
};

const DEFAULT_FD_FORM = {
  interestPayoutType: 'CUMULATIVE' as const,
  isTaxSaver: false,
  tdsApplicable: true,
  status: 'ACTIVE' as const,
};

const DEFAULT_RD_FORM = {
  status: 'ACTIVE' as const,
};

const DEFAULT_SIP_FORM = {
  status: 'ACTIVE' as const,
  sipDate: 1,
};

const rdSchema = z.object({
  bankName: z.string().min(1, 'Required'),
  monthlyInstallment: z.coerce.number().positive(),
  interestRate: z.coerce.number().positive(),
  tenureMonths: z.coerce.number().int().positive(),
  startDate: z.string().min(1, 'Required'),
  maturityDate: z.string().min(1, 'Required'),
  status: z.enum(['ACTIVE', 'MATURED', 'CLOSED']).default('ACTIVE'),
  notes: optionalString,
});

const sipSchema = z.object({
  investmentId: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional(),
  ),
  fundName: z.string().min(1, 'Required'),
  monthlyAmount: z.coerce.number().positive(),
  sipDate: z.coerce.number().int().min(1).max(28),
  startDate: z.string().min(1, 'Required'),
  endDate: optionalDate,
  status: z.enum(['ACTIVE', 'PAUSED', 'STOPPED']).default('ACTIVE'),
  folioNumber: optionalString,
});

const fdSchema = z.object({
  bankName: z.string().min(1, 'Required'),
  principalAmount: z.coerce.number().positive(),
  interestRate: z.coerce.number().positive(),
  tenureMonths: z.coerce.number().int().positive(),
  startDate: z.string().min(1, 'Required'),
  maturityDate: z.string().min(1, 'Required'),
  interestPayoutType: z.enum(['CUMULATIVE', 'MONTHLY', 'QUARTERLY']).default('CUMULATIVE'),
  isTaxSaver: z.boolean().default(false),
  tdsApplicable: z.boolean().default(true),
  status: z.enum(['ACTIVE', 'MATURED', 'BROKEN']).default('ACTIVE'),
  notes: optionalString,
});

const invSchema = z.object({
  type: z.enum(INVESTMENT_TYPE_VALUES),
  name: z.string().min(1, 'Required'),
  currency: z.string().default('INR'),
  exchange: optionalExchange,
  unitsOrQuantity: z.coerce.number().positive(),
  purchasePricePerUnit: z.coerce.number().positive(),
  purchaseDate: z.string().min(1, 'Required'),
  purchaseExchangeRate: optionalPositiveNumber,
  currentPricePerUnit: z.coerce.number().positive(),
  isTaxSaving: z.boolean().default(false),
  folioNumber: optionalString,
  isin: optionalString,
  tickerSymbolNSE: optionalString,
  tickerSymbolBSE: optionalString,
  tickerSymbolForeign: optionalString,
  notes: optionalString,
});

type RDForm = z.infer<typeof rdSchema>;
type SIPForm = z.infer<typeof sipSchema>;
type FDForm = z.infer<typeof fdSchema>;
type InvForm = z.infer<typeof invSchema>;

type TabType = 'portfolio' | 'fd' | 'rd' | 'sip';

const PAGE_SIZE = 25;

export default function InvestmentsPage() {
  const { selectedFY } = useFY();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabType>('portfolio');
  const { isAdmin, viewUserId, setViewUserId, members, isMembersLoading, isMembersError } = useMemberSelector();
  const isViewingFamilyWide = isAdmin && !viewUserId;
  const [showInvForm, setShowInvForm] = useState(false);
  const [editingInvestment, setEditingInvestment] = useState<Investment | null>(null);
  const [editingInvId, setEditingInvId] = useState<string | null>(null);
  const [editInvValue, setEditInvValue] = useState('');
  const [showFDForm, setShowFDForm] = useState(false);
  const [editingFD, setEditingFD] = useState<FD | null>(null);
  const [showRDForm, setShowRDForm] = useState(false);
  const [editingRD, setEditingRD] = useState<RD | null>(null);
  const [showSIPForm, setShowSIPForm] = useState(false);
  const [editingSIP, setEditingSIP] = useState<SIP | null>(null);
  const [invPage, setInvPage] = useState(1);

  const { data: portfolio } = useQuery({
    queryKey: ['portfolio', viewUserId],
    queryFn: () => investmentsApi.getPortfolioSummary(viewUserId ? { targetUserId: viewUserId } : undefined),
  });
  const { data: invData } = useQuery({
    queryKey: ['investments', viewUserId, { page: invPage, pageSize: PAGE_SIZE }],
    queryFn: () => investmentsApi.getAll({ page: invPage, pageSize: PAGE_SIZE, targetUserId: viewUserId }),
  });
  const investments = invData?.items ?? [];
  const invPagination = invData?.pagination;
  const { data: fds = [] } = useQuery({
    queryKey: ['fds', viewUserId],
    queryFn: () => investmentsApi.getFDs(viewUserId ? { targetUserId: viewUserId } : undefined),
  });
  const { data: rds = [] } = useQuery({
    queryKey: ['rds', viewUserId],
    queryFn: () => investmentsApi.getRDs(viewUserId ? { targetUserId: viewUserId } : undefined),
  });
  const { data: sips = [] } = useQuery({
    queryKey: ['sips', viewUserId],
    queryFn: () => investmentsApi.getSIPs(viewUserId ? { targetUserId: viewUserId } : undefined),
  });
  const { data: tracker80C } = useQuery({
    queryKey: ['tax-80c', selectedFY, viewUserId],
    queryFn: () => investmentsApi.get80CSummary(selectedFY, viewUserId ? { targetUserId: viewUserId } : undefined),
  });
  // Fetch all investments (unpaginated) for the SIP investmentId dropdown
  const { data: allInvData } = useQuery({
    queryKey: ['investments-all', viewUserId],
    queryFn: () => investmentsApi.getAll({ page: 1, pageSize: 1000, targetUserId: viewUserId }),
  });
  const allInvestments = allInvData?.items ?? [];

  const fdForm = useForm<FDForm>({ resolver: zodResolver(fdSchema), defaultValues: DEFAULT_FD_FORM });
  const invForm = useForm<InvForm>({ resolver: zodResolver(invSchema), defaultValues: DEFAULT_INV_FORM });
  const rdForm = useForm<RDForm>({ resolver: zodResolver(rdSchema), defaultValues: DEFAULT_RD_FORM });
  const sipForm = useForm<SIPForm>({ resolver: zodResolver(sipSchema), defaultValues: DEFAULT_SIP_FORM });

  const invalidateFDs = () => qc.invalidateQueries({ queryKey: ['fds'] });
  const invalidateRDs = () => qc.invalidateQueries({ queryKey: ['rds'] });
  const invalidateInvestments = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['investments'] });
    qc.invalidateQueries({ queryKey: ['investments-all'] });
    qc.invalidateQueries({ queryKey: ['portfolio'] });
  }, [qc]);

  const createFDMutation = useMutation({
    mutationFn: (data: FDForm) => investmentsApi.createFD(data, viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => { invalidateFDs(); setShowFDForm(false); setEditingFD(null); fdForm.reset(DEFAULT_FD_FORM); },
  });

  const updateFDMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FDForm }) => investmentsApi.updateFD(id, data),
    onSuccess: () => { invalidateFDs(); setShowFDForm(false); setEditingFD(null); fdForm.reset(DEFAULT_FD_FORM); },
  });

  const deleteFDMutation = useMutation({
    mutationFn: investmentsApi.deleteFD,
    onSuccess: () => invalidateFDs(),
  });

  const createRDMutation = useMutation({
    mutationFn: (data: RDForm) => investmentsApi.createRD(data, viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => { invalidateRDs(); setShowRDForm(false); setEditingRD(null); rdForm.reset(DEFAULT_RD_FORM); },
  });

  const updateRDMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: RDForm }) => investmentsApi.updateRD(id, data),
    onSuccess: () => { invalidateRDs(); setShowRDForm(false); setEditingRD(null); rdForm.reset(DEFAULT_RD_FORM); },
  });

  const deleteRDMutation = useMutation({
    mutationFn: (id: string) => investmentsApi.deleteRD(id),
    onSuccess: () => invalidateRDs(),
  });

  const createSIPMutation = useMutation({
    mutationFn: (data: SIPForm) => investmentsApi.createSIP(data, viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sips'] });
      invalidateInvestments();
      setShowSIPForm(false);
      setEditingSIP(null);
      sipForm.reset(DEFAULT_SIP_FORM);
    },
  });

  const updateSIPMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: SIPForm }) => investmentsApi.updateSIP(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sips'] });
      invalidateInvestments();
      setShowSIPForm(false);
      setEditingSIP(null);
      sipForm.reset(DEFAULT_SIP_FORM);
    },
  });

  const deleteSIPMutation = useMutation({
    mutationFn: (id: string) => investmentsApi.deleteSIP(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sips'] }),
  });

  const createInvMutation = useMutation({
    mutationFn: (data: InvForm) => investmentsApi.create(buildInvestmentPayload(data), viewUserId ? { targetUserId: viewUserId } : undefined),
    onSuccess: () => {
      invalidateInvestments();
      setInvPage(1);
      setShowInvForm(false);
      setEditingInvestment(null);
      invForm.reset(DEFAULT_INV_FORM);
    },
  });

  const updateInvMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: InvForm }) =>
      investmentsApi.update(id, buildInvestmentPayload(data)),
    onSuccess: () => {
      invalidateInvestments();
      setShowInvForm(false);
      setEditingInvestment(null);
      invForm.reset(DEFAULT_INV_FORM);
    },
  });

  const deleteInvMutation = useMutation({
    mutationFn: investmentsApi.delete,
    onSuccess: () => {
      invalidateInvestments();
      setInvPage(1);
    },
  });

  const updateInvPriceMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      investmentsApi.update(id, { currentPricePerUnit: price }),
    onSuccess: () => {
      invalidateInvestments();
      setEditingInvId(null);
    },
  });

  // Asset allocation pie chart data
  const pieData = portfolio
    ? Object.entries(portfolio.byType).map(([type, val], i) => ({
        name: INV_TYPES[type] ?? type,
        value: val.current,
        color: CHART_PALETTE.categorical[i % CHART_PALETTE.categorical.length],
      })).filter((d) => d.value > 0)
    : [];

  const tabs = [
    { id: 'portfolio' as const, label: 'Portfolio' },
    { id: 'fd' as const, label: `FD (${fds.length})` },
    { id: 'rd' as const, label: `RD (${rds.length})` },
    { id: 'sip' as const, label: `SIP Mandates (${sips.length})` },
  ];

  const invCurrency = invForm.watch('currency');
  const invType = invForm.watch('type');
  const shouldShowExchange = invType === 'STOCKS_INDIA' || invType === 'STOCKS_FOREIGN' || invCurrency !== 'INR';

  function buildInvestmentPayload(data: InvForm) {
    const includesExchange = data.type === 'STOCKS_INDIA' || data.type === 'STOCKS_FOREIGN' || data.currency !== 'INR';
    return {
      ...data,
      exchange: includesExchange ? data.exchange || undefined : undefined,
      folioNumber: data.folioNumber?.trim() || undefined,
      isin: data.isin?.trim() || undefined,
      tickerSymbolNSE: data.type === 'STOCKS_INDIA' ? data.tickerSymbolNSE?.trim() || undefined : undefined,
      tickerSymbolBSE: data.type === 'STOCKS_INDIA' ? data.tickerSymbolBSE?.trim() || undefined : undefined,
      tickerSymbolForeign: data.type === 'STOCKS_FOREIGN' ? data.tickerSymbolForeign?.trim() || undefined : undefined,
      notes: data.notes?.trim() || undefined,
      purchaseExchangeRate: data.currency === 'INR' ? undefined : data.purchaseExchangeRate,
    };
  }

  function openAddFD() {
    setEditingFD(null);
    fdForm.reset(DEFAULT_FD_FORM);
    setShowFDForm(true);
  }

  function openEditFD(fd: FD) {
    setEditingFD(fd);
    fdForm.reset({
      bankName: fd.bankName,
      principalAmount: fd.principalAmount,
      interestRate: fd.interestRate,
      tenureMonths: fd.tenureMonths,
      startDate: fd.startDate?.slice(0, 10),
      maturityDate: fd.maturityDate?.slice(0, 10),
      interestPayoutType: fd.interestPayoutType as FDForm['interestPayoutType'],
      isTaxSaver: fd.isTaxSaver,
      tdsApplicable: (fd as any).tdsApplicable ?? true,
      status: fd.status,
      notes: fd.notes ?? '',
    });
    setShowFDForm(true);
  }

  function closeFDForm() {
    setShowFDForm(false);
    setEditingFD(null);
    fdForm.reset(DEFAULT_FD_FORM);
  }

  function openAddRD() {
    setEditingRD(null);
    rdForm.reset(DEFAULT_RD_FORM);
    setShowRDForm(true);
  }

  function openEditRD(rd: RD) {
    setEditingRD(rd);
    rdForm.reset({
      bankName: rd.bankName,
      monthlyInstallment: rd.monthlyInstallment,
      interestRate: rd.interestRate,
      tenureMonths: rd.tenureMonths,
      startDate: rd.startDate?.slice(0, 10),
      maturityDate: rd.maturityDate?.slice(0, 10),
      status: rd.status,
      notes: rd.notes ?? '',
    });
    setShowRDForm(true);
  }

  function closeRDForm() {
    setShowRDForm(false);
    setEditingRD(null);
    rdForm.reset(DEFAULT_RD_FORM);
  }

  function openAddSIP() {
    setEditingSIP(null);
    sipForm.reset(DEFAULT_SIP_FORM);
    setShowSIPForm(true);
  }

  function openEditSIP(sip: SIP) {
    setEditingSIP(sip);
    sipForm.reset({
      investmentId: sip.investment?.id,
      fundName: sip.fundName,
      monthlyAmount: sip.monthlyAmount,
      sipDate: sip.sipDate,
      startDate: sip.startDate?.slice(0, 10),
      endDate: sip.endDate?.slice(0, 10) ?? '',
      status: sip.status as SIPForm['status'],
      folioNumber: sip.folioNumber ?? '',
    });
    setShowSIPForm(true);
  }

  function closeSIPForm() {
    setShowSIPForm(false);
    setEditingSIP(null);
    sipForm.reset(DEFAULT_SIP_FORM);
  }

  function openAddInvestment() {
    setEditingInvestment(null);
    invForm.reset(DEFAULT_INV_FORM);
    setShowInvForm(true);
  }

  function openEditInvestment(inv: Investment) {
    setEditingInvestment(inv);
    invForm.reset({
      type: inv.type as InvForm['type'],
      name: inv.name,
      currency: inv.currency ?? 'INR',
      exchange: inv.exchange as InvForm['exchange'],
      unitsOrQuantity: inv.unitsOrQuantity,
      purchasePricePerUnit: inv.purchasePricePerUnit,
      purchaseDate: inv.purchaseDate?.slice(0, 10),
      purchaseExchangeRate: inv.purchaseExchangeRate,
      currentPricePerUnit: inv.currentPricePerUnit,
      isTaxSaving: inv.isTaxSaving,
      folioNumber: inv.folioNumber ?? '',
      isin: inv.isin ?? '',
      tickerSymbolNSE: inv.tickerSymbolNSE ?? '',
      tickerSymbolBSE: inv.tickerSymbolBSE ?? '',
      tickerSymbolForeign: inv.tickerSymbolForeign ?? '',
      notes: inv.notes ?? '',
    });
    setShowInvForm(true);
  }

  function closeInvestmentForm() {
    setShowInvForm(false);
    setEditingInvestment(null);
    invForm.reset(DEFAULT_INV_FORM);
  }

  const activeSIPs = sips.filter((sip) => sip.status === 'ACTIVE');
  const activeFDs = fds.filter((fd) => fd.status === 'ACTIVE');
  const activeRDs = rds.filter((rd) => rd.status === 'ACTIVE');
  const monthlySIPTotal = activeSIPs.reduce((sum, sip) => sum + Number(sip.monthlyAmount), 0);
  const depositMaturityValue = activeFDs.reduce((sum, fd) => sum + Number(fd.maturityAmount), 0)
    + activeRDs.reduce((sum, rd) => sum + Number(rd.maturityAmount), 0);
  const selectedMember = viewUserId ? members.find((m) => m.id === viewUserId) : null;
  const scopeLabel = isViewingFamilyWide ? 'All Family' : selectedMember?.name ?? 'My Portfolio';
  const tracker80CTotal = Number(tracker80C?.total ?? 0);
  const tracker80CLimit = Number(tracker80C?.limit ?? 150000);
  const tracker80CPct = Number(tracker80C?.utilized ?? 0);
  const tracker80CRemaining = Math.max(tracker80CLimit - tracker80CTotal, 0);
  const holdingsTotal = invPagination?.total ?? investments.length;
  const allocationTotal = pieData.reduce((sum, item) => sum + Number(item.value), 0);
  const sipByInvestmentId = new Map<string, SIP>();
  sips.forEach((sip) => {
    if (sip.investment?.id) sipByInvestmentId.set(sip.investment.id, sip);
  });

  function daysUntil(value?: string | null) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  function dateProgress(startDate?: string | null, endDate?: string | null) {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    return Math.max(0, Math.min(((Date.now() - start) / (end - start)) * 100, 100));
  }

  function statusClasses(status: string) {
    switch (status) {
      case 'ACTIVE':
        return 'bg-emerald-100 text-emerald-700';
      case 'PAUSED':
        return 'bg-amber-100 text-amber-700';
      case 'MATURED':
      case 'CLOSED':
      case 'STOPPED':
        return 'bg-slate-100 text-slate-600';
      case 'BROKEN':
        return 'bg-rose-100 text-rose-700';
      default:
        return 'bg-muted text-muted-foreground';
    }
  }

  function renderOwnerBadge(ownerName?: string | null) {
    if (!isViewingFamilyWide || !ownerName) return null;
    return (
      <span className="inline-flex max-w-full items-center rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
        <span className="truncate">{ownerName}</span>
      </span>
    );
  }

  function formatCompactNumber(value: number) {
    return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 4 });
  }

  function getInvestmentInitials(name: string) {
    const words = name.split(/\s+/).map((word) => word.trim()).filter(Boolean);
    if (words.length === 0) return 'IN';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  }

  function getHoldingAccent(index: number) {
    return CHART_PALETTE.categorical[index % CHART_PALETTE.categorical.length];
  }

  function renderMetricCard({
    label,
    value,
    helper,
    icon: Icon,
    accentClass,
    valueClassName,
  }: {
    label: string;
    value: ReactNode;
    helper: ReactNode;
    icon: LucideIcon;
    accentClass: string;
    valueClassName?: string;
  }) {
    return (
      <div className="relative overflow-hidden rounded-lg border bg-card p-4 shadow-sm">
        <div className={cn('absolute inset-x-0 top-0 h-1', accentClass)} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className={cn('mt-2 text-2xl font-bold leading-tight', valueClassName)}>{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{helper}</div>
      </div>
    );
  }

  function renderCurrentPriceEditor(inv: Investment) {
    if (editingInvId === inv.id) {
      return (
        <div className="mt-1 flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{inv.currency}</span>
          <Input
            type="number"
            value={editInvValue}
            onChange={(e) => setEditInvValue(e.target.value)}
            className="h-7 min-w-0 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const p = Number(editInvValue);
                if (p > 0) updateInvPriceMutation.mutate({ id: inv.id, price: p });
              }
              if (e.key === 'Escape') setEditingInvId(null);
            }}
          />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => {
            const p = Number(editInvValue);
            if (p > 0) updateInvPriceMutation.mutate({ id: inv.id, price: p });
          }}>
            <Check className="h-3 w-3 text-green-600" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setEditingInvId(null)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      );
    }

    return (
      <div className="group mt-1 flex items-center gap-1">
        <span className="truncate font-semibold">{inv.currency} {formatCompactNumber(Number(inv.currentPricePerUnit))}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={() => { setEditingInvId(inv.id); setEditInvValue(String(inv.currentPricePerUnit)); }}
          title={`Update price (${inv.currency}/unit)`}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  function renderHoldingRow(inv: Investment, index: number) {
    const linkedSip = sipByInvestmentId.get(inv.id);
    const accent = getHoldingAccent(index);

    return (
      <div key={inv.id} className="grid gap-4 border-b p-4 last:border-b-0 xl:grid-cols-[minmax(220px,1.15fr)_minmax(360px,1.65fr)_auto] xl:items-center">
        <div className="flex min-w-0 gap-3">
          <span
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm"
            style={{ backgroundColor: accent }}
            aria-hidden="true"
          >
            {getInvestmentInitials(inv.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold">{inv.name}</p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{INV_TYPES[inv.type] ?? inv.type}</span>
              {inv.isTaxSaving && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">80C</span>}
              {linkedSip && (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  SIP <INRDisplay amount={linkedSip.monthlyAmount} />
                </span>
              )}
              {renderOwnerBadge(inv.userName)}
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {formatCompactNumber(Number(inv.unitsOrQuantity))} units · Buy {inv.currency} {formatCompactNumber(Number(inv.purchasePricePerUnit))} · {formatDate(inv.purchaseDate)}
              {inv.currency !== 'INR' && ` · ${inv.currency}${inv.exchange ? ` · ${inv.exchange}` : ''}`}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5">
            <p className="text-xs text-muted-foreground">Invested</p>
            <INRDisplay amount={inv.investedINR} short className="font-semibold" />
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5">
            <p className="text-xs text-muted-foreground">Current</p>
            <INRDisplay amount={inv.currentValueINR} short className="font-semibold" />
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5">
            <p className="text-xs text-muted-foreground">P&L</p>
            <INRDisplay amount={inv.gainINR} short colorCode className="font-semibold" />
            <p className={cn('text-xs', inv.gainPct >= 0 ? 'text-green-600' : 'text-red-600')}>
              {inv.gainPct >= 0 ? '+' : ''}{inv.gainPct.toFixed(2)}%
            </p>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 p-2.5">
            <p className="text-xs text-muted-foreground">Price</p>
            {renderCurrentPriceEditor(inv)}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEditInvestment(inv)} title="Edit investment">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => deleteInvMutation.mutate(inv.id)} title="Delete investment">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    );
  }

  const fdsMaturingSoon = activeFDs.filter((fd) => {
    const days = daysUntil(fd.maturityDate);
    return days !== null && days > 0 && days <= 30;
  });
  const actionItems = [
    tracker80CRemaining > 0
      ? { title: '80C room available', detail: <><INRDisplay amount={tracker80CRemaining} /> remaining for FY {selectedFY}</> }
      : null,
    fdsMaturingSoon.length > 0
      ? { title: 'FD maturing soon', detail: `${fdsMaturingSoon.length} fixed deposit${fdsMaturingSoon.length > 1 ? 's' : ''} due within 30 days` }
      : null,
    activeSIPs.length > 0
      ? { title: 'Upcoming SIP cycle', detail: `${activeSIPs.length} active SIP mandate${activeSIPs.length > 1 ? 's' : ''} totaling monthly commitments` }
      : null,
  ].filter(Boolean) as Array<{ title: string; detail: ReactNode }>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card shadow-sm">
        <div className="flex flex-col gap-4 border-b bg-muted/20 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-foreground text-sm font-bold text-background shadow-sm">
                IN
              </span>
              <div>
                <h1 className="text-2xl font-bold">Portfolio Command Center</h1>
                <p className="text-sm text-muted-foreground">
                  {scopeLabel} · {holdingsTotal} holdings · {activeSIPs.length} active SIPs · {activeFDs.length + activeRDs.length} active deposits
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">FY {selectedFY}</span>
                  <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    XIRR {portfolio?.xirr != null ? `${(portfolio.xirr * 100).toFixed(2)}%` : '—'}
                  </span>
                  <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    80C <INRDisplay amount={tracker80CTotal} />
                  </span>
                  <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    Deposits <INRDisplay amount={depositMaturityValue} short />
                  </span>
                </div>
              </div>
            </div>
            {isAdmin && !isMembersLoading && (
              <div className="flex items-center gap-2">
                <label htmlFor="investments-member-select" className="text-sm font-medium text-muted-foreground">View:</label>
                {isMembersError ? (
                  <span className="text-xs text-destructive">Could not load members</span>
                ) : (
                  <select
                    id="investments-member-select"
                    value={viewUserId ?? ''}
                    onChange={(e) => setViewUserId(e.target.value || undefined)}
                    className="rounded-md border bg-background px-3 py-1.5 text-sm"
                  >
                    <option value="">All Family</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {!isViewingFamilyWide && (
              <Button onClick={openAddInvestment}><Plus className="h-4 w-4 mr-1" /> Add Investment</Button>
            )}
            {tab === 'fd' && !isViewingFamilyWide && (
              <Button variant="outline" onClick={openAddFD}><Plus className="h-4 w-4 mr-1" /> Add FD</Button>
            )}
            {tab === 'rd' && !isViewingFamilyWide && (
              <Button variant="outline" onClick={openAddRD}><Plus className="h-4 w-4 mr-1" /> Add RD</Button>
            )}
            {tab === 'sip' && !isViewingFamilyWide && (
              <Button variant="outline" onClick={openAddSIP}><Plus className="h-4 w-4 mr-1" /> Add SIP</Button>
            )}
          </div>
        </div>

        {portfolio && (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {renderMetricCard({
              label: 'Current Value',
              value: <INRDisplay amount={portfolio.totalCurrentValue} short />,
              helper: 'Marked-to-market value',
              icon: WalletCards,
              accentClass: 'bg-sky-500',
            })}
            {renderMetricCard({
              label: 'Invested',
              value: <INRDisplay amount={portfolio.totalInvested} short />,
              helper: 'Original cost basis',
              icon: IndianRupee,
              accentClass: 'bg-amber-500',
            })}
            {renderMetricCard({
              label: 'P&L',
              value: (
                <INRDisplay
                  amount={portfolio.absoluteGain}
                  short
                  colorCode
                  className={cn(portfolio.absoluteGain >= 0 ? 'text-green-600' : 'text-red-600')}
                />
              ),
              helper: (
                <span className={portfolio.absoluteReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {portfolio.absoluteReturnPct >= 0 ? '+' : ''}{portfolio.absoluteReturnPct.toFixed(2)}% absolute return
                </span>
              ),
              icon: ArrowUpRight,
              accentClass: portfolio.absoluteGain >= 0 ? 'bg-emerald-500' : 'bg-rose-500',
            })}
            {renderMetricCard({
              label: 'Monthly SIP',
              value: <INRDisplay amount={monthlySIPTotal} short />,
              helper: `${activeSIPs.length} active mandate${activeSIPs.length === 1 ? '' : 's'}`,
              icon: Repeat,
              accentClass: 'bg-violet-500',
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'portfolio' && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/20 p-4">
              <div>
                <h2 className="font-semibold">Priority Holdings</h2>
                <p className="text-xs text-muted-foreground">Inline price updates, full edit actions, and linked SIP status.</p>
              </div>
              <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {holdingsTotal} total
              </span>
            </div>

            {investments.length === 0 ? (
              <div className="p-10 text-center">
                <TrendingUp className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
                <p className="font-medium">No investments yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Add stocks, mutual funds, ELSS, or other investments.</p>
              </div>
            ) : (
              <div>{investments.map(renderHoldingRow)}</div>
            )}

            {invPagination && invPagination.total > PAGE_SIZE && (
              <div className="border-t p-3">
                <TablePagination
                  page={invPage}
                  pageSize={PAGE_SIZE}
                  total={invPagination.total}
                  onPageChange={setInvPage}
                />
              </div>
            )}
          </div>

          <aside className="space-y-4">
            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2 font-semibold"><Layers className="h-4 w-4" /> Asset Allocation</h3>
                <span className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {pieData.length} classes
                </span>
              </div>
              {pieData.length > 0 ? (
                <div className="space-y-3">
                  {pieData.map((entry) => {
                    const pct = allocationTotal > 0 ? (Number(entry.value) / allocationTotal) * 100 : 0;
                    return (
                      <div key={entry.name} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="flex min-w-0 items-center gap-2 font-medium">
                            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                            <span className="truncate">{entry.name}</span>
                          </span>
                          <span className="shrink-0 text-muted-foreground">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.max(Math.min(pct, 100), 3)}%`, backgroundColor: entry.color }}
                          />
                        </div>
                        <INRDisplay amount={Number(entry.value)} short className="text-xs font-medium" />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No investments added yet</p>
              )}
            </div>

            {tracker80C && (
              <div className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> 80C Utilization</h3>
                    <p className="text-xs text-muted-foreground">FY {selectedFY}</p>
                  </div>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-semibold',
                    tracker80CPct >= 100
                      ? 'bg-rose-100 text-rose-700'
                      : tracker80CPct >= 80
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700',
                  )}>
                    {Math.min(tracker80CPct, 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      tracker80CPct >= 100 ? 'bg-rose-500' : tracker80CPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.min(tracker80CPct, 100)}%` }}
                  />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  <INRDisplay amount={tracker80CTotal} /> used of <INRDisplay amount={tracker80CLimit} />.
                </p>
                {tracker80CRemaining > 0 && (
                  <p className="mt-1 text-xs text-orange-600"><INRDisplay amount={tracker80CRemaining} /> still available.</p>
                )}
              </div>
            )}

            <div className="rounded-lg border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="font-semibold">Action Items</h3>
                <span className="rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {actionItems.length}
                </span>
              </div>
              {actionItems.length > 0 ? (
                <div className="space-y-3">
                  {actionItems.map((item) => (
                    <div key={item.title} className="rounded-md border bg-muted/30 p-3">
                      <p className="text-sm font-medium">{item.title}</p>
                      <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">No portfolio actions need attention.</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {tab === 'fd' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fds.length === 0 ? (
            <div className="col-span-full text-center py-12 border rounded-lg">
              <p className="font-medium">No Fixed Deposits added yet</p>
              <p className="text-sm text-muted-foreground mt-1">Track FD maturity dates and interest</p>
            </div>
          ) : fds.map((fd) => {
            const fdDaysToMaturity = daysUntil(fd.maturityDate);
            const progress = dateProgress(fd.startDate, fd.maturityDate);
            return (
              <div key={fd.id} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                      <Landmark className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{fd.bankName}</p>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClasses(fd.status))}>{fd.status}</span>
                        {renderOwnerBadge(fd.userName)}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{fd.interestRate}% · {fd.tenureMonths} months · {fd.interestPayoutType}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditFD(fd)} title="Edit FD">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteFDMutation.mutate(fd.id)} title="Delete FD">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground">Principal</p><INRDisplay amount={fd.principalAmount} className="font-semibold" /></div>
                  <div><p className="text-muted-foreground">At Maturity</p><INRDisplay amount={fd.maturityAmount} className="font-semibold text-green-600" /></div>
                  <div><p className="text-muted-foreground">Start</p><p>{formatDate(fd.startDate)}</p></div>
                  <div><p className="text-muted-foreground">Maturity</p><p>{formatDate(fd.maturityDate)}</p></div>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${progress}%` }} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {fd.isTaxSaver && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">80C</span>}
                  {fd.tdsApplicable && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">TDS</span>}
                  {fdDaysToMaturity !== null && fdDaysToMaturity > 0 && fdDaysToMaturity <= 30 && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Maturing soon</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'rd' && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rds.length === 0 ? (
            <div className="col-span-full text-center py-12 border rounded-lg">
              <p className="font-medium">No Recurring Deposits added yet</p>
            </div>
          ) : rds.map((rd) => {
            const progress = Math.min((rd.installmentsPaid / rd.tenureMonths) * 100, 100);
            return (
              <div key={rd.id} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                      <CalendarDays className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{rd.bankName}</p>
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClasses(rd.status))}>{rd.status}</span>
                        {renderOwnerBadge(rd.userName)}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{rd.installmentsPaid}/{rd.tenureMonths} installments · {rd.interestRate}% p.a.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditRD(rd)} title="Edit RD">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteRDMutation.mutate(rd.id)} title="Delete RD">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-muted-foreground">Monthly</p><INRDisplay amount={rd.monthlyInstallment} className="font-semibold" /></div>
                  <div><p className="text-muted-foreground">Deposited</p><INRDisplay amount={rd.totalDeposited} /></div>
                  <div><p className="text-muted-foreground">At Maturity</p><INRDisplay amount={rd.maturityAmount} className="text-green-600 font-semibold" /></div>
                  <div><p className="text-muted-foreground">Maturity</p><p>{formatDate(rd.maturityDate)}</p></div>
                </div>
                <div className="mt-4 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-violet-500" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Started {formatDate(rd.startDate)}</p>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'sip' && (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">SIP Mandates</h2>
              <p className="text-xs text-muted-foreground">Monthly schedules linked to portfolio holdings.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {activeSIPs.length} active
              </span>
              <span className="rounded-full border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <INRDisplay amount={monthlySIPTotal} short /> monthly
              </span>
            </div>
          </div>

          {sips.length === 0 ? (
            <div className="p-10 text-center">
              <Repeat className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
              <p className="font-medium">No SIP mandates yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Add SIPs from here and link them to mutual fund holdings.</p>
            </div>
          ) : (
            <div className="divide-y">
              {sips.map((sip) => {
                const linkedHolding = sip.investment?.name || sip.fundName;
                const debitSource = sip.bankAccount
                  ? `${sip.bankAccount.bankName}${sip.bankAccount.accountNumberLast4 ? ` •••• ${sip.bankAccount.accountNumberLast4}` : ''}`
                  : 'Not set';

                return (
                  <div
                    key={sip.id}
                    className="grid gap-4 p-4 lg:grid-cols-[minmax(240px,1.2fr)_minmax(360px,1.6fr)_auto] lg:items-center"
                  >
                    <div className="flex min-w-0 gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                        <Repeat className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold">{sip.fundName}</p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Mandate</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClasses(sip.status))}>
                            {sip.status}
                          </span>
                          {renderOwnerBadge(sip.userName)}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          Holding: {linkedHolding}{sip.folioNumber ? ` · Folio ${sip.folioNumber}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-5">
                      <div className="rounded-md border bg-muted/30 p-2.5">
                        <p className="text-xs text-muted-foreground">Monthly</p>
                        <INRDisplay amount={sip.monthlyAmount} short className="font-semibold" />
                      </div>
                      <div className="rounded-md border bg-muted/30 p-2.5">
                        <p className="text-xs text-muted-foreground">Next Debit</p>
                        <p className="font-semibold">{formatNextOccurrence(sip.sipDate)}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-2.5">
                        <p className="text-xs text-muted-foreground">Started</p>
                        <p className="font-semibold">{formatDate(sip.startDate)}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-2.5">
                        <p className="text-xs text-muted-foreground">Ends</p>
                        <p className="font-semibold">{sip.endDate ? formatDate(sip.endDate) : 'Ongoing'}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-2.5 md:col-span-1">
                        <p className="text-xs text-muted-foreground">Debit Source</p>
                        <p className="truncate font-semibold">{debitSource}</p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditSIP(sip)} title="Edit SIP mandate">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => deleteSIPMutation.mutate(sip.id)} title="Delete SIP mandate">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add/Edit FD Form */}
      {showFDForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editingFD ? 'Edit Fixed Deposit' : 'Add Fixed Deposit'}</h2>
            <form
              onSubmit={fdForm.handleSubmit((data) => {
                if (editingFD) updateFDMutation.mutate({ id: editingFD.id, data });
                else createFDMutation.mutate(data);
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1"><Label required>Bank Name</Label><Input {...fdForm.register('bankName')} /></div>
                <div className="space-y-1"><Label required>Principal (₹)</Label><Input {...fdForm.register('principalAmount')} type="number" /></div>
                <div className="space-y-1"><Label required>Rate (% p.a.)</Label><Input {...fdForm.register('interestRate')} type="number" step="0.01" /></div>
                <div className="space-y-1"><Label required>Tenure (months)</Label><Input {...fdForm.register('tenureMonths')} type="number" /></div>
                <div className="space-y-1">
                  <Label required>Payout Type</Label>
                  <select {...fdForm.register('interestPayoutType')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="CUMULATIVE">Cumulative</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label required>Status</Label>
                  <select {...fdForm.register('status')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="ACTIVE">Active</option>
                    <option value="MATURED">Matured</option>
                    <option value="BROKEN">Broken</option>
                  </select>
                </div>
                <div className="space-y-1"><Label required>Start Date</Label><Input {...fdForm.register('startDate')} type="date" /></div>
                <div className="space-y-1"><Label required>Maturity Date</Label><Input {...fdForm.register('maturityDate')} type="date" /></div>
                <div className="col-span-2 space-y-1"><Label>Notes (optional)</Label><Input {...fdForm.register('notes')} placeholder="Optional" /></div>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2"><input type="checkbox" {...fdForm.register('isTaxSaver')} className="rounded" /><span className="text-sm">Tax Saver FD (80C)</span></label>
                <label className="flex items-center gap-2"><input type="checkbox" {...fdForm.register('tdsApplicable')} className="rounded" /><span className="text-sm">TDS Applicable</span></label>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={closeFDForm}>Cancel</Button>
                <Button type="submit" disabled={createFDMutation.isPending || updateFDMutation.isPending}>
                  {createFDMutation.isPending || updateFDMutation.isPending ? 'Saving…' : editingFD ? 'Save FD' : 'Add FD'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit RD Form */}
      {showRDForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editingRD ? 'Edit Recurring Deposit' : 'Add Recurring Deposit'}</h2>
            <form
              onSubmit={rdForm.handleSubmit((data) => {
                if (editingRD) updateRDMutation.mutate({ id: editingRD.id, data });
                else createRDMutation.mutate(data);
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1"><Label required>Bank Name</Label><Input {...rdForm.register('bankName')} placeholder="e.g. HDFC Bank" /></div>
                <div className="space-y-1"><Label required>Monthly Installment (₹)</Label><Input {...rdForm.register('monthlyInstallment')} type="number" /></div>
                <div className="space-y-1"><Label required>Rate (% p.a.)</Label><Input {...rdForm.register('interestRate')} type="number" step="0.01" /></div>
                <div className="space-y-1"><Label required>Tenure (months)</Label><Input {...rdForm.register('tenureMonths')} type="number" /></div>
                <div className="space-y-1">
                  <Label required>Status</Label>
                  <select {...rdForm.register('status')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="ACTIVE">Active</option>
                    <option value="MATURED">Matured</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </div>
                <div className="space-y-1"><Label required>Start Date</Label><Input {...rdForm.register('startDate')} type="date" /></div>
                <div className="space-y-1"><Label required>Maturity Date</Label><Input {...rdForm.register('maturityDate')} type="date" /></div>
                <div className="col-span-2 space-y-1"><Label>Notes (optional)</Label><Input {...rdForm.register('notes')} placeholder="Optional" /></div>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={closeRDForm}>Cancel</Button>
                <Button type="submit" disabled={createRDMutation.isPending || updateRDMutation.isPending}>
                  {createRDMutation.isPending || updateRDMutation.isPending ? 'Saving…' : editingRD ? 'Save RD' : 'Add RD'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add/Edit SIP Form */}
      {showSIPForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editingSIP ? 'Edit SIP' : 'Add SIP'}</h2>
            <form
              onSubmit={sipForm.handleSubmit((data) => {
                if (editingSIP) updateSIPMutation.mutate({ id: editingSIP.id, data });
                else createSIPMutation.mutate(data);
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1">
                  <Label>{editingSIP ? 'Linked Investment' : 'Existing Investment (optional)'}</Label>
                  <select {...sipForm.register('investmentId')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="">{editingSIP ? 'Keep current investment' : 'Create automatically from fund name'}</option>
                    {allInvestments.map((inv) => (
                      <option key={inv.id} value={inv.id}>{inv.name} ({INV_TYPES[inv.type] ?? inv.type})</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {editingSIP ? 'Change only if this SIP should point to a different investment.' : 'Leave this blank to create and link a mutual-fund investment for this SIP.'}
                  </p>
                </div>
                <div className="col-span-2 space-y-1"><Label required>Fund Name</Label><Input {...sipForm.register('fundName')} placeholder="e.g. Mirae Asset Large Cap Fund" /></div>
                <div className="space-y-1"><Label required>Monthly Amount (₹)</Label><Input {...sipForm.register('monthlyAmount')} type="number" /></div>
                <div className="space-y-1"><Label required>SIP Date (1–28)</Label><Input {...sipForm.register('sipDate')} type="number" min={1} max={28} /></div>
                <div className="space-y-1"><Label required>Start Date</Label><Input {...sipForm.register('startDate')} type="date" /></div>
                <div className="space-y-1"><Label>End Date (optional)</Label><Input {...sipForm.register('endDate')} type="date" /></div>
                <div className="space-y-1">
                  <Label required>Status</Label>
                  <select {...sipForm.register('status')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="ACTIVE">Active</option>
                    <option value="PAUSED">Paused</option>
                    <option value="STOPPED">Stopped</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-1"><Label>Folio Number (optional)</Label><Input {...sipForm.register('folioNumber')} placeholder="Optional" /></div>
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={closeSIPForm}>Cancel</Button>
                <Button type="submit" disabled={createSIPMutation.isPending || updateSIPMutation.isPending}>
                  {createSIPMutation.isPending || updateSIPMutation.isPending ? 'Saving…' : editingSIP ? 'Save SIP' : 'Add SIP'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Investment Form */}
      {showInvForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background rounded-lg border shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-semibold mb-4">{editingInvestment ? 'Edit Investment' : 'Add Investment'}</h2>
            <form
              onSubmit={invForm.handleSubmit((data) => {
                if (editingInvestment) updateInvMutation.mutate({ id: editingInvestment.id, data });
                else createInvMutation.mutate(data);
              })}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label required>Type</Label>
                  <select {...invForm.register('type')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    {Object.entries(INV_TYPES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label required>Currency</Label>
                  <select {...invForm.register('currency')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                    <option value="INR">INR (₹)</option>
                    <option value="USD">USD ($)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
                <div className="col-span-2 space-y-1"><Label required>Name</Label><Input {...invForm.register('name')} placeholder="Fund name / Stock name" /></div>
                {shouldShowExchange && (
                  <div className="space-y-1">
                    <Label required>Exchange</Label>
                    <select {...invForm.register('exchange')} className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                      <option value="">— Select —</option>
                      <option value="NSE">NSE</option><option value="BSE">BSE</option>
                      <option value="NYSE">NYSE</option><option value="NASDAQ">NASDAQ</option>
                      <option value="LSE">LSE</option><option value="SGX">SGX</option>
                    </select>
                  </div>
                )}
                <div className="space-y-1"><Label required>Units / Qty</Label><Input {...invForm.register('unitsOrQuantity')} type="number" step="0.0001" /></div>
                <div className="space-y-1"><Label required>Buy Price (per unit)</Label><Input {...invForm.register('purchasePricePerUnit')} type="number" step="0.0001" /></div>
                {invCurrency !== 'INR' && (
                  <div className="space-y-1">
                    <Label required>Exchange Rate at Purchase (₹/1 {invCurrency})</Label>
                    <Input {...invForm.register('purchaseExchangeRate')} type="number" step="0.01" placeholder="e.g. 83.5" />
                  </div>
                )}
                <div className="space-y-1"><Label required>Current Price (per unit)</Label><Input {...invForm.register('currentPricePerUnit')} type="number" step="0.0001" /></div>
                <div className="space-y-1"><Label required>Purchase Date</Label><Input {...invForm.register('purchaseDate')} type="date" /></div>
                <div className="space-y-1"><Label>Folio Number (optional)</Label><Input {...invForm.register('folioNumber')} placeholder="Optional" /></div>
                <div className="space-y-1"><Label>ISIN (optional)</Label><Input {...invForm.register('isin')} placeholder="Optional" /></div>
                {invType === 'STOCKS_INDIA' && (
                  <>
                    <div className="space-y-1"><Label>NSE Symbol (optional)</Label><Input {...invForm.register('tickerSymbolNSE')} placeholder="Optional" /></div>
                    <div className="space-y-1"><Label>BSE Symbol (optional)</Label><Input {...invForm.register('tickerSymbolBSE')} placeholder="Optional" /></div>
                  </>
                )}
                {invType === 'STOCKS_FOREIGN' && (
                  <div className="space-y-1"><Label>Ticker Symbol (optional)</Label><Input {...invForm.register('tickerSymbolForeign')} placeholder="Optional" /></div>
                )}
                <div className="col-span-2 space-y-1">
                  <Label>Notes (optional)</Label>
                  <textarea
                    {...invForm.register('notes')}
                    className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder="Optional"
                  />
                </div>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" {...invForm.register('isTaxSaving')} className="rounded" /><span className="text-sm">80C Eligible (ELSS/PPF/NPS etc.)</span></label>
              {Object.keys(invForm.formState.errors).length > 0 && (
                <p className="text-sm text-destructive">Please check the highlighted investment fields.</p>
              )}
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={closeInvestmentForm}>Cancel</Button>
                <Button type="submit" disabled={createInvMutation.isPending || updateInvMutation.isPending}>
                  {createInvMutation.isPending || updateInvMutation.isPending
                    ? 'Saving…'
                    : editingInvestment ? 'Save Investment' : 'Add Investment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
