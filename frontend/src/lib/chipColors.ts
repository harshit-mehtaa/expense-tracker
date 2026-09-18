/**
 * Color maps for chips/badges that previously rendered every value in the same flat
 * color (no distinction between e.g. a HOME loan and a BUSINESS loan). Centralized here
 * so new pages/values follow one convention (`bg-{c}-100 text-{c}-700 dark:bg-{c}-900
 * dark:text-{c}-300`, matching the pre-existing PAYMENT_MODE_COLORS in Transactions.tsx)
 * instead of each page inventing its own.
 *
 * Hue-collision record (Q5): which maps render on the SAME page/card together, so their
 * hue families are deliberately kept disjoint rather than picked independently per map.
 * - Assets.tsx: a VEHICLE card shows ASSET_TYPE_COLORS + VEHICLE_TYPE_COLORS +
 *   FUEL_TYPE_COLORS all at once. Assigned: asset type -> slate/blue/amber/gray,
 *   vehicle type -> teal/indigo/gray, fuel type -> orange/stone/green/cyan/sky/gray.
 *   No hue is reused across the three maps.
 * - Every other map here (loan type, property type, gold type, investment type, regime)
 *   is the only multi-value chip on its page, so no cross-map collision risk exists for
 * them — freely reused hues across pages are fine (different pages, never co-rendered).
 */

const FALLBACK = 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';

/** LoanType (schema.prisma) — Loans.tsx loan-type chip. */
export const LOAN_TYPE_COLORS: Record<string, string> = {
  HOME: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  AUTO: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  PERSONAL: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  EDUCATION: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  GOLD: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  LAP: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  BUSINESS: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
  OTHER: FALLBACK,
};

/** AssetType (schema.prisma) — Assets.tsx card's outer type chip. */
export const ASSET_TYPE_COLORS: Record<string, string> = {
  PROPERTY: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  VEHICLE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  GOLD: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  OTHER: FALLBACK,
};

/** VehicleType (schema.prisma) — Assets.tsx, only rendered on VEHICLE cards, alongside
 *  ASSET_TYPE_COLORS and FUEL_TYPE_COLORS — kept in a disjoint hue family (see header). */
export const VEHICLE_TYPE_COLORS: Record<string, string> = {
  TWO_WHEELER: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  FOUR_WHEELER: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  OTHER: FALLBACK,
};

/** FuelType (schema.prisma) — Assets.tsx, same VEHICLE cards as above. Real-world fuel
 *  associations (petrol=amber/orange, electric=green) chosen where they don't collide. */
export const FUEL_TYPE_COLORS: Record<string, string> = {
  PETROL: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  DIESEL: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
  ELECTRIC: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  HYBRID: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  CNG: 'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  OTHER: FALLBACK,
};

/** PropertyType (schema.prisma) — RealEstate.tsx card's type chip. */
export const PROPERTY_TYPE_COLORS: Record<string, string> = {
  RESIDENTIAL: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  COMMERCIAL: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  LAND: 'bg-lime-100 text-lime-700 dark:bg-lime-900 dark:text-lime-300',
  PLOT: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
};

/** GoldType (schema.prisma) — Gold.tsx holding's type chip. */
export const GOLD_TYPE_COLORS: Record<string, string> = {
  PHYSICAL: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  SGB: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  GOLD_ETF: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  DIGITAL: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
};

/** InvestmentType (schema.prisma) — Investments.tsx portfolio row's type chip. */
export const INVESTMENT_TYPE_COLORS: Record<string, string> = {
  STOCKS_INDIA: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  STOCKS_FOREIGN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  MUTUAL_FUND: 'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  ELSS: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  PPF: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  NPS: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  EPF: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  SGB: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  GOLD_ETF: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
  BONDS: 'bg-lime-100 text-lime-700 dark:bg-lime-900 dark:text-lime-300',
  CRYPTO: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300',
  OTHER: FALLBACK,
};

/** Tax regime (OLD/NEW) — shared by FYHistoryTab.tsx and ITR2Summary.tsx, which
 *  previously disagreed on the color for the same value (blue/purple vs blue/amber). */
export const REGIME_COLORS: Record<string, string> = {
  OLD: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  NEW: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
};

export const CHIP_COLOR_FALLBACK = FALLBACK;
