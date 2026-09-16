/**
 * Where members install the extension from, or null until the Chrome Web Store
 * listing exists (NEXT_PUBLIC_EXTENSION_ID unset).
 *
 * The listing is unlisted: it is live in the store but hidden from store
 * search, so the only way in is a link we hand out. The store cannot tell a
 * paying member from anyone else — that gate is the connection token, which is
 * only mintable at /extension/connect behind the member check — but keeping
 * this link on member-only pages means the install never circulates publicly.
 */
export function chromeStoreUrl(): string | null {
  const id = process.env.NEXT_PUBLIC_EXTENSION_ID;
  return id ? `https://chromewebstore.google.com/detail/${id}` : null;
}
