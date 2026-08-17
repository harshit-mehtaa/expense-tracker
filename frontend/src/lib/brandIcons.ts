import {
  siNetflix, siGoogle, siYoutube, siSpotify, siApple, siIcloud,
  siSwiggy, siZomato, siUber, siJio, siAirtel,
  siPaytm, siPhonepe, siGooglepay, siNotion, siGithub, siDropbox,
  siFigma, siAudible, siDuolingo, siStrava, siX, siWhatsapp, siZerodha,
} from 'simple-icons';

/**
 * Official brand marks for categories that name a real company.
 *
 * The icon column is a string rendered as text, so it can only ever hold an emoji — an
 * approximation for something like Netflix, which has an actual mark. These render the
 * real logo where one exists and fall back to the stored emoji where it does not.
 *
 * Bundled from the `simple-icons` package rather than fetched from its CDN. A CDN request
 * per logo would tell a third party precisely which services this household subscribes
 * to, which is not a reasonable thing for a personal finance app to leak, and it would
 * break entirely offline.
 *
 * Simple Icons ships CC0 path data. It has REMOVED a good many brands after trademark
 * requests -- Amazon, Prime Video, Disney+, Hotstar, Microsoft, Adobe, LinkedIn, Slack
 * and Canva among them -- so those keep their emoji. "Official logo wherever possible"
 * has a real boundary, and it is drawn by what the brands permit rather than by effort.
 */

export interface BrandMark {
  /** Single SVG path, on a 24x24 viewBox. */
  path: string;
  /** The brand's own hex, without the leading #. */
  hex: string;
  title: string;
}

const toMark = (icon: { path: string; hex: string; title: string }): BrandMark => ({
  path: icon.path,
  hex: icon.hex,
  title: icon.title,
});

/**
 * Keyed by the same normalisation the backend's category styling uses, so "Amazon-Prime",
 * "amazon prime" and "Amazon  Prime" all resolve alike.
 */
const BRAND_BY_NAME: Record<string, BrandMark> = {
  netflix: toMark(siNetflix),
  google: toMark(siGoogle),
  'google one': toMark(siGoogle),
  'google drive': toMark(siGoogle),
  youtube: toMark(siYoutube),
  'youtube premium': toMark(siYoutube),
  'youtube music': toMark(siYoutube),
  spotify: toMark(siSpotify),
  apple: toMark(siApple),
  'apple music': toMark(siApple),
  'apple tv': toMark(siApple),
  icloud: toMark(siIcloud),
  'icloud storage': toMark(siIcloud),
  audible: toMark(siAudible),

  // Food delivery and transport, common recurring spend in India.
  swiggy: toMark(siSwiggy),
  zomato: toMark(siZomato),
  uber: toMark(siUber),
  jio: toMark(siJio),
  airtel: toMark(siAirtel),
  paytm: toMark(siPaytm),
  phonepe: toMark(siPhonepe),
  'google pay': toMark(siGooglepay),
  gpay: toMark(siGooglepay),

  // Tools and services people commonly hold subscriptions to.
  notion: toMark(siNotion),
  github: toMark(siGithub),
  dropbox: toMark(siDropbox),
  figma: toMark(siFigma),
  duolingo: toMark(siDuolingo),
  strava: toMark(siStrava),
  zerodha: toMark(siZerodha),
  x: toMark(siX),
  twitter: toMark(siX),
  whatsapp: toMark(siWhatsapp),
};

/** Mirrors `backend/src/utils/categoryStyle.ts` so both sides key names identically. */
function normalizeBrandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The official mark for a category name, or `null` when there is not one.
 *
 * Matches the whole name first, then falls back to the leading word so that "Netflix
 * Premium" or "Spotify Family" still resolve. Deliberately not a substring search in
 * either direction: "Apple" must not match "Pineapple", and a category called "Travel"
 * must not pick up a brand that happens to contain those letters.
 */
export function getBrandMark(name: string | null | undefined): BrandMark | null {
  if (!name) return null;
  const normalized = normalizeBrandName(name);
  if (!normalized) return null;

  const exact = BRAND_BY_NAME[normalized];
  if (exact) return exact;

  const firstWord = normalized.split(' ')[0];
  return BRAND_BY_NAME[firstWord] ?? null;
}
