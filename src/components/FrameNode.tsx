import { useState } from 'react';
import { NodeResizer, useStore as useRfStore, type NodeProps } from '@xyflow/react';
import { ChevronDown, ChevronRight, Link2, Link2Off, Trash2 } from 'lucide-react';
import type { ThoughtNode as ThoughtNodeType } from '../types';
import { useStore } from '../store';
import { isImeComposing } from '../utils';
import { FRAME_COLORS, FRAME_COVER_ZOOM } from '../lib/constants';
import { frameDescendants } from '../lib/frames';
import { useT, fmt } from '../i18n';
import { isViewerMode } from '../lib/viewer';

// Frame: a labeled background region — THE spatial annotation. No handles
// (it can never be wired, so it can never touch context), ignored by
// autoLayout, sits behind nodes (zIndex -1). Drag by the title bar.
// Color is a FIXED palette (no picker): frames are pure navigation objects,
// so color is function, not decoration (palette lives in lib/constants).
//
// Three looks, chosen by zoom (a ladder, like the cards' plaques):
// - BAR (zoom >= 0.35): the title row with its controls. Sized in screen
//   pixels, so it stays operable; above 100% it scales with the canvas.
// - COVER (unfolded, zoom < 0.35): the bar gives way to a mask over the
//   region with the name filling it — at overview distance the NAME is the
//   wayfinding signal, and a bar pinned to the corner reads as chrome that
//   forgot to zoom. The name is sized in flow units, so it is part of the
//   region and scales with it.
// - CHIP (folded, any zoom): a fixed screen-size pill. Folding keeps the
//   region's place and size in the graph, but on the map it becomes one
//   compact marker with its name and how much it hides.
//
// Fold: a frame can hide everything it owns. What it owns is
// frameDescendants() (nested frames included); the stored frameExpandedHeight
// lets the unfold restore the region and lets membership stay answerable while
// hidden (lib/frames).

/** Resizing is a step of its own: settle before, record after. */
const recordStep = () => useStore.getState().pushHistory();
/** The zoom where the bar hands its job to the cover. */

