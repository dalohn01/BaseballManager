import { describe, expect, it } from 'vitest';
import { optionBlocker } from '../src/application/engine';
import { validateLineup } from '../src/domain/lineup';
import { createRng } from '../src/domain/rng';
import { squadProblem } from '../src/domain/roster';
import type { GameState } from '../src/domain/state';
import { newGame, run, T0 } from './helpers';

/**
 * Stability, not balance: long random careers must never reach a state with
 * no feasible choice, a squad that cannot play, or cash that stays negative
 * without the game offering a way out.
 */
describe('long careers', () => {
  it('20 careers × 4 seasons: no empty choices, no invalid squads, no cash lock', () => {
    for (let seed = 900; seed < 920; seed++) {
      let s: GameState = newGame(seed);
      const rng = createRng(seed);
      let negativeRounds = 0;
      let lastRound = -1;
      for (let i = 0; i < 2000 && s.calendar.season <= 4; i++) {
        const ev = s.currentEvent!;
        expect(ev, `seed ${seed}: no current event`).toBeTruthy();
        const avail = ev.options.filter((o) => optionBlocker(s, ev, o, null, T0) === null);
        expect(avail.length, `seed ${seed}: no feasible option in ${ev.templateId} (S${ev.season} R${ev.round})`).toBeGreaterThan(0);
        // A free base choice always exists (Influence/Cash only as optional extras).
        expect(ev.options.some((o) => o.cost.cash === 0 && o.cost.influence === 0), ev.templateId).toBe(true);
        const opt = rng.pick(avail);
        s = run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: opt.id, boostId: null });
        s = run(s, { type: 'acknowledgeEvent', eventId: ev.id });

        const abs = s.calendar.season * 100 + s.calendar.round;
        if (abs !== lastRound) {
          lastRound = abs;
          negativeRounds = s.clubs.hfx.cash < 0 ? negativeRounds + 1 : 0;
          // Recovery events must pull the club out within a few rounds.
          expect(negativeRounds, `seed ${seed}: cash negative for too long`).toBeLessThanOrEqual(6);
        }
      }
      expect(s.calendar.season, `seed ${seed} did not reach season 5`).toBe(5);
      for (const id of s.clubOrder) {
        expect(squadProblem(s, s.clubs[id].roster)).toBeNull();
        expect(validateLineup(s, id, s.clubs[id].lineup).filter((x) => x.severity === 'error')).toEqual([]);
      }
      // Save size stays reasonable over many seasons.
      expect(JSON.stringify(s).length).toBeLessThan(3_000_000);
    }
  }, 600_000);
});
