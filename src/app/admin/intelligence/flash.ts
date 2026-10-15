import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Batch 24: a one-shot message from an admin action to the page it returns
 * to (the /admin/demand pattern). Short values only, so the cookie stays
 * under the size a browser keeps.
 *
 * R3-39: the message is for one page. The cookie is scoped to that page's
 * path (the browser sends it there and below, not to every /admin page) and
 * carries the path, which readFlash checks against the page reading it, so
 * approving entry A never shows "Approved" on entry B or on Gaps.
 */
const FLASH_COOKIE = 'sf_si_flash';

export interface Flash {
  kind: 'ok' | 'error';
  message: string;
  detail?: string[];
}

type Stored = Flash & { path?: string };

/** The page `to` lands on: its path, without the query or hash. */
function flashPath(to: string): string {
  return to.split(/[?#]/)[0] || '/admin';
}

function decoded(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

export async function flashAndGo(to: string, f: Flash): Promise<never> {
  const jar = await cookies();
  const path = flashPath(to);
  const body = { kind: f.kind, message: f.message.slice(0, 600), detail: (f.detail ?? []).slice(0, 12).map((d) => d.slice(0, 200)), path };
  // Drop detail lines from the end until it fits (a cut-off value would not parse, and the message would be lost).
  let value = Buffer.from(JSON.stringify(body)).toString('base64url');
  while (value.length > 3800 && body.detail.length > 0) {
    body.detail.pop();
    value = Buffer.from(JSON.stringify(body)).toString('base64url');
  }
  jar.set(FLASH_COOKIE, value, { maxAge: 300, path, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  redirect(to);
}

/** The message left for `page` (its path, e.g. '/admin/intelligence/gaps'), or null: a message for another page is never shown. */
export async function readFlash(page: string): Promise<Flash | null> {
  try {
    const want = decoded(flashPath(page));
    // A browser may hold one such cookie per path (an entry's and the list's): take the one for this page.
    for (const c of (await cookies()).getAll(FLASH_COOKIE)) {
      let f: Stored | null = null;
      try {
        f = JSON.parse(Buffer.from(c.value, 'base64url').toString('utf8')) as Stored;
      } catch {
        f = null;
      }
      if (f && typeof f.path === 'string' && decoded(f.path) === want) return { kind: f.kind, message: f.message, detail: f.detail };
    }
    return null;
  } catch {
    return null;
  }
}
