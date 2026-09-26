import type { ClubId, PlayerId } from '../domain/types';
import type { ActorPlan, DisplayState, Pose, Presentation, Seg } from './adapter';
import type { Pt } from './fieldConfig';

export interface ActorFrame {
  id: PlayerId;
  clubId: ClubId;
  role: 'offense' | 'defense';
  pos: Pt;
  pose: Pose;
  opacity: number;
  /** Horizontal facing: −1 = left, 1 = right. */
  facing: 1 | -1;
}

export interface Frame {
  actors: ActorFrame[];
  ball: { pos: Pt; height: number } | null;
  labels: PlayerId[];
  call: string | null;
  state: DisplayState;
  commentary: string;
  resultShown: boolean;
}

const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

function positionAt(a: ActorPlan, t: number): { pos: Pt; moving: Seg | null } {
  let pos = a.start;
  for (const s of a.segments) {
    if (t < s.t0) break;
    if (t <= s.t1) return { pos: lerp(s.from, s.to, s.t1 === s.t0 ? 1 : (t - s.t0) / (s.t1 - s.t0)), moving: s };
    pos = s.to;
  }
  return { pos, moving: null };
}

/**
 * Pure: the visible scene of a presentation at playhead `t` (ms). Rendering a
 * given moment never depends on what was rendered before, so seeking, resizing
 * or resuming always shows the same thing.
 */
export function frameAt(p: Presentation, t: number): Frame {
  const actors: ActorFrame[] = p.actors.map((a) => {
    const { pos, moving } = positionAt(a, t);
    const span = a.poses.filter((ps) => t >= ps.t0 && t <= ps.t1).pop();
    const pose: Pose = span?.pose ?? (moving ? 'run' : 'ready');
    let opacity = 1;
    if (a.fadeInAt !== undefined) opacity = clamp01((t - a.fadeInAt) / 250);
    if (a.fadeOutAt !== undefined && t > a.fadeOutAt) opacity = Math.min(opacity, clamp01(1 - (t - a.fadeOutAt) / 350));
    const dx = moving ? moving.to.x - moving.from.x : 0;
    const facing: 1 | -1 = dx < -0.001 ? -1 : 1;
    return { id: a.id, clubId: a.clubId, role: a.role, pos, pose, opacity, facing };
  });

  let ball: Frame['ball'] = null;
  if (p.ball.length && t >= p.ball[0].t0 && t <= p.ballHideAt) {
    const seg = p.ball.find((b) => t >= b.t0 && t <= b.t1);
    if (seg) {
      const u = seg.t1 === seg.t0 ? 1 : (t - seg.t0) / (seg.t1 - seg.t0);
      ball = { pos: lerp(seg.from, seg.to, u), height: seg.peak * 4 * u * (1 - u) };
    } else {
      // Between segments or after the last one: the ball rests where it last arrived.
      const prev = [...p.ball].filter((b) => b.t1 <= t).pop();
      if (prev) ball = { pos: prev.to, height: 0 };
    }
  }

  const labels: PlayerId[] = [];
  for (const l of p.labels) {
    if (t < l.t0 || t > l.t1) continue;
    for (const id of l.ids) if (!labels.includes(id)) labels.push(id);
  }
  // Only name players who are actually visible, at most three.
  const visible = new Set(actors.filter((a) => a.opacity > 0.2).map((a) => a.id));

  let state = p.updates[0].state;
  for (const u of p.updates) if (u.t <= t) state = u.state;

  const resultShown = t >= p.resultAt;
  return {
    actors,
    ball,
    labels: labels.filter((id) => visible.has(id)).slice(0, 3),
    call: [...p.calls].filter((c) => c.t <= t).pop()?.text || null,
    state,
    commentary: resultShown ? p.commentaryAfter : p.commentaryBefore,
    resultShown,
  };
}
