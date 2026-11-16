import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Quote } from 'lucide-react';
import { whyBridge } from '../../lib/why-bridge';
import { citeHit, openHit, recalledMarkdown } from '../../lib/recall';
import { cachedCard, makeCard } from '../../lib/recall-cards';
import { useStore } from '../../store';
import { useT, fmt } from '../../i18n';

// The answer to "what did we say about X": the dossier of a topic named
// by the phrase comes first; then the why layer's hits grouped by
// conversation (one line per conversation says what it was about; the
// turns unfold underneath). Two actions on a turn: Open follows it into
// its mirror (a memory entry unfolds in place), Cite quotes it onto the
// canvas as a note wired into the selected node.

const LIMIT = 60;
const CARD_GROUPS = 8;
const when = (at: string | null): string => (at ? at.slice(0, 10) : '');
const keyOf = (h: WhyFindHit) => `${h.session}#${h.turn}`;

/** One-line cards for a few hits: cached ones at once, missing ones made in the background, one at a time. */
function useHitCards(hits: WhyFindHit[]): Record<string, string> {
  const [cards, setCards] = useState<Record<string, string>>({});
  const keys = hits.map(keyOf).join('|');
  useEffect(() => {
    let alive = true;
    void (async () => {
      const b = whyBridge();
      if (!b) return;
      for (const h of hits) {
        const k = keyOf(h);
        const have = await cachedCard(h.session, h.turn);
        if (!alive) return;
        if (have) { setCards((p) => (p[k] ? p : { ...p, [k]: have })); continue; }
        try {
          const r = await b.recall(h.session, h.turn);
          const made = await makeCard(h.session, h.turn, recalledMarkdown(r));
          if (made && alive) setCards((p) => ({ ...p, [k]: made }));
        } catch { /* the snippet stands */ }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return cards;
}

/** A list of hits with their two actions; shared by the topic browser and the side panel's related conversations. */
export function HitCards({ hits, onOpened, extra, cards }: { hits: WhyFindHit[]; onOpened?: () => void; extra?: (h: WhyFindHit) => ReactNode; cards?: Record<string, string> }) {
  const t = useT();
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const [unfolded, setUnfolded] = useState<Record<string, WhyRecalledTurn | 'loading'>>({});
  const [citing, setCiting] = useState<string | null>(null);
  const unfold = async (h: WhyFindHit) => {
    const k = keyOf(h);
    if (unfolded[k]) { setUnfolded((u) => { const n = { ...u }; delete n[k]; return n; }); return; }
    setUnfolded((u) => ({ ...u, [k]: 'loading' }));
    try { const r = await whyBridge()!.recall(h.session, h.turn); setUnfolded((u) => ({ ...u, [k]: r })); }
    catch { setUnfolded((u) => { const n = { ...u }; delete n[k]; return n; }); }
  };
  const open = async (h: WhyFindHit) => {
    if (h.kind === 'memory') { await unfold(h); return; }
    if (await openHit(h)) onOpened?.();
  };
  const cite = async (h: WhyFindHit) => {
    setCiting(keyOf(h));
    try { await citeHit(h, selectedNodeId); } finally { setCiting(null); }
  };
  return (
    <div className="space-y-1">
      {hits.map((h) => {
        const k = keyOf(h);
        const u = unfolded[k];
        const card = cards?.[k];
        return (
          <div key={k} className="border border-line rounded-xl px-3 py-2 bg-card hover:bg-wash/60 transition-colors" data-recall-hit={h.kind}>
            <div className="flex items-start gap-2">
              <button onClick={() => void open(h)} className="flex-1 min-w-0 text-left" title={h.kind === 'memory' ? h.file : h.open} data-recall-open>
                <div className="text-xs text-ink leading-relaxed break-words">{card ?? <><span className="text-ink-faint">{h.where}: </span>{h.snippet}</>}</div>
                <div className="text-2xs text-ink-faint font-mono flex items-center gap-1.5 flex-wrap mt-0.5">
                  <span className="border border-line rounded px-1 py-px">{h.runner}</span>
                  <span>#{h.turn}</span>
                  {h.at && <span>{when(h.at)}</span>}
                  {extra?.(h)}
                  {h.kind === 'memory' ? (u ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <ExternalLink size={11} />}
                </div>
              </button>
              <button
                onClick={() => void cite(h)}
                disabled={citing === k}
                className="shrink-0 flex items-center gap-1 text-2xs text-accent hover:bg-accent/10 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                title={t('recall.cite')}
                data-recall-cite
              >
                {citing === k ? <Loader2 size={11} className="animate-spin" /> : <Quote size={11} strokeWidth={1.75} />} {t('recall.cite')}
              </button>
            </div>
            {u && (
              <div className="mt-2 border-t border-line/60 pt-2 text-xs text-ink-muted leading-relaxed whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto" data-recall-unfolded>
                {u === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <><div className="font-medium text-ink mb-1">{u.question}</div>{u.response}</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Group { session: string; runner: string; title: string; kind: 'turn' | 'memory'; at: string | null; hits: WhyFindHit[] }

export default function RecallResults({
  phrase, onOpened, dossiers, onOpenDossier,
  /** an id query: the session card is the answer, so an empty phrase result
   *  has nothing to add — hide the line, keep the hits */
  quietEmpty,
}: {
  phrase: string;
  onOpened?: () => void;
  dossiers?: WhyDossierSummary[];
  onOpenDossier?: (topicId: string) => void;
  quietEmpty?: boolean;
}) {
  const t = useT();
  const [result, setResult] = useState<WhyFindResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const bridge = whyBridge();
    if (!bridge) return;
    const q = phrase.trim();
    if (timer.current) window.clearTimeout(timer.current);
    if (q.length < 2) return; // nothing renders below two characters; the last result waits
    let alive = true;
    timer.current = window.setTimeout(() => {
      setBusy(true); setError(null);
      bridge.find(q, { limit: LIMIT })
        .then((r) => { if (alive) setResult(r); })
        .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (alive) setBusy(false); });
    }, 350);
    return () => { alive = false; if (timer.current) window.clearTimeout(timer.current); };
  }, [phrase]);

  const groups: Group[] = (() => {
    if (!result) return [];
    const m = new Map<string, Group>();
    for (const h of result.hits) {
      const g = m.get(h.session) ?? { session: h.session, runner: h.runner, title: h.title, kind: h.kind, at: h.at, hits: [] };
      g.hits.push(h);
      if ((h.at ?? '') > (g.at ?? '')) g.at = h.at;
      m.set(h.session, g);
    }
    return [...m.values()].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  })();
  const firstHits = groups.slice(0, CARD_GROUPS).map((g) => g.hits[0]);
  const cards = useHitCards(firstHits);

  if (!whyBridge()) return <p className="text-xs text-ink-faint italic px-1 py-2" data-recall-unavailable>{t('recall.unavailable')}</p>;
  const q = phrase.trim().toLowerCase();
  if (q.length < 2) return null;
  const dossierHits = (dossiers ?? []).filter((d) => d.built && (d.name.toLowerCase().includes(q) || q.includes(d.name.toLowerCase())));
  if (quietEmpty && !error && !(result && result.hits.length > 0) && dossierHits.length === 0) return null;

  return (
    <section className="mb-4" data-recall-results>
      {dossierHits.length > 0 && (
        <div className="space-y-1 mb-3 max-w-[720px]" data-recall-dossiers>
          {dossierHits.map((d) => (
            <div key={d.topicId} className="border border-accent/40 bg-accent/10 rounded-xl px-3 py-2 flex items-start gap-2" data-recall-dossier={d.topicId}>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink"><span className="font-medium">{fmt(t('dossier.title'), { name: d.name })}</span>{d.lead ? ` · ${d.lead}` : ''}</div>
                <div className="text-2xs text-ink-faint mt-0.5">{fmt(t('mp.fromTurns'), { n: d.covered })} · {t('dossier.updated')} {d.updatedAt.slice(0, 10)}</div>
              </div>
              {onOpenDossier && <button onClick={() => onOpenDossier(d.topicId)} className="shrink-0 text-2xs text-accent hover:bg-accent/10 px-2 py-1 rounded-lg">{t('recall.dossierOpen')}</button>}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3 text-2xs text-ink-faint px-1 pb-1.5">
        {busy ? <span className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {t('recall.searching')}</span>
          : result ? <><span data-recall-summary>{fmt(t('recall.groupSummary'), { s: groups.length, n: result.turns })}</span><span>{t('recall.groupedHint')}</span></> : null}
        {error && <span className="text-red-500">{error}</span>}
      </div>
      {result && result.hits.length === 0 && !busy && (
        <p className="text-xs text-ink-faint italic px-1 py-2" data-recall-none>{t('recall.none')}</p>
      )}
      <div className="space-y-1.5 max-w-[720px]">
        {groups.map((g) => {
          const open = !!expanded[g.session];
          const lead = cards[keyOf(g.hits[0])];
          return (
            <div key={g.session} className="border border-line rounded-xl bg-card overflow-hidden" data-recall-group={g.kind}>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-2.5 items-center px-3 py-2 cursor-pointer hover:bg-wash/60" onClick={() => setExpanded((e) => ({ ...e, [g.session]: !open }))} data-recall-group-head>
                <span className="text-2xs font-mono text-ink-faint border border-line rounded px-1 py-px">{g.kind === 'memory' ? 'memory' : g.runner}</span>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink truncate">{g.title}</div>
                  <div className="text-2xs text-ink-muted truncate">{lead ?? g.hits[0].snippet}</div>
                </div>
                <span className="text-2xs font-mono text-ink-faint whitespace-nowrap">{g.hits.length} · {when(g.at)}</span>
                {g.kind === 'turn' ? (
                  <button onClick={async (e) => { e.stopPropagation(); if (await openHit(g.hits[0])) onOpened?.(); }} className="text-2xs text-accent hover:bg-accent/10 px-2 py-1 rounded-lg" data-recall-group-open>{t('recall.openSession')}</button>
                ) : <span className="w-8" />}
              </div>
              {open && (
                <div className="border-t border-line px-3 py-2 bg-surface">
                  <HitCards hits={g.hits} onOpened={onOpened} cards={cards} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {result && result.turns > result.hits.length && (
        <p className="text-2xs text-ink-faint px-1 mt-1">{fmt(t('recall.moreIn'), { n: result.turns - result.hits.length })}</p>
      )}
    </section>
  );
}
