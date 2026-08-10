import { CategoryType } from '@prisma/client';

export interface CategoryStyle {
  icon: string;
  color: string;
}

const FALLBACK_STYLE_BY_TYPE: Record<CategoryType, CategoryStyle> = {
  INCOME: { icon: '💰', color: '#22c55e' },
  EXPENSE: { icon: '🧾', color: '#64748b' },
  ASSET: { icon: '🏦', color: '#3b82f6' },
  LIABILITY: { icon: '💳', color: '#ef4444' },
};

const STYLE_BY_NAME: Record<string, CategoryStyle> = {
  'salary': { icon: '💼', color: '#22c55e' },
  'dividend': { icon: '📈', color: '#8b5cf6' },
  'medical reimbursement': { icon: '🏥', color: '#14b8a6' },
  'food and beverages': { icon: '🍽️', color: '#ec4899' },
  'fruits and vegies': { icon: '🥦', color: '#10b981' },
  'fruits and vegetables': { icon: '🥦', color: '#10b981' },
  'groceries': { icon: '🛒', color: '#3b82f6' },
  'medical': { icon: '💊', color: '#14b8a6' },
  'restaurants': { icon: '🍕', color: '#ef4444' },
  'subscriptions': { icon: '📺', color: '#8b5cf6' },
  'netflix': { icon: 'N', color: '#e50914' },
  'amazon prime': { icon: '▶️', color: '#00a8e1' },
  'google': { icon: 'G', color: '#4285f4' },
  'salon': { icon: '💇', color: '#ec4899' },
};

const KEYWORD_STYLES: Array<[RegExp, CategoryStyle]> = [
  [/rent|home|house|property|flat|apartment/, { icon: '🏠', color: '#f59e0b' }],
  [/transport|fuel|petrol|diesel|car|auto|taxi|uber|ola/, { icon: '🚗', color: '#f97316' }],
  [/electric|utility|utilities|power|water|gas|internet/, { icon: '💡', color: '#f59e0b' }],
  [/education|school|college|course|tuition/, { icon: '🎓', color: '#3b82f6' }],
  [/movie|entertainment|cinema|ott/, { icon: '🎬', color: '#8b5cf6' }],
  [/travel|flight|hotel|trip/, { icon: '✈️', color: '#0ea5e9' }],
  [/gift|donation/, { icon: '🎁', color: '#ec4899' }],
  [/insurance/, { icon: '🛡️', color: '#14b8a6' }],
  [/tax|gst/, { icon: '🧾', color: '#64748b' }],
  [/shopping|clothes|clothing|apparel/, { icon: '👕', color: '#ec4899' }],
  [/phone|mobile|recharge/, { icon: '📱', color: '#3b82f6' }],
  [/loan|emi|credit card|card/, { icon: '💳', color: '#ef4444' }],
  [/bank|interest/, { icon: '🏦', color: '#3b82f6' }],
  [/investment|sip|mutual fund|stock/, { icon: '📈', color: '#8b5cf6' }],
];

function normalizeCategoryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function getDefaultCategoryStyle(name: string, type: CategoryType | string): CategoryStyle {
  const normalizedName = normalizeCategoryName(name);
  const directStyle = STYLE_BY_NAME[normalizedName];
  if (directStyle) return directStyle;

  const keywordStyle = KEYWORD_STYLES.find(([pattern]) => pattern.test(normalizedName))?.[1];
  if (keywordStyle) return keywordStyle;

  return FALLBACK_STYLE_BY_TYPE[type as CategoryType] ?? FALLBACK_STYLE_BY_TYPE.EXPENSE;
}
