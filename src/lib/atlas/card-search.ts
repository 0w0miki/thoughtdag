// What the atlas search box answers to. Two things a person actually has
// in hand: a word from the card they remember, and a session id they copied
// from somewhere else (a `why` trace, another app's log, a file name). The
// card shows the first; the second it prints only when matched, so a hit
// never reads as a mystery.

export interface SearchableCard {
  sessionId: string;
}

/** The query as the atlas compares it: trimmed, case-folded, and without
 *  the extension a copied file name drags along. */
export function atlasQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.(?:jsonl|ndjson|json|zstd)$/, '');
}

/** `session-` / `agent-` names a file family, not the conversation: the
 *  short form the card prints starts after it. */
export function shortSessionId(id: string): string {
  return id.replace(/^(?:session|agent)-/i, '');
}

/** A session id, by any head of it a person could have: the full id, the
 *  short form on the card, or a prefix of either. Never by a fragment from
 *  its middle — an id is an identity, and a middle fragment names nothing
 *  anyone would copy on purpose. */
export function sessionIdMatches(id: string, rawQuery: string): boolean {
  const q = atlasQuery(rawQuery);
  if (!q) return true;
  const full = id.toLowerCase();
  return full.startsWith(q) || shortSessionId(full).startsWith(q);
}

/** Title substring (the words on the card) or a session-id prefix. `title`
 *  is the string the card displays — display, search and sort must agree. */
export function cardMatchesQuery(card: SearchableCard, title: string, rawQuery: string): boolean {
  const q = atlasQuery(rawQuery);
  if (!q) return true;
  return title.toLowerCase().includes(q) || sessionIdMatches(card.sessionId, q);
}

/** Whether a query is aimed at an id rather than at words: id-shaped, so
 *  "no such session" can be said instead of "nothing matched". */
export function looksLikeSessionId(rawQuery: string): boolean {
  return /^(?:session-|agent-)?[0-9a-f]{8}[0-9a-f-]*$/i.test(atlasQuery(rawQuery));
}
