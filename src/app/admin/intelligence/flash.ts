import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Batch 24: a one-shot message from an admin action to the page it returns
 * to (the /admin/demand pattern). Short values only, so the cookie stays
 * under the size a browser keeps.
 */
const FLASH_COOKIE = 'sf_si_flash';

export interface Flash {
  kind: 'ok' | 'error';
  message: string;
  detail?: string[];
}

export async function flashAndGo(to: string, f: Flash): Promise<never> {
  const jar = await cookies();
  const body = { kind: f.kind, message: f.message.slice(0, 600), detail: (f.detail ?? []).slice(0, 12).map((d) => d.slice(0, 200)) };
  jar.set(FLASH_COOKIE, Buffer.from(JSON.stringify(body)).toString('base64url').slice(0, 3800), { maxAge: 300, path: '/admin', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  redirect(to);
}

export async function readFlash(): Promise<Flash | null> {
  try {
    const raw = (await cookies()).get(FLASH_COOKIE)?.value;
    if (!raw) return null;
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Flash;
  } catch {
    return null;
  }
}