export default function FrameNode({ id, data, selected }: NodeProps<ThoughtNodeType>) {
  const t = useT();
  const deleteNode = useStore((s) => s.deleteNode);
  const setSelectedNodeId = useStore((s) => s.setSelectedNodeId);
  const collapsed = data.frameCollapsed === true;
  // What the fold is hiding, counted live (0 while unfolded — the chip is
  // folded-state chrome). A number, so the selector only re-renders on change.
  const hiddenCount = useStore((s) => {
    if (!collapsed) return 0;
    const frame = s.nodes.find((n) => n.id === id);
    return frame ? frameDescendants(frame, s.nodes).length : 0;
  });

  // Three significant figures: enough to keep screen sizes honest down to the
  // canvas's 0.04 floor, coarse enough that zooming does not re-render every
  // frame on every sub-pixel tick.
  const zoom = useRfStore((s) => Number(Math.max(0.04, Math.min(2, s.transform[2])).toPrecision(3)));
  const barScale = Math.min(5, Math.max(1, 1 / zoom));
  // How much the bar is pushed back against the canvas. Above 100% the bar
  // scales WITH the canvas (close-up work: the whole region doubles, the title
  // row must double too); below 100% it stops shrinking once it would be
  // unreadable, which is what the 5x cap on barScale measures.
  const counter = Math.min(1, zoom * barScale);
  // Controls inside the bar are sized in SCREEN pixels through this (the bar is
  // CSS-scaled by barScale, `counter` folds that in).
  const screen = (px: number) => px / counter;
  // The chip and the cover's fold control sit OUTSIDE the bar: no barScale to
  // cancel, so only the canvas zoom applies. Same rule, different divisor.
  const fixed = (px: number) => px / Math.min(1, zoom);
  const cover = !collapsed && zoom < FRAME_COVER_ZOOM;

  const [editing, setEditing] = useState(!isViewerMode && !data.question);
  const [draft, setDraft] = useState(data.question);

  const color = FRAME_COLORS[data.frameColor ?? 'gray'] ?? FRAME_COLORS.gray;
  // Carry: dragging the frame moves the nodes inside it. Absent = linked
  // (legacy frames keep the behavior); new frames spawn unlinked so they can
  // be resized / positioned over their nodes first, then linked.
  const carry = data.frameCarry !== false;

  const patch = (p: Partial<ThoughtNodeType['data']>) => {
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...p } } : n)),
    }));
  };

  const commit = () => {
    setEditing(false);
    if (draft === data.question) return;
    useStore.getState().pushHistory();
    patch({ question: draft });
    useStore.getState().pushHistory();
  };

  const toggleFold = () => useStore.getState().setFrameCollapsed(id, !collapsed);

  return (
    <div
      className={`relative w-full h-full rounded-2xl flex flex-col transition-colors ${
        collapsed ? 'border-transparent' : `border-2 border-dashed ${color.border} ${color.bg}`
      } ${selected && !collapsed ? 'ring-1 ring-accent/40' : ''}`}
      onClick={() => setSelectedNodeId(id)}
    >
      {/* ── Folded: one fixed-size marker, whatever the zoom ── */}
      {collapsed && (
        <div
          className={`drag-handle cursor-grab active:cursor-grabbing absolute left-0 top-0 flex items-center rounded-lg border shadow-sm backdrop-blur ${color.border} ${color.bg}`}
          style={{ height: fixed(24), paddingInline: fixed(7), gap: fixed(5), borderRadius: fixed(8) }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); toggleFold(); }}
            title={t('frame.expand')}
            aria-expanded={false}
            style={{ width: fixed(14), height: fixed(14) }}
            className="flex items-center justify-center shrink-0 nodrag text-ink-faint hover:text-ink"
          >
            <ChevronRight size={fixed(13)} strokeWidth={1.75} />
          </button>
          <span
            className="truncate font-semibold text-ink-muted"
            style={{ fontSize: fixed(12), maxWidth: fixed(200) }}
          >
            {data.question || t('frame.untitled')}
          </span>
          <span
            style={{ fontSize: fixed(10) }}
            title={fmt(t('frame.items'), { n: hiddenCount })}
            className="shrink-0 font-medium text-ink-faint"
          >
            {hiddenCount}
          </span>
        </div>
      )}

      {/* At overview distance the name is drawn by App's FrameCovers layer,
          ABOVE the cards — a card shrunk to a glyph must not punch a hole
          through the region's name. Only the region itself stays here. */}
      {cover && <div className="flex-1 drag-handle cursor-grab active:cursor-grabbing" />}

      {/* ── Unfolded up close: the title row with its controls ── */}
      {!collapsed && !cover && (
        <>
          <div
            className="drag-handle cursor-grab active:cursor-grabbing px-4 py-2 flex items-center gap-2 min-w-0"
            style={barScale > 1 ? { transform: `scale(${barScale})`, transformOrigin: 'top left', width: `${100 / barScale}%` } : undefined}
          >
            {/* Fold control. The cover tier keeps its own copy of this button,
                and the folded chip has the matching unfold one. */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleFold(); }}
              title={t('frame.collapse')}
              aria-expanded
              style={{ width: screen(24), height: screen(24) }}
              className="rounded-full flex items-center justify-center transition-colors shrink-0 nodrag text-ink-faint hover:text-ink"
            >
              <ChevronDown size={screen(15)} strokeWidth={1.75} />
            </button>
            {editing ? (
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => { if ((e.key === 'Enter' && !isImeComposing(e)) || e.key === 'Escape') commit(); }}
                placeholder={t('frame.titlePlaceholder')}
                autoFocus
                style={{ fontSize: screen(13) }}
                className="flex-1 min-w-24 bg-transparent font-semibold text-ink-muted focus:outline-none placeholder-ink-faint nodrag"
              />
            ) : (
              <span
                onDoubleClick={() => { if (isViewerMode) return; setDraft(data.question); setEditing(true); }}
                style={{ fontSize: screen(13) }}
                title={t('content.noteEditTitle')}
                className={`flex-1 min-w-24 truncate font-semibold text-ink-muted/80 select-none ${
                  barScale <= 1 ? 'uppercase tracking-wider' : 'normal-case'
                }`}
              >
                {data.question || <span className="text-ink-faint normal-case tracking-normal">{t('frame.titlePlaceholder')}</span>}
              </span>
            )}
            {/* Carry toggle — always visible: it changes what dragging does, and
                dragging doesn't require selecting first. */}
            {!isViewerMode && <button
              onClick={(e) => { e.stopPropagation(); useStore.getState().pushHistory(); patch({ frameCarry: !carry }); useStore.getState().pushHistory(); }}
              title={carry ? t('frame.carryOn') : t('frame.carryOff')}
              style={{ width: screen(24), height: screen(24) }}
              className={`rounded-full flex items-center justify-center transition-colors shrink-0 nodrag ${
                carry ? 'text-ink-muted hover:text-ink' : 'text-ink-faint/60 hover:text-ink-muted'
              }`}
            >
              {carry ? <Link2 size={screen(13)} strokeWidth={1.75} /> : <Link2Off size={screen(13)} strokeWidth={1.75} />}
            </button>}
            {selected && !isViewerMode && (
              <>
                {/* fixed palette — color is wayfinding, not decoration; hidden on
                    the deepest zoom, where the scaled row would spill over
                    neighboring frames (recoloring is close-up work anyway) */}
                {barScale <= 2.5 && (
                  <div className="flex items-center gap-1 shrink-0 nodrag">
                    {Object.entries(FRAME_COLORS).map(([name, c]) => (
                      <button
                        key={name}
                        onClick={(e) => { e.stopPropagation(); useStore.getState().pushHistory(); patch({ frameColor: name }); useStore.getState().pushHistory(); }}
                        style={{ width: screen(14), height: screen(14) }}
                        className={`rounded-full ${c.dot} transition-transform hover:scale-125 ${
                          (data.frameColor ?? 'gray') === name ? 'ring-2 ring-offset-1 ring-ink/40' : ''
                        }`}
                      />
                    ))}
                  </div>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteNode(id); }}
                  style={{ width: screen(24), height: screen(24) }}
                  className="text-ink-faint hover:text-red-500 rounded-full flex items-center justify-center transition-colors shrink-0 nodrag"
                >
                  <Trash2 size={screen(13)} strokeWidth={1.75} />
                </button>
              </>
            )}
          </div>
          {/* Body: just a region — clicks select the frame, nodes float above it */}
          <div className="flex-1 nodrag" />
          {/* Edge strips: the border is a drag handle too, so a large frame can
              be moved without reaching its title bar. Rendered BEFORE the
              resizer so the resizer's handles win when the frame is selected. */}
          <div className="drag-handle absolute inset-x-0 bottom-0 h-2.5 cursor-grab active:cursor-grabbing" />
          <div className="drag-handle absolute inset-y-0 left-0 w-2.5 cursor-grab active:cursor-grabbing" />
          <div className="drag-handle absolute inset-y-0 right-0 w-2.5 cursor-grab active:cursor-grabbing" />
        </>
      )}
      {/* resize handles: NO manual scaling — React Flow's autoScale already
          counter-scales them (Math.max(1/zoom, 1)), so they keep a constant
          screen size; scaling here again would compound to huge squares.
          A folded frame has no body to resize. */}
      <NodeResizer isVisible={selected && !isViewerMode && !collapsed} minWidth={280} minHeight={180} onResizeStart={recordStep} onResizeEnd={recordStep} lineClassName="!border-accent/40" handleClassName="!bg-accent !w-2.5 !h-2.5 !rounded-sm" />
    </div>
  );
}
