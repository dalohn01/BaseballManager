import { PlayerAvatar } from '../components/PlayerAvatar';
import type { StatusNote } from '../../domain/playerStats';
import { overall } from '../../domain/ratings';
import type { GameState } from '../../domain/state';
import type { Player } from '../../domain/types';

/** Factual status notes as small chips (warnings marked with "!", never colour alone). */
export function Notes({ notes, max = 2 }: { notes: StatusNote[]; max?: number }) {
  if (notes.length === 0) return null;
  return (
    <span className="notes-row">
      {notes.slice(0, max).map((n) => (
        <span key={n.text} className={`note-chip note-${n.tone}`}>
          {n.tone === 'warn' ? '! ' : ''}
          {n.text}
        </span>
      ))}
    </span>
  );
}

export function Portrait({ state, player, size = 52, nested = false }: { state: GameState; player: Player; size?: number; nested?: boolean }) {
  return (
    <span className="portrait">
      <PlayerAvatar player={player} club={state.clubs[player.clubId] ?? state.clubs[state.userClubId]} size={size} nested={nested} />
      <span className="portrait-ovr" title="Overall rating">
        {overall(player)}
      </span>
    </span>
  );
}
