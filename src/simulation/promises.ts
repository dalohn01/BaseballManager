import { applyReaction } from './reactions';
import { BALANCE } from '../balance/config';
import type { EffectSink } from '../domain/effects';
import type { EventInstance, GameState, PromiseRecord } from '../domain/state';
import { absoluteRound, nextId, playerName } from '../domain/state';
import type { PlayerId } from '../domain/types';

/** Creates a "N starts in the next M games" promise; the current round's game is the first that counts. */
export function makeStartsPromise(state: GameState, ev: EventInstance, playerId: PlayerId, rivalId: PlayerId | null): PromiseRecord {
  const cfg = BALANCE.promises;
  const { season, round } = state.calendar;
  const from = absoluteRound(season, Math.max(1, round));
  const pr: PromiseRecord = {
    id: nextId(state, 'promise'),
    kind: 'starts',
    playerId,
    rivalId,
    threshold: cfg.startsThreshold,
    fromRound: from,
    toRound: Math.min(from + cfg.windowGames - 1, absoluteRound(season, BALANCE.season.rounds)),
    originEventId: ev.id,
    originTitle: ev.title,
    madeAt: { season, round },
    status: 'active',
    progress: 0,
    closedAt: null,
    closeReason: null,
  };
  state.promises.push(pr);
  return pr;
}

/** A starts promise needs enough games left in the season. */
export const canPromiseStarts = (state: GameState) =>
  state.calendar.phase === 'regular' && state.calendar.round <= BALANCE.season.rounds - BALANCE.promises.windowGames + 1;

/** Actual starts in the promise window, read from stored match lineups. */
export function startsInWindow(state: GameState, pr: PromiseRecord): number {
  let n = 0;
  for (const m of Object.values(state.matches)) {
    const abs = absoluteRound(m.season, m.round);
    if (abs < pr.fromRound || abs > pr.toRound) continue;
    const side = m.homeId === state.userClubId ? 'home' : m.awayId === state.userClubId ? 'away' : null;
    if (!side) continue;
    const l = m.lineups[side];
    if (l.pitcherId === pr.playerId || l.battingOrder.some((s) => s.playerId === pr.playerId)) n++;
  }
  return n;
}

/**
 * Runs after each user league game. Closes promises that are kept, broken or
 * impossible, applies the consequence and schedules a follow-up event.
 */
export function evaluatePromises(state: GameState, sink: EffectSink): string[] {
  const cfg = BALANCE.promises;
  const { season, round } = state.calendar;
  const now = absoluteRound(season, round);
  const notes: string[] = [];
  for (const pr of state.promises.filter((p) => p.status === 'active')) {
    const p = state.players[pr.playerId];
    const close = (status: PromiseRecord['status'], reason: string) => {
      pr.status = status;
      pr.closedAt = { season, round };
      pr.closeReason = reason;
      if (status !== 'void') {
        state.followUps.push({
          id: nextId(state, 'fu'),
          templateId: 'promise_followup',
          dueRound: now + 1,
          originEventId: pr.originEventId,
          data: { promiseId: pr.id },
        });
      }
    };
    if (!p || p.clubId !== state.userClubId) {
      close('void', 'He left the club before the promise could be judged.');
      notes.push(`Promise to ${p ? playerName(p) : 'a former player'} lapsed: he left the club.`);
      continue;
    }
    pr.progress = startsInWindow(state, pr);
    const remaining = Math.max(0, pr.toRound - now);
    if (pr.progress >= pr.threshold) {
      close('kept', `${pr.progress} starts in the window.`);
      applyReaction(state, sink, p.id, 'promise_kept', cfg.kept, `Promise kept: ${pr.progress} starts as promised in round ${pr.madeAt.round}`, `${pr.id}:kept`);
      notes.push(`Promise kept: ${playerName(p)} has started ${pr.progress} of the promised ${pr.threshold} games.`);
    } else if (pr.progress + remaining < pr.threshold) {
      close('broken', `Only ${pr.progress} of ${pr.threshold} promised starts.`);
      applyReaction(state, sink, p.id, 'broken_promise', cfg.broken, `Promise broken: ${pr.progress} of ${pr.threshold} promised starts (round ${pr.madeAt.round})`, `${pr.id}:broken`);
      if (p.popularity >= 60) sink.clubMood(state.userClubId, 'fanSupport', cfg.brokenPopularPlayerFans, `Broke a promise to ${p.lastName}`);
      notes.push(`Promise broken: ${playerName(p)} started only ${pr.progress} of the promised ${pr.threshold} games.`);
    }
  }
  return notes;
}
