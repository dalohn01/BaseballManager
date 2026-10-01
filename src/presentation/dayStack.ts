import { folderTitle } from '../application/engine';
import type { EventInstance, GameState, QueuedSlot } from '../domain/state';
import { SLOT_LABELS } from '../events/planner';

/*
 * Today's events as folders: the current event in front, the rest of the day
 * behind it in order, and exactly one Day complete last. A pure view of the
 * saved queue: building it never plans, builds or changes anything.
 */

export type FolderKind = 'current' | 'built' | 'planned' | 'dayComplete';

export interface Folder {
  /** Stable key: the event id when it exists, otherwise its place in today's queue. */
  key: string;
  kind: FolderKind;
  /** 1-based position in today's order (handled events count too). */
  number: number;
  title: string;
  /** Up next (directly behind the current event). */
  next: boolean;
  /** Already built (the next event is prepared when the current one is decided). */
  event?: EventInstance;
  slot?: QueuedSlot;
}

export interface DayStack {
  folders: Folder[];
  /** Regular events handled today and today's total (Day complete is not counted). */
  handled: number;
  total: number;
}

const slotTitle = (q: QueuedSlot) => (q.kind === 'match' ? 'League game' : SLOT_LABELS[q.templateId] ?? 'Club event');

export function dayStack(state: GameState): DayStack {
  const log = state.dayLog ?? [];
  const cur = state.currentEvent;
  const folders: Folder[] = [];
  let n = log.length;
  if (cur) folders.push({ key: cur.id, kind: 'current', number: ++n, title: folderTitle(cur), next: false, event: cur });
  if (state.nextEvent) folders.push({ key: state.nextEvent.id, kind: 'built', number: ++n, title: folderTitle(state.nextEvent), next: false, event: state.nextEvent });
  state.queue.forEach((q, i) => folders.push({ key: `slot-${i}-${q.templateId}`, kind: 'planned', number: ++n, title: slotTitle(q), next: false, slot: q }));
  const total = n;
  folders.push({ key: 'day-complete', kind: 'dayComplete', number: n + 1, title: 'Day complete', next: false });
  // The folder directly behind the current one is "up next".
  if (folders.length > 1 && folders[0].kind === 'current') folders[1].next = true;
  const handled = log.length + (cur && cur.status !== 'pending' ? 1 : 0);
  return { folders, handled, total };
}

/** What a later folder may show before it is reached: only what is already known. */
export function previewText(f: Folder): string {
  if (f.kind === 'built' && f.event) return f.event.context;
  if (f.kind === 'planned' && f.slot) {
    if (f.slot.kind === 'match') return 'Set your lineup and play the league game. The details come with the pre-match screen.';
    if (f.slot.kind === 'media') return 'The press will want a word after the game. What they ask depends on how it goes.';
    return 'Prepared when it comes up: what happens first today can change it.';
  }
  return '';
}
