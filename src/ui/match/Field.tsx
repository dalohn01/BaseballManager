import { memo } from 'react';
import type { Club } from '../../domain/types';
import type { ActorFrame, Frame } from '../../presentation/frame';
import { BASES, BATTER_BOX, MOUND, toView, VIEW, type Pt } from '../../presentation/fieldConfig';

/*
 * Field rendering in layers: static field (memoised), players sorted by feet
 * y-position, then the ball. Everything uses the logical coordinates from
 * fieldConfig via `toView`, so the scene scales as one unit. Graphics are
 * drawn in code and can later be swapped for delivered assets.
 */

const HOME = toView(BASES.home);
const FIRST = toView(BASES.first);
const SECOND = toView(BASES.second);
const THIRD = toView(BASES.third);
const MOUND_V = toView(MOUND);
const FENCE_R = 590;

const arcPoint = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: HOME.x + Math.sin(a) * r, y: HOME.y - Math.cos(a) * r };
};

function fanPath(r0: number, r1: number, from = -56, to = 56): string {
  const a = arcPoint(from, r0);
  const b = arcPoint(to, r0);
  const c = arcPoint(to, r1);
  const d = arcPoint(from, r1);
  return `M${a.x} ${a.y} A${r0} ${r0} 0 0 1 ${b.x} ${b.y} L${c.x} ${c.y} A${r1} ${r1} 0 0 0 ${d.x} ${d.y} Z`;
}

/** Deterministic crowd dots in the stands (no randomness at render time). */
const CROWD = Array.from({ length: 150 }, (_, i) => {
  const deg = -54 + ((i * 37) % 108) + ((i * 13) % 7) * 0.3;
  const r = FENCE_R + 16 + ((i * 29) % 40);
  const p = arcPoint(deg, r);
  return { ...p, c: ['#e0262c', '#0f2a5c', '#f2b01e', '#ffffff', '#2f6fe4', '#7a1f2b'][i % 6] };
});

export const FieldBackground = memo(function FieldBackground() {
  const lineL = arcPoint(-45, FENCE_R);
  const lineR = arcPoint(45, FENCE_R);
  const infieldR = 250;
  return (
    <g aria-hidden="true">
      <defs>
        <clipPath id="fair-clip">
          <path d={`M${HOME.x} ${HOME.y} L${lineL.x} ${lineL.y} A${FENCE_R} ${FENCE_R} 0 0 1 ${lineR.x} ${lineR.y} Z`} />
        </clipPath>
      </defs>
      <rect width={VIEW.width} height={VIEW.height} fill="#57a957" />
      {/* Mowing stripes */}
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={i * 90 - 40} y={0} width={45} height={VIEW.height} fill="#5fb35f" transform={`rotate(-12 500 360)`} />
      ))}
      {/* Stands and fence */}
      <path d={fanPath(FENCE_R + 10, FENCE_R + 70, -58, 58)} fill="#c9d3df" />
      {CROWD.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={4.2} fill={c.c} opacity={0.85} />
      ))}
      <path d={fanPath(FENCE_R - 22, FENCE_R, -52, 52)} fill="#b5895f" opacity={0.8} />
      <path d={`M${arcPoint(-52, FENCE_R).x} ${arcPoint(-52, FENCE_R).y} A${FENCE_R} ${FENCE_R} 0 0 1 ${arcPoint(52, FENCE_R).x} ${arcPoint(52, FENCE_R).y}`} stroke="#1d4d32" strokeWidth={9} fill="none" />
      {/* Infield dirt and grass diamond */}
      <g clipPath="url(#fair-clip)">
        <circle cx={MOUND_V.x} cy={MOUND_V.y - 20} r={infieldR} fill="#d7a16b" />
      </g>
      <polygon points={`${HOME.x},${HOME.y - 34} ${FIRST.x - 30},${FIRST.y} ${SECOND.x},${SECOND.y + 32} ${THIRD.x + 30},${THIRD.y}`} fill="#5fb35f" />
      <circle cx={HOME.x} cy={HOME.y} r={48} fill="#d7a16b" />
      <circle cx={MOUND_V.x} cy={MOUND_V.y} r={26} fill="#cf955c" stroke="#bf8550" strokeWidth={2} />
      <rect x={MOUND_V.x - 9} y={MOUND_V.y - 2} width={18} height={4} fill="#fff" />
      {/* Foul lines and base paths */}
      <line x1={HOME.x} y1={HOME.y} x2={lineL.x} y2={lineL.y} stroke="#fff" strokeWidth={3} />
      <line x1={HOME.x} y1={HOME.y} x2={lineR.x} y2={lineR.y} stroke="#fff" strokeWidth={3} />
      <polyline points={`${FIRST.x},${FIRST.y} ${SECOND.x},${SECOND.y} ${THIRD.x},${THIRD.y}`} stroke="#f3e2c8" strokeWidth={2} fill="none" opacity={0.7} />
      {/* Batter's boxes */}
      {[BATTER_BOX.left, BATTER_BOX.right].map((b, i) => {
        const v = toView(b);
        return <rect key={i} x={v.x - 11} y={v.y - 20} width={22} height={36} fill="none" stroke="#fff" strokeWidth={2} opacity={0.85} />;
      })}
      {/* Bases */}
      {[FIRST, SECOND, THIRD].map((b, i) => (
        <rect key={i} x={b.x - 8} y={b.y - 8} width={16} height={16} fill="#fff" stroke="#c9b38f" transform={`rotate(45 ${b.x} ${b.y})`} />
      ))}
      <path d={`M${HOME.x - 9} ${HOME.y - 6} h18 v6 l-9 8 l-9 -8 z`} fill="#fff" stroke="#c9b38f" />
    </g>
  );
});

