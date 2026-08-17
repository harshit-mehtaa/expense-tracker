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
  'salon': { icon: '💇', color: '#ec4899' },

  // Streaming and services. The icon renders as plain text, so a real brand logo is not
  // available here — a bare letter ("N", "G") reads as a placeholder rather than a mark,
  // so these use a representative emoji in the brand's colour instead.
  'netflix': { icon: '🎥', color: '#e50914' },
  'youtube': { icon: '▶️', color: '#ff0000' },
  'amazon prime': { icon: '📦', color: '#00a8e1' },
  'google': { icon: '🔍', color: '#4285f4' },
  'spotify': { icon: '🎧', color: '#1db954' },
  'apple': { icon: '🍎', color: '#555555' },
  'icloud': { icon: '☁️', color: '#3b82f6' },
  'hotstar': { icon: '⭐', color: '#1f80e0' },

  // Utilities, split apart. The keyword rule lumps water, gas and electricity together
  // under one bulb, so three separate bills all looked identical.
  'electricity bill': { icon: '💡', color: '#f59e0b' },
  'water bill': { icon: '💧', color: '#06b6d4' },
  'gas bill': { icon: '🔥', color: '#f97316' },
  'internet bill': { icon: '🌐', color: '#3b82f6' },

  // Home and household. `house` and `property` share a keyword rule, so Househelp and
  // Property tax both came out as the same house.
  'househelp': { icon: '🧹', color: '#a855f7' },
  'house help': { icon: '🧹', color: '#a855f7' },
  'cook': { icon: '👨‍🍳', color: '#f59e0b' },
  'nanny': { icon: '👶', color: '#ec4899' },
  'maid': { icon: '🧹', color: '#a855f7' },
  'property tax': { icon: '🏛️', color: '#f59e0b' },
  'maintenance': { icon: '🔧', color: '#64748b' },
  'maintainence': { icon: '🔧', color: '#64748b' }, // common misspelling, matched as typed
  'repairs': { icon: '🔧', color: '#64748b' },

  // Getting around. `travel` and `flight` share a rule, so the parent and its child were
  // the same plane. In India an "Auto" under Travel is an auto-rickshaw, not a car.
  'travel': { icon: '🧳', color: '#0ea5e9' },
  'flight': { icon: '✈️', color: '#0ea5e9' },
  'auto': { icon: '🛺', color: '#f97316' },
  'cab': { icon: '🚕', color: '#facc15' },
  'taxi': { icon: '🚕', color: '#facc15' },
  'parking': { icon: '🅿️', color: '#0ea5e9' },
  'fuel': { icon: '⛽', color: '#f97316' },
  'petrol': { icon: '⛽', color: '#f97316' },
  'metro': { icon: '🚇', color: '#0ea5e9' },
  'train': { icon: '🚆', color: '#0ea5e9' },

  'entertainment': { icon: '🎬', color: '#8b5cf6' },
  'gym': { icon: '🏋️', color: '#f97316' },
  'fitness': { icon: '🏋️', color: '#f97316' },
  'pets': { icon: '🐾', color: '#a855f7' },
};

const KEYWORD_STYLES: Array<[RegExp, CategoryStyle]> = [
  [/maintenance|maintainence|repair/, { icon: '🔧', color: '#64748b' }],
  [/property tax|house tax/, { icon: '🏛️', color: '#f59e0b' }],
  [/rent|home|house|property|flat|apartment/, { icon: '🏠', color: '#f59e0b' }],
  [/parking/, { icon: '🅿️', color: '#0ea5e9' }],
  [/cab|taxi|uber|ola/, { icon: '🚕', color: '#facc15' }],
  [/transport|fuel|petrol|diesel|car|auto/, { icon: '🚗', color: '#f97316' }],
  // Ordered specific-first: `water bill` and `gas bill` used to fall into the electricity
  // rule below and all three utilities rendered as the same bulb.
  [/water/, { icon: '💧', color: '#06b6d4' }],
  [/\bgas\b|lpg|cylinder/, { icon: '🔥', color: '#f97316' }],
  [/internet|broadband|wifi/, { icon: '🌐', color: '#3b82f6' }],
  [/electric|utility|utilities|power/, { icon: '💡', color: '#f59e0b' }],
  [/education|school|college|course|tuition/, { icon: '🎓', color: '#3b82f6' }],
  [/movie|entertainment|cinema|ott/, { icon: '🎬', color: '#8b5cf6' }],
  [/flight|airline/, { icon: '✈️', color: '#0ea5e9' }],
  [/travel|hotel|trip|holiday/, { icon: '🧳', color: '#0ea5e9' }],
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
