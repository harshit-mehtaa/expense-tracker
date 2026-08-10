import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type BankLogoProps = {
  bankName?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

type BankLogoDefinition = {
  match: RegExp;
  label: string;
  bg: string;
  fg: string;
  accent?: string;
};

const BANK_LOGOS: BankLogoDefinition[] = [
  { match: /\bhdfc\b/i, label: 'HDFC', bg: '#004C8F', fg: '#ffffff', accent: '#ED1C24' },
  { match: /\b(state bank of india|sbi)\b/i, label: 'SBI', bg: '#00A9E0', fg: '#ffffff', accent: '#1F4E9D' },
  { match: /\bicici\b/i, label: 'ICICI', bg: '#B85B1E', fg: '#ffffff', accent: '#F58220' },
  { match: /\baxis\b/i, label: 'AXIS', bg: '#97144D', fg: '#ffffff' },
  { match: /\bkotak\b/i, label: 'K', bg: '#003974', fg: '#ffffff', accent: '#ED1C24' },
  { match: /\b(punjab national bank|pnb)\b/i, label: 'PNB', bg: '#A00000', fg: '#FFD24D' },
  { match: /\b(bank of baroda|bob)\b/i, label: 'BoB', bg: '#F15A24', fg: '#ffffff' },
  { match: /\bcanara\b/i, label: 'CAN', bg: '#006CB5', fg: '#ffffff', accent: '#F9C80E' },
  { match: /\byes\b/i, label: 'YES', bg: '#003399', fg: '#ffffff', accent: '#E31E24' },
  { match: /\bidfc\b/i, label: 'IDFC', bg: '#9D1D27', fg: '#ffffff' },
  { match: /\bindusind\b/i, label: 'IIB', bg: '#8A1538', fg: '#ffffff' },
  { match: /\bfederal\b/i, label: 'F', bg: '#005BAA', fg: '#ffffff' },
  { match: /\bau small|au bank|\bau\b/i, label: 'AU', bg: '#E87722', fg: '#ffffff' },
  { match: /\brbl\b/i, label: 'RBL', bg: '#002F6C', fg: '#ffffff', accent: '#D71920' },
  { match: /\bstandard chartered|stanchart\b/i, label: 'SC', bg: '#0072CE', fg: '#ffffff', accent: '#38B000' },
  { match: /\bhsbc\b/i, label: 'HSBC', bg: '#DB0011', fg: '#ffffff' },
  { match: /\bciti\b/i, label: 'CITI', bg: '#004B8D', fg: '#ffffff', accent: '#E41D37' },
  { match: /\bamerican express|amex\b/i, label: 'AMEX', bg: '#006FCF', fg: '#ffffff' },
];

const FALLBACK_COLORS = [
  '#2563EB',
  '#059669',
  '#7C3AED',
  '#D97706',
  '#0F766E',
  '#BE123C',
  '#4338CA',
  '#A16207',
];

const SIZE_CLASSES = {
  sm: 'h-8 w-8 text-[10px]',
  md: 'h-10 w-10 text-xs',
  lg: 'h-12 w-12 text-sm',
};

function findLogo(bankName: string): BankLogoDefinition | undefined {
  return BANK_LOGOS.find((logo) => logo.match.test(bankName));
}

function hashName(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function getInitials(bankName: string) {
  const words = bankName
    .replace(/\b(bank|limited|ltd|co-operative|cooperative|credit|card)\b/gi, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((word) => word[0]).join('').toUpperCase();
}

export function BankLogo({ bankName, size = 'md', className }: BankLogoProps) {
  const normalizedName = bankName?.trim() ?? '';
  const logo = normalizedName ? findLogo(normalizedName) : undefined;
  const fallbackColor = FALLBACK_COLORS[hashName(normalizedName) % FALLBACK_COLORS.length];
  const label = logo?.label ?? getInitials(normalizedName);
  const bg = logo?.bg ?? fallbackColor;
  const fg = logo?.fg ?? '#ffffff';

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md font-bold tracking-normal shadow-sm ring-1 ring-black/10',
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: bg, color: fg }}
      aria-label={normalizedName ? `${normalizedName} logo` : 'Bank logo'}
      title={normalizedName ? `${normalizedName} logo` : 'Bank logo'}
    >
      {logo?.accent && (
        <span
          className="absolute inset-x-0 bottom-0 h-1"
          style={{ backgroundColor: logo.accent }}
        />
      )}
      {label ? <span className="relative leading-none">{label}</span> : <Building2 className="relative h-4 w-4" />}
    </span>
  );
}
