import type { KeyboardEvent, MouseEvent } from 'react';
import { playerName } from '../../domain/state';
import type { Club, Player } from '../../domain/types';
import { href, useGame } from '../hooks';
import { Avatar } from './art';

/**
 * A player portrait that opens the player's profile. Inside another
 * interactive element (a selectable card or a draggable row) a link would be
 * nested in a button, so there it is a keyboard-focusable span that stops the
 * click from also selecting the card. Players who are not in the game (e.g.
 * draft candidates) render as a plain portrait.
 */
export function PlayerAvatar({ player, club, size, nested = false }: { player: Player; club: Club; size?: number; nested?: boolean }) {
  const s = useGame();
  if (!s.players[player.id]) return <Avatar player={player} club={club} size={size} />;
  const label = `Open ${playerName(player)}'s profile`;
  const target = href(`team/${player.id}`);
  if (!nested) {
    return (
      <a className="avatar-link" href={target} aria-label={label} title={label}>
        <Avatar player={player} club={club} size={size} />
      </a>
    );
  }
  const open = (e: MouseEvent | KeyboardEvent) => {
    e.stopPropagation();
    e.preventDefault();
    location.hash = target;
  };
  return (
    <span
      className="avatar-link"
      role="link"
      tabIndex={0}
      aria-label={label}
      title={label}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') open(e);
      }}
    >
      <Avatar player={player} club={club} size={size} />
    </span>
  );
}
