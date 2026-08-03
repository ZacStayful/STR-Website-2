/**
 * Mobile-number normalisation, used to decide whether two accounts belong to
 * the same person when pooling the free-report allowance.
 *
 * Signup strips spaces, brackets and hyphens but keeps whatever prefix was
 * typed, so one phone can be stored as "07537998686", "447537998686" or
 * "+447537998686". Pooling has to treat those as one person.
 */

/**
 * Fold a mobile number to a stable pooling key.
 *
 * UK mobiles collapse to E.164 (+447…). Anything that isn't recognisably a UK
 * mobile — landlines, international numbers — is returned as typed (digits
 * only), so two genuinely different numbers can never share a key and lock an
 * innocent user out. Returns null when there is nothing usable to match on.
 */
export function normaliseMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;

  // Reduce an explicit UK prefix to the bare national number. A bare number
  // with no prefix at all is only assumed to be UK when it looks like a mobile
  // (7xxxxxxxxx) — otherwise we would risk folding, say, a foreign number onto
  // a UK key and locking an innocent user out.
  let national: string | null = null;
  if (cleaned.startsWith("+44")) {
    national = cleaned.slice(3);
  } else if (cleaned.startsWith("44") && cleaned.length > 11) {
    national = cleaned.slice(2);
  } else if (cleaned.startsWith("0") && !cleaned.startsWith("00")) {
    national = cleaned.replace(/^0+/, "");
  } else if (/^7\d{9}$/.test(cleaned)) {
    national = cleaned;
  }

  if (national && /^\d{9,10}$/.test(national)) return `+44${national}`;

  return cleaned;
}

/**
 * The stored spellings a pooling key could appear as in `profiles.mobile`.
 *
 * Used to keep the lookup a bounded indexed `in (...)` rather than scanning
 * and normalising every profile in the table. Callers must still re-check each
 * row with normaliseMobile(), since these variants are a superset.
 */
export function mobileVariants(normalised: string): string[] {
  if (!normalised.startsWith("+44")) return [normalised];
  const national = normalised.slice(3);
  return [normalised, `44${national}`, `0${national}`, national];
}
