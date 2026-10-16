// Bengali date labels. The UI shows times such as "এইমাত্র", "২ ঘণ্টা আগে" and
// "২০ ফেব্রুয়ারি ২০২৬", so the API stores real Dates and formats them here.
import { canonBn } from './bnText.js';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const BN_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
].map(canonBn);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const toBnDigits = (value) => String(value).replace(/\d/g, (d) => BN_DIGITS[d]);
const fromBnDigits = (value) => value.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));

export function formatBnDate(date) {
  const d = new Date(date);
  return `${toBnDigits(d.getDate())} ${BN_MONTHS[d.getMonth()]} ${toBnDigits(d.getFullYear())}`;
}

/** "এইমাত্র", "৫ মিনিট আগে", "২ ঘণ্টা আগে", "গতকাল", "৩ দিন আগে", then a full date. */
export function relativeBn(date, now = Date.now()) {
  const diff = Math.max(0, now - new Date(date).getTime());
  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 1) return 'এইমাত্র';
  if (minutes < 60) return `${toBnDigits(minutes)} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${toBnDigits(hours)} ঘণ্টা আগে`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'গতকাল';
  if (days < 7) return `${toBnDigits(days)} দিন আগে`;
  return formatBnDate(date);
}

/** Calendar-day label: "আজ", "গতকাল", "৩ দিন আগে", then a full date. */
export function dayLabelBn(date, now = new Date()) {
  const d = new Date(date);
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return 'আজ';
  if (days === 1) return 'গতকাল';
  if (days < 7) return `${toBnDigits(days)} দিন আগে`;
  return formatBnDate(d);
}

/** Inverse of the labels above; used when seeding mock data. Falls back to `now`. */
export function parseBnTime(label, now = Date.now()) {
  if (!label) return new Date(now);
  const s = fromBnDigits(canonBn(String(label).trim()));
  if (s === 'এইমাত্র' || s === 'আজ') return new Date(now);
  if (s === 'গতকাল') return new Date(now - DAY);

  let m = s.match(/^(\d+)\s*(মিনিট|ঘণ্টা|দিন)\s*আগে$/u);
  if (m) {
    const unit = { মিনিট: MINUTE, ঘণ্টা: HOUR, দিন: DAY }[m[2]];
    return new Date(now - Number(m[1]) * unit);
  }

  m = s.match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/u);
  if (m) {
    const month = BN_MONTHS.indexOf(m[2]);
    if (month >= 0) return new Date(Number(m[3]), month, Number(m[1]), 12);
  }
  return new Date(now);
}
