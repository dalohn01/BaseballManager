import type { FieldSpot, MatchResult, PlayerId } from '../../domain/types';
import type { ShownState } from '../../presentation/commentary';
import { useGame } from '../hooks';

/*
 * Schematic field: bases, defensive positions and runner markers only — no
 * ball flight or running animation. Everything comes from the presented step
 * state. Defense = circles with the position; offense = squares with an
 * initial. Only the pitcher, the batter, runners and the scorer are named.
 */

type P = { x: number; y: number };
const HOME: P = { x: 200, y: 318 };
const BASES: P[] = [
  { x: 292, y: 226 },
  { x: 200, y: 134 },
  { x: 108, y: 226 },
];
const SPOTS: Record<Exclude<FieldSpot, 'DH'>, P> = {
  P: { x: 200, y: 230 },
  C: { x: 200, y: 346 },
  '1B': { x: 300, y: 192 },
  '2B': { x: 254, y: 150 },
  SS: { x: 146, y: 150 },
  '3B': { x: 100, y: 192 },
  LF: { x: 90, y: 92 },
  CF: { x: 200, y: 52 },
  RF: { x: 310, y: 92 },
};

function Tag({ x, y, text, sub, anchor = 'middle', tone = 'plain' }: { x: number; y: number; text: string; sub?: string; anchor?: 'start' | 'middle' | 'end'; tone?: 'plain' | 'dim' | 'score' }) {
  const width = Math.max(text.length * 6.6, sub ? sub.length * 5.8 : 0) + 14;
  const height = sub ? 30 : 18;
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'start' ? x : x - width;
  const clampedLeft = Math.max(2, Math.min(398 - width, left));
  return (
    <g className={`sf-tag sf-tag-${tone}`}>
      <rect x={clampedLeft} y={y} width={width} height={height} rx={5} />
      <text x={clampedLeft + 7} y={y + 13}>
        {text}
      </text>
      {sub && (
        <text x={clampedLeft + 7} y={y + 25} className="sf-sub">
          {sub}
        </text>
      )}
    </g>
  );
}

