import { clamp } from './rng';
import type { EffectRecord, GameState, LedgerCategory } from './state';
import { clubName, playerName } from './state';
import type { ClubId, PlayerId, ReasonEntry } from './types';

const MAX_REASONS = 8;

/**
 * Collects before/after records while an event or match is applied, so the
 * result view shows actual changes and the history can store them.
 */
export class EffectSink {
  readonly records: EffectRecord[] = [];
  constructor(
    private readonly state: GameState,
    private readonly eventId: string | null,
  ) {}

  private get when() {
    return { season: this.state.calendar.season, round: this.state.calendar.round };
  }

  private pushReason(list: ReasonEntry[], delta: number, text: string) {
    list.unshift({ ...this.when, delta, text });
    if (list.length > MAX_REASONS) list.length = MAX_REASONS;
  }

  record(r: EffectRecord) {
    if (r.before !== r.after) this.records.push(r);
  }

  playerMood(
    playerId: PlayerId,
    stat: 'satisfaction' | 'fitness' | 'popularity',
    delta: number,
    reason: string,
    opts: { record?: boolean } = {},
  ): number {
    const p = this.state.players[playerId];
    const before = p[stat];
    const after = clamp(Math.round(before + delta), 0, 100);
    p[stat] = after;
    if (stat === 'satisfaction' && after !== before) this.pushReason(p.moodLog, after - before, reason);
    if (opts.record !== false) {
      this.record({
        targetKind: 'player',
        targetId: playerId,
        targetLabel: playerName(p),
        stat,
        statLabel: STAT_LABELS[stat],
        before,
        after,
      });
    }
    return after - before;
  }

  clubMood(clubId: ClubId, stat: 'fanSupport' | 'ownerConfidence', delta: number, reason: string) {
    const c = this.state.clubs[clubId];
    const before = c[stat];
    const after = clamp(Math.round(before + delta), 0, 100);
    c[stat] = after;
    if (after !== before) this.pushReason(c.reasons[stat], after - before, reason);
    if (c.isUser) {
      this.record({
        targetKind: 'club',
        targetId: clubId,
        targetLabel: stat === 'fanSupport' ? 'Fans' : 'Owners',
        stat,
        statLabel: STAT_LABELS[stat],
        before,
        after,
      });
    }
  }

  brand(clubId: ClubId, key: 'local' | 'commercial', delta: number) {
    const c = this.state.clubs[clubId];
    const before = c.brand[key];
    c.brand[key] = clamp(before + delta, 0, 100);
    this.record({
      targetKind: 'club',
      targetId: clubId,
      targetLabel: clubName(c),
      stat: `brand.${key}`,
      statLabel: key === 'local' ? 'Local roots' : 'Commercial reach',
      before,
      after: c.brand[key],
    });
  }

  cash(clubId: ClubId, amount: number, category: LedgerCategory, note: string) {
    const c = this.state.clubs[clubId];
    const before = c.cash;
    c.cash += amount;
    if (!c.isUser) return;
    this.state.ledger.push({
      id: this.state.ledger.length + 1,
      season: this.state.calendar.season,
      round: this.state.calendar.round,
      category,
      amount,
      note,
      eventId: this.eventId,
      balanceAfter: c.cash,
    });
    this.record({
      targetKind: 'resource',
      targetId: 'cash',
      targetLabel: note,
      stat: 'cash',
      statLabel: 'Club Cash',
      before,
      after: c.cash,
      format: 'cash',
    });
  }
}

export const STAT_LABELS: Record<string, string> = {
  satisfaction: 'Happiness',
  fitness: 'Fitness',
  /** Kept so effects recorded before the fitness change still read correctly. */
  fatigue: 'Fatigue',
  popularity: 'Popularity',
  fanSupport: 'Fan support',
  ownerConfidence: 'Owner confidence',
  contact: 'Contact',
  power: 'Power',
  speed: 'Speed',
  fielding: 'Fielding',
  pitching: 'Pitching',
  influence: 'Influence',
  time: 'Time',
  cash: 'Club Cash',
  ticketPriceLevel: 'Ticket price level',
};
