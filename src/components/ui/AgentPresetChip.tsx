import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { useT, fmt, type MessageKey } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useProjects, setProjectAgentPreset } from '../../store/projects';
import { isHarnessAgentModel } from '../../lib/atlas/dsh-bridge';
import { IN_HARNESS } from '../../lib/embedded';
import { API_BASE } from '../../lib/constants';

// Which Agent preset (标准模式, PTC 模式, 极简模式, 创造模式 …) a session this
// canvas STARTS runs as, on the toolbar beside the working directory and
// permissions. DSH takes the preset when it creates a session and locks it
// once the session has begun, so this switch reaches exactly the fresh
// sessions a question opens: a fork keeps the preset of the session it was
// forked from, and a continued session keeps its own. Absent = follow the
// host's default. The roster is the host's own list; a host that has none
// (an older plugin) shows no chip at all.

interface Preset { id: string; name?: string; description?: string; isDefault?: boolean }
interface Roster { presets: Preset[]; default: string | null }

// A shipped preset publishes no name — the host leaves it to its owner's
// copy (the DSH settings page localizes the same four ids). A preset that
// names itself is user-authored and keeps its own words, exactly as DSH
// renders it; the ids below only dress the built-in four.
const BUILT_IN: Record<string, { name: MessageKey; desc: MessageKey }> = {
  standard: { name: 'preset.standard', desc: 'preset.standardDesc' },
  ptc: { name: 'preset.ptc', desc: 'preset.ptcDesc' },
  minimal: { name: 'preset.minimal', desc: 'preset.minimalDesc' },
  cordis: { name: 'preset.cordis', desc: 'preset.cordisDesc' },
};

export default function AgentPresetChip() {
  const t = useT();
  const selectedModel = useUiStore((s) => s.selectedModel);
  const activeId = useProjects((s) => s.activeId);
  const stored = useProjects((s) => s.projects.find((p) => p.id === s.activeId)?.agentPreset);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const harness = IN_HARNESS && !!window.desktopSessions && isHarnessAgentModel(selectedModel);

  // The roster is the host's: ask when the picker comes back to the harness
  // lane, and again each time the menu opens (a preset may have been
  // installed or removed since).
  useEffect(() => {
    if (!harness) return;
    let alive = true;
    void fetch(`${API_BASE}/api/agent-presets`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Roster | null) => {
        if (!alive) return;
        setRoster(j && Array.isArray(j.presets) && j.presets.length > 0 ? j : null);
      })
      .catch(() => { if (alive) setRoster(null); });
    return () => { alive = false; };
  }, [harness, open]);

  // A remembered preset this host no longer offers: forget it rather than
  // send an id the host would only drop.
  useEffect(() => {
    if (!roster || !stored || !activeId) return;
    if (!roster.presets.some((p) => p.id === stored)) void setProjectAgentPreset(activeId, undefined);
  }, [roster, stored, activeId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!harness || !roster || !activeId) return null;
  const textOf = (p: Preset): { name: string; description?: string } => {
    const builtIn = p.name === undefined ? BUILT_IN[p.id] : undefined;
    return builtIn
      ? { name: t(builtIn.name), description: t(builtIn.desc) }
      : { name: p.name ?? p.id, ...(p.description ? { description: p.description } : {}) };
  };
  const chosen = stored && roster.presets.some((p) => p.id === stored) ? stored : null;
  const effective = chosen ?? roster.default ?? roster.presets[0]?.id;
  const shown = roster.presets.find((p) => p.id === effective);
  const fallback = roster.presets.find((p) => p.id === roster.default);
  const shownText = shown ? textOf(shown) : null;
  const fallbackText = fallback ? textOf(fallback) : null;

  const choose = async (id: string | undefined) => {
    await setProjectAgentPreset(activeId, id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="bg-card/90 backdrop-blur border border-line rounded-lg h-8 px-2.5 flex items-center gap-1.5 shadow-sm hover:bg-wash transition-colors text-xs text-ink max-w-[220px]"
        title={`${t('agent.preset')} · ${shownText?.name ?? t('agent.presetDefault')}`}
        data-agent-preset-chip={chosen ?? 'default'}
      >
        <Layers size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" />
        <span className="truncate">{shownText?.name ?? t('agent.presetDefault')}</span>
        {!chosen && <span className="text-2xs text-ink-faint shrink-0">{t('agent.presetDefault')}</span>}
        <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[320px] bg-card border border-line rounded-xl shadow-lg py-1.5 z-50 animate-fade-in" onClick={(e) => e.stopPropagation()} data-agent-preset-menu>
          <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{t('agent.preset')} · {t('agent.presetScope')}</p>
          <button
            onClick={() => void choose(undefined)}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-start gap-2"
            data-agent-preset="default"
          >
            <Layers size={14} strokeWidth={1.75} className="shrink-0 mt-0.5 text-ink-faint" />
            <span className="flex-1 min-w-0">
              <span className="block text-ink">{t('agent.presetDefault')}</span>
              <span className="block text-2xs text-ink-faint leading-relaxed">
                {fallbackText ? fmt(t('agent.presetDefaultHintNamed'), { name: fallbackText.name }) : t('agent.presetDefaultHint')}
              </span>
            </span>
            {!chosen && <Check size={13} strokeWidth={2} className="shrink-0 mt-0.5 text-accent" />}
          </button>
          {roster.presets.map((p) => {
            const text = textOf(p);
            return (
              <button
                key={p.id}
                onClick={() => void choose(p.id)}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-start gap-2"
                data-agent-preset={p.id}
              >
                <Layers size={14} strokeWidth={1.75} className={`shrink-0 mt-0.5 ${chosen === p.id ? 'text-accent' : 'text-ink-faint'}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-ink">{text.name}</span>
                  {text.description && <span className="block text-2xs text-ink-faint leading-relaxed line-clamp-2">{text.description}</span>}
                </span>
                {chosen === p.id && <Check size={13} strokeWidth={2} className="shrink-0 mt-0.5 text-accent" />}
              </button>
            );
          })}
          <div className="border-t border-line/60 my-1" />
          <p className="px-3 py-1 text-2xs text-ink-faint leading-relaxed">{t('agent.presetHint')}</p>
        </div>
      )}
    </div>
  );
}