export function SchematicField({ match, state, focus, reduced }: { match: MatchResult; state: ShownState; focus: PlayerId | null; reduced: boolean }) {
  const s = useGame();
  const offenseId = state.battingClubId;
  const defenseId = offenseId === match.homeId ? match.awayId : match.homeId;
  const defSide = defenseId === match.homeId ? 'home' : 'away';
  const off = s.clubs[offenseId];
  const def = s.clubs[defenseId];
  const last = (id: PlayerId) => s.players[id]?.lastName ?? '?';

  const defenders: { spot: Exclude<FieldSpot, 'DH'>; id: PlayerId }[] = [];
  for (const slot of match.lineups[defSide].battingOrder) if (slot.position !== 'DH') defenders.push({ spot: slot.position as Exclude<FieldSpot, 'DH'>, id: slot.playerId });
  defenders.push({ spot: 'P', id: state.pitcherId });

  const runner = (id: PlayerId, at: P, dim: boolean) => (
    <g key={id} className={`sf-runner ${dim ? 'dim' : ''} ${focus === id ? 'focus' : ''}`}>
      {focus === id && <circle cx={at.x} cy={at.y} r={19} className={`sf-ring ${reduced ? '' : 'pulse'}`} />}
      <rect x={at.x - 11} y={at.y - 11} width={22} height={22} rx={5} fill="#fff" stroke={off.colors.primary} strokeWidth={3} strokeDasharray={dim ? '4 3' : undefined} />
      <text x={at.x} y={at.y + 4.5} className="sf-initial" fill={off.colors.primary}>
        {last(id)[0]}
      </text>
    </g>
  );

  const runnerTags = state.bases.map((id, i) => {
    if (!id) return null;
    const dim = state.advancing.includes(id);
    const b = BASES[i];
    const sub = dim ? 'Advancing…' : undefined;
    if (i === 0) return <Tag key={id} x={b.x + 16} y={b.y - 9} text={last(id)} sub={sub} anchor="start" tone={dim ? 'dim' : 'plain'} />;
    if (i === 2) return <Tag key={id} x={b.x - 16} y={b.y - 9} text={last(id)} sub={sub} anchor="end" tone={dim ? 'dim' : 'plain'} />;
    return <Tag key={id} x={b.x} y={b.y - 44} text={last(id)} sub={sub} tone={dim ? 'dim' : 'plain'} />;
  });

  const baseLabel = ['first', 'second', 'third'];
  const onBase = state.bases.map((id, i) => (id ? `${last(id)} on ${baseLabel[i]}${state.advancing.includes(id) ? ' (advancing)' : ''}` : null)).filter(Boolean);
  const aria = [`${def.name} in the field, ${s.players[state.pitcherId]?.lastName ?? ''} pitching`, state.batterId ? `${last(state.batterId)} at bat` : null, onBase.length ? onBase.join(', ') : 'bases empty', state.scoredId ? `${last(state.scoredId)} just scored` : null]
    .filter(Boolean)
    .join('. ');

  return (
    <div className="schematic">
      <svg viewBox="0 0 400 372" role="img" aria-label={aria}>
        <path d="M200 318 L18 136 A258 258 0 0 1 382 136 Z" className="sf-grass" />
        <path d="M200 318 L292 226 L200 134 L108 226 Z" className="sf-dirt" />
        <path d="M200 300 L274 226 L200 152 L126 226 Z" className="sf-infield" />
        <line x1={200} y1={318} x2={18} y2={136} className="sf-line" />
        <line x1={200} y1={318} x2={382} y2={136} className="sf-line" />
        {BASES.map((b, i) => (
          <rect key={i} x={b.x - 7} y={b.y - 7} width={14} height={14} transform={`rotate(45 ${b.x} ${b.y})`} className={`sf-base ${state.bases[i] ? 'on' : ''}`} />
        ))}
        <path d={`M${HOME.x - 8} ${HOME.y - 6} h16 v6 l-8 7 l-8 -7z`} className="sf-plate" />

        {defenders.map(({ spot, id }) => {
          const at = SPOTS[spot];
          return (
            <g key={spot} className={`sf-def ${focus === id ? 'focus' : ''}`}>
              {focus === id && <circle cx={at.x} cy={at.y} r={18} className={`sf-ring ${reduced ? '' : 'pulse'}`} />}
              <circle cx={at.x} cy={at.y} r={12.5} fill={def.colors.primary} stroke={def.colors.secondary} strokeWidth={2.5} />
              <text x={at.x} y={at.y + 4} className="sf-pos">
                {spot}
              </text>
            </g>
          );
        })}
        <Tag x={SPOTS.P.x} y={SPOTS.P.y + 15} text={last(state.pitcherId)} />

        {state.bases.map((id, i) => (id ? runner(id, BASES[i], state.advancing.includes(id)) : null))}
        {state.batterId && runner(state.batterId, { x: HOME.x - 24, y: HOME.y - 4 }, false)}
        {state.scoredId && (
          <g className="sf-scored">
            <circle cx={HOME.x} cy={HOME.y} r={20} className={`sf-ring score ${reduced ? '' : 'pulse'}`} />
          </g>
        )}
        {runnerTags}
        {state.batterId && <Tag x={HOME.x - 38} y={HOME.y - 14} text={last(state.batterId)} sub="At bat" anchor="end" />}
        {state.scoredId && <Tag x={HOME.x + 24} y={HOME.y - 14} text={last(state.scoredId)} sub="Scored · +1" anchor="start" tone="score" />}
      </svg>
      <p className="sf-legend small">
        <span>
          <i className="sf-key circle" style={{ background: def.colors.primary }} aria-hidden="true" /> {def.name} · fielding
        </span>
        <span>
          <i className="sf-key square" style={{ borderColor: off.colors.primary }} aria-hidden="true" /> {off.name} · batting
        </span>
      </p>
    </div>
  );
}
