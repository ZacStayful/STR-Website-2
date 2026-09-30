/**
 * Batch 20, Part D: recording every existing account's mobile number as a
 * claimed key (profiles.mobile_key), which the welcome check never did for
 * the accounts the 12 Sep backfill granted. One number, one holder: where
 * accounts share a number, the oldest account (created first, then by id)
 * keeps it and the others are listed. Nothing else changes: no credit is
 * taken back and no welcome decision is revisited.
 *
 * The numbers are normalised exactly as the welcome check does it
 * (normaliseMobile), so the keys this writes are the ones that check and the
 * starter pack compare against.
 *
 * Pure: no network, no database, no server-only.
 */
import { normaliseMobile } from './abuse.ts';

export interface MobileAccount {
  id: string;
  email: string | null;
  createdAt: string | null;
  mobile: string | null;
  mobileKey: string | null;
}

export interface KeyPlan {
  key: string;
  /** The number as the report shows it: only its last three digits. */
  masked: string;
  keeper: MobileAccount;
  /** Every other account with this number (by its mobile or holding its key), oldest first. */
  others: MobileAccount[];
  /** Accounts that hold the key now and will lose it. */
  takeFrom: string[];
  /** The keeper does not hold it yet. */
  setKeeper: boolean;
}

export interface MobilePlan {
  accounts: number;
  withNumber: number;
  /** Numbers that do not normalise to anything usable. */
  unreadable: number;
  /** Every number with the account that keeps it. */
  keys: KeyPlan[];
  /** Only the numbers that need a write. */
  changes: KeyPlan[];
  /** Numbers held by more than one account. */
  clashes: KeyPlan[];
  /**
   * Left alone: an account that already holds a different number keeps that
   * one (an account can hold one key), so this number goes to nobody here
   * and is reported instead.
   */
  skipped: { key: string; masked: string; accountId: string; reason: 'keeper_holds_other_key' }[];
}

export function maskNumber(key: string): string {
  const digits = key.replace(/\D/g, '');
  return digits.length >= 3 ? `…${digits.slice(-3)}` : '…';
}

function created(a: MobileAccount): number {
  const t = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/** Oldest first; an unknown creation date sorts last; ties by id. */
export function oldestFirst(a: MobileAccount, b: MobileAccount): number {
  const ca = created(a);
  const cb = created(b);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function planMobileClaims(accounts: readonly MobileAccount[]): MobilePlan {
  const byKey = new Map<string, MobileAccount[]>();
  const add = (key: string, a: MobileAccount) => {
    const list = byKey.get(key) ?? [];
    if (!list.some((x) => x.id === a.id)) list.push(a);
    byKey.set(key, list);
  };
  let withNumber = 0;
  let unreadable = 0;
  for (const a of accounts) {
    if (a.mobile && a.mobile.trim()) {
      withNumber += 1;
      const key = normaliseMobile(a.mobile);
      if (key) add(key, a);
      else unreadable += 1;
    }
    // An account holding a key is part of that number's group whatever its
    // mobile says now, so "the oldest keeps it" weighs every claimant.
    if (a.mobileKey) add(a.mobileKey, a);
  }

  const keys: KeyPlan[] = [];
  const skipped: MobilePlan['skipped'] = [];
  for (const [key, group] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const sorted = [...group].sort(oldestFirst);
    // The oldest account that can take this key: one already holding a
    // different key keeps its own (a profile holds one key).
    const keeper = sorted.find((a) => !a.mobileKey || a.mobileKey === key) ?? null;
    if (!keeper) {
      skipped.push({ key, masked: maskNumber(key), accountId: sorted[0].id, reason: 'keeper_holds_other_key' });
      continue;
    }
    const others = sorted.filter((a) => a.id !== keeper.id);
    keys.push({
      key,
      masked: maskNumber(key),
      keeper,
      others,
      takeFrom: others.filter((a) => a.mobileKey === key).map((a) => a.id),
      setKeeper: keeper.mobileKey !== key,
    });
  }
  return {
    accounts: accounts.length,
    withNumber,
    unreadable,
    keys,
    changes: keys.filter((k) => k.setKeeper || k.takeFrom.length > 0),
    clashes: keys.filter((k) => k.others.length > 0),
    skipped,
  };
}