export interface Kit {
  jersey: string;
  trim: string;
  cap: string;
  pants: string;
}

/** Home team wears white with club trim, visitors wear the club colour: always distinguishable. */
export function kitFor(club: Club, isHome: boolean): Kit {
  return isHome
    ? { jersey: '#f7f9fc', trim: club.colors.primary, cap: club.colors.primary, pants: '#e4e9f0' }
    : { jersey: club.colors.primary, trim: club.colors.secondary, cap: club.colors.primary, pants: '#d9dee6' };
}

const SKIN = ['#f1c7a5', '#e0ac85', '#c98e67', '#a86f4c', '#7d4f33', '#f5d5bb'];
const skinOf = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return SKIN[Math.abs(h) % SKIN.length];
};

/** Simple code-drawn baseball player. Anchor is at the feet so poses never move the logical position. */
export function PlayerSprite({ a, kit, t, withBat, highlighted, ring }: { a: ActorFrame; kit: Kit; t: number; withBat: boolean; highlighted: boolean; ring: string }) {
  const { x, y } = toView(a.pos);
  const stride = a.pose === 'run' ? (Math.floor(t / 110) % 2 ? 5 : -5) : 0;
  const skin = skinOf(a.id);
  const arms: Record<string, string> = {
    ready: 'M-9 -29 L-14 -19 M9 -29 L14 -19',
    run: `M-9 -29 L${-13 - stride / 2} -20 M9 -29 L${13 + stride / 2} -20`,
    pitch: 'M-9 -29 L-15 -22 M9 -29 L16 -44',
    throw: 'M-9 -29 L-15 -22 M9 -29 L22 -32',
    catch: 'M-9 -29 L-16 -40 M9 -29 L14 -20',
    swing: 'M-9 -29 L6 -28 M9 -29 L14 -26',
    cheer: 'M-9 -29 L-15 -46 M9 -29 L15 -46',
  };
  return (
    <g transform={`translate(${x} ${y})`} opacity={a.opacity}>
      {highlighted && <ellipse cx={0} cy={0} rx={19} ry={7} fill="none" stroke={ring} strokeWidth={2.5} opacity={0.9} />}
      <ellipse cx={0} cy={0} rx={12} ry={4} fill="rgba(0,0,0,0.28)" />
      <g transform={`scale(${a.facing} 1)`}>
        <path d={`M-4 -15 L${-5 + stride} 0 M4 -15 L${5 - stride} 0`} stroke={kit.pants} strokeWidth={5.5} strokeLinecap="round" />
        <path d={`M-4 -15 L${-5 + stride} 0 M4 -15 L${5 - stride} 0`} stroke="rgba(0,0,0,0.15)" strokeWidth={1} strokeLinecap="round" />
        <rect x={-10} y={-34} width={20} height={21} rx={7} fill={kit.jersey} stroke={kit.trim} strokeWidth={2.2} />
        <path d={arms[a.pose] ?? arms.ready} stroke={skin} strokeWidth={4.5} strokeLinecap="round" />
        {a.pose === 'catch' && <circle cx={-16} cy={-42} r={4.5} fill="#8a5a33" />}
        {withBat && (
          <line
            x1={a.pose === 'swing' ? 8 : 10}
            y1={a.pose === 'swing' ? -28 : -30}
            x2={a.pose === 'swing' ? 36 : 20}
            y2={a.pose === 'swing' ? -24 : -58}
            stroke="#b07a45"
            strokeWidth={4}
            strokeLinecap="round"
          />
        )}
        <circle cx={0} cy={-41} r={7.5} fill={skin} />
        <path d="M-7.5 -42 a7.5 7.5 0 0 1 15 0 z" fill={kit.cap} />
        <rect x={0} y={-43.5} width={11} height={3} rx={1.5} fill={kit.cap} />
      </g>
    </g>
  );
}

export function BallSprite({ ball }: { ball: NonNullable<Frame['ball']> }) {
  const g: Pt = toView(ball.pos);
  const shadowScale = Math.max(0.4, 1 - ball.height / 300);
  return (
    <g aria-hidden="true">
      <ellipse cx={g.x} cy={g.y} rx={6 * shadowScale} ry={2.5 * shadowScale} fill="rgba(0,0,0,0.3)" />
      <circle cx={g.x} cy={g.y - ball.height} r={5.5} fill="#ffffff" stroke="#3a3a3a" strokeWidth={1.4} />
    </g>
  );
}
