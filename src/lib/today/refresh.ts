/**
 * Batch 22, Part G: refreshing today's list when a member's search finishes.
 * Finds that rank better than an unanswered, un-revealed card take its place;
 * the revealed cards and anything saved, passed or opened stay where they are;
 * the list never grows past `max`; a replaced card goes into shown_ids so it
 * never comes back. Running it twice changes nothing the second time.
 *
 * Pure: no network, no database, no server-only.
 */

export interface RefreshInput {
  /** Today's stored list, in order. */
  current: readonly string[];
  /** Cards that must stay: revealed, kept, passed, opened. */
  pinned: ReadonlySet<string>;
  /** Today's ranking over the pool including the finds, best first. */
  ranking: readonly string[];
  /** The deals the search found (and that are live and visible to the member). */
  finds: ReadonlySet<string>;
  max: number;
}

export interface RefreshResult {
  dealIds: string[];
  added: string[];
  replaced: string[];
  changed: boolean;
}

export function refreshList(input: RefreshInput): RefreshResult {
  const rank = new Map<string, number>();
  input.ranking.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const rankOf = (id: string) => rank.get(id) ?? Number.POSITIVE_INFINITY;
  const list = [...input.current];
  const added: string[] = [];
  const replaced: string[] = [];
  const candidates = input.ranking.filter((id) => input.finds.has(id) && !list.includes(id));

  for (const find of candidates) {
    if (list.length < input.max) {
      list.push(find);
      added.push(find);
      continue;
    }
    // The worst-ranked card that may be replaced, if the find beats it.
    let worst = -1;
    for (let i = 0; i < list.length; i++) {
      const id = list[i];
      if (input.pinned.has(id) || added.includes(id)) continue;
      if (worst === -1 || rankOf(id) > rankOf(list[worst])) worst = i;
    }
    if (worst === -1 || rankOf(find) >= rankOf(list[worst])) continue;
    replaced.push(list[worst]);
    list[worst] = find;
    added.push(find);
  }
  return { dealIds: list, added, replaced, changed: added.length > 0 };
}
