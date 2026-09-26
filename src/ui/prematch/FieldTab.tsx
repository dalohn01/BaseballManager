import { useState } from 'react';
import { BALANCE } from '../../balance/config';
import { benchSwapBlocker, setPitcherRole, suitability, swapFromBench, swapPositions } from '../../domain/lineupDraft';
import { battingStats, gamesWithoutStart, pitcherWorkload, playerNotes, pitchingStats, fmtRate, fmtEra, fmtIp } from '../../domain/playerStats';
import { overall, overallAt } from '../../domain/ratings';
import { playerName, shortName, userClub } from '../../domain/state';
import type { LineupPosition, Player, PlayerId } from '../../domain/types';
import type { DraftApi } from './PreMatchScreen';
import { FitnessMeter, HappinessMeter, hitterValues, Legend, Notes, pitcherValues, PosBadge, Portrait, Values } from './shared';

/** Card placement on the faded field (percent of the board). */
const SPOT: Record<LineupPosition | 'P', { left: number; top: number }> = {
  LF: { left: 3, top: 5 },
  CF: { left: 36, top: 1 },
  RF: { left: 69, top: 5 },
  SS: { left: 12, top: 28 },
  '2B': { left: 60, top: 28 },
  '3B': { left: 2, top: 52 },
  P: { left: 36, top: 50 },
  '1B': { left: 70, top: 52 },
  DH: { left: 2, top: 77 },
  C: { left: 36, top: 76 },
};

type Selection = { kind: 'slot'; index: number } | { kind: 'pitcher' } | null;
type Proposal = { kind: 'bench'; index: number; inId: PlayerId } | { kind: 'positions'; a: number; b: number } | { kind: 'starter'; inId: PlayerId } | null;

export function FieldTab({ api }: { api: DraftApi }) {
  const { state: s, draft, update, mode, period } = api;
  const [sel, setSel] = useState<Selection>(null);
  const [proposal, setProposal] = useState<Proposal>(null);
  const club = userClub(s);
  const order = draft.lineup.battingOrder;
  const starter = s.players[draft.lineup.pitcherId];
  const benchHitters = club.roster.map((id) => s.players[id]).filter((p) => !p.isPitcher && !order.some((x) => x.playerId === p.id));
  const benchPitchers = club.roster.map((id) => s.players[id]).filter((p) => p.isPitcher && p.id !== draft.lineup.pitcherId);
  const bench = sel?.kind === 'pitcher' ? benchPitchers : benchHitters;

  const clickSlot = (index: number) => {
    if (sel?.kind === 'slot' && sel.index !== index) {
      setProposal({ kind: 'positions', a: sel.index, b: index });
      return;
    }
    setSel(sel?.kind === 'slot' && sel.index === index ? null : { kind: 'slot', index });
    setProposal(null);
  };
  const clickBench = (id: PlayerId, index?: number) => {
    if (sel?.kind === 'pitcher') return setProposal({ kind: 'starter', inId: id });
    const target = index ?? (sel?.kind === 'slot' ? sel.index : null);
    if (target === null) {
      setProposal(null);
      return;
    }
    setSel({ kind: 'slot', index: target });
    setProposal({ kind: 'bench', index: target, inId: id });
  };
  const apply = () => {
    if (!proposal) return;
    if (proposal.kind === 'bench') update(swapFromBench(draft, proposal.index, proposal.inId));
    else if (proposal.kind === 'positions') update(swapPositions(draft, proposal.a, proposal.b));
    else update(setPitcherRole(draft, proposal.inId, 'starter'));
    setProposal(null);
    setSel(null);
  };

  return (
    <div className="pm-field-layout">
      <div className="pm-board" aria-label="Starting lineup on the field">
        <svg className="pm-board-bg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M50 98 L8 52 A60 60 0 0 1 92 52 Z" fill="#cfe4c8" />
          <path d="M50 92 L30 70 L50 48 L70 70 Z" fill="#e7cfb2" />
          <path d="M50 92 L30 70 L50 48 L70 70 Z" fill="none" stroke="#fff" strokeWidth="0.6" />
        </svg>
        {order.map((slot, i) => {
          const p = s.players[slot.playerId];
          const pos = SPOT[slot.position];
          const selected = (sel?.kind === 'slot' && sel.index === i) || (proposal?.kind === 'positions' && (proposal.a === i || proposal.b === i));
          return (
            <PositionCard
              key={slot.position}
              api={api}
              player={p}
              pos={slot.position}
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
              selected={selected}
              onClick={() => clickSlot(i)}
              onDropPlayer={(id) => clickBench(id, i)}
              battingSpot={i + 1}
            />
          );
        })}
        <PositionCard api={api} player={starter} pos="P" style={{ left: `${SPOT.P.left}%`, top: `${SPOT.P.top}%` }} selected={sel?.kind === 'pitcher'} onClick={() => { setSel(sel?.kind === 'pitcher' ? null : { kind: 'pitcher' }); setProposal(null); }} />
      </div>

      <aside className="pm-side">
        <section className="panel pm-bench">
          <header className="panel-head">
            <h2>{sel?.kind === 'pitcher' ? 'Other pitchers' : 'Bench'}</h2>
            <small className="muted">{sel ? 'Tap a player to compare' : 'Select a card, then a player — or drag a player onto a card'}</small>
          </header>
          <ul className="bench-list">
            {bench.map((p) => (
              <li key={p.id}>
                <button
                  className={`bench-item ${proposal && 'inId' in proposal && proposal.inId === p.id ? 'on' : ''}`}
                  draggable={!p.isPitcher}
                  onDragStart={(e) => e.dataTransfer.setData('text/player', p.id)}
                  onClick={() => clickBench(p.id)}
                  aria-label={`Compare ${playerName(p)}`}
                >
                  <Portrait state={s} player={p} size={44} />
                  <span className="bi-main">
                    <strong>{playerName(p)}</strong>
                    <small>{p.isPitcher ? 'P' : p.positions.join(' / ')}</small>
                    <Values vals={p.isPitcher ? pitcherValues(s, p, mode, period, true) : hitterValues(s, p, mode, period, 'field')} />
                    <Notes notes={playerNotes(s, p, { starting: false })} max={2} />
                  </span>
                  <span className="bi-status">
                    <FitnessMeter value={p.fitness} />
                    <HappinessMeter value={p.satisfaction} />
                  </span>
                </button>
              </li>
            ))}
            {bench.length === 0 && <li className="muted small">Nobody on the bench.</li>}
          </ul>
        </section>
        {proposal && <ProposalPanel api={api} proposal={proposal} onApply={apply} onCancel={() => setProposal(null)} />}
        {mode === 'stats' && <Legend keys={['AVG', 'HR', 'RBI', 'G', 'AB', 'ERA', 'WHIP', 'IP']} />}
      </aside>
    </div>
  );
}

function PositionCard({
  api,
  player,
  pos,
  style,
  selected,
  onClick,
  onDropPlayer,
  battingSpot,
}: {
  api: DraftApi;
  player: Player;
  pos: LineupPosition | 'P';
  style: React.CSSProperties;
  selected: boolean;
  onClick: () => void;
  onDropPlayer?: (id: PlayerId) => void;
  battingSpot?: number;
}) {
  const { state: s, mode, period } = api;
  const [over, setOver] = useState(false);
  const fit = pos === 'P' ? 'natural' : suitability(s, player.id, pos);
  const vals = pos === 'P' ? pitcherValues(s, player, mode, period, true) : hitterValues(s, player, mode, period, 'field', pos);
  return (
    <button
      className={`pm-card ${selected ? 'selected' : ''} ${over ? 'drop' : ''} ${fit === 'out' ? 'oop' : ''}`}
      style={style}
      onClick={onClick}
      onDragOver={(e) => {
        if (!onDropPlayer) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = e.dataTransfer.getData('text/player');
        if (id && onDropPlayer) onDropPlayer(id);
      }}
      aria-pressed={selected}
      aria-label={`${pos}: ${playerName(player)}${battingSpot ? `, batting ${battingSpot}` : ''}. Select to swap.`}
    >
      <Portrait state={s} player={player} size={46} />
      <span className="pc-main">
        <span className="pc-top">
          <PosBadge pos={pos} />
          <strong>{shortName(player)}</strong>
        </span>
        <Values vals={vals} />
        <span className="pc-status">
          <FitnessMeter value={player.fitness} />
          <HappinessMeter value={player.satisfaction} />
        </span>
        <Notes notes={playerNotes(s, player, { starting: true })} max={1} />
      </span>
    </button>
  );
}

function ProposalPanel({ api, proposal, onApply, onCancel }: { api: DraftApi; proposal: NonNullable<Proposal>; onApply: () => void; onCancel: () => void }) {
  const { state: s, draft, mode, period } = api;
  const order = draft.lineup.battingOrder;
  let outP: Player;
  let inP: Player;
  let outPos: LineupPosition | 'P';
  let inPos: LineupPosition | 'P';
  const lines: { text: string; tone: 'info' | 'warn' | 'good' }[] = [];
  let blocker: string | null = null;

  if (proposal.kind === 'positions') {
    outP = s.players[order[proposal.a].playerId];
    inP = s.players[order[proposal.b].playerId];
    outPos = order[proposal.a].position;
    inPos = order[proposal.b].position;
    lines.push({ text: `${outP.lastName} moves to ${inPos}, ${inP.lastName} moves to ${outPos}. Batting spots stay the same.`, tone: 'info' });
    for (const [p, pos] of [[outP, inPos], [inP, outPos]] as [Player, LineupPosition][]) {
      if (suitability(s, p.id, pos) === 'out') lines.push({ text: `${p.lastName} is out of position at ${pos}: fielding −${BALANCE.match.outOfPositionFieldingPenalty}.`, tone: 'warn' });
    }
  } else if (proposal.kind === 'bench') {
    outP = s.players[order[proposal.index].playerId];
    inP = s.players[proposal.inId];
    outPos = order[proposal.index].position;
    inPos = outPos;
    blocker = benchSwapBlocker(s, draft, proposal.index, inP.id);
    lines.push({ text: `${outP.lastName} to the bench · ${inP.lastName} starts at ${outPos}, batting ${proposal.index + 1}.`, tone: 'info' });
    if (suitability(s, inP.id, outPos) === 'out') lines.push({ text: `${inP.lastName} is out of position at ${outPos}: fielding −${BALANCE.match.outOfPositionFieldingPenalty}.`, tone: 'warn' });
    const promise = s.promises.find((pr) => pr.status === 'active' && pr.playerId === outP.id);
    if (promise) lines.push({ text: `${outP.lastName} was promised starts (${promise.progress}/${promise.threshold}). Benching him uses up one of the promised games.`, tone: 'warn' });
    const idle = gamesWithoutStart(s, inP);
    if (idle >= 3) lines.push({ text: `${inP.lastName} would get his first start in ${idle + 1} games.`, tone: 'good' });
    if (outP.fitness < BALANCE.fitness.warnBelow) lines.push({ text: `${outP.lastName} gets a planned rest (fitness ${outP.fitness}%).`, tone: 'good' });
  } else {
    outP = s.players[draft.lineup.pitcherId];
    inP = s.players[proposal.inId];
    outPos = 'P';
    inPos = 'P';
    lines.push({ text: `${inP.lastName} starts today; ${outP.lastName} becomes available in the bullpen.`, tone: 'info' });
  }

  const rows = compareRows(api, outP, inP, outPos);
  return (
    <section className="panel pm-proposal" aria-label="Proposed swap">
      <header className="panel-head">
        <h2>Proposed swap</h2>
      </header>
      <div className="cmp-head">
        <span>
          <Portrait state={s} player={outP} size={44} />
          <strong>{outP.lastName}</strong>
          <small>
            {outPos} · OVR {outPos === 'P' ? overall(outP) : overallAt(outP, outPos)}
          </small>
        </span>
        <span aria-hidden="true">⇄</span>
        <span>
          <Portrait state={s} player={inP} size={44} />
          <strong>{inP.lastName}</strong>
          <small>
            {inPos} · OVR {inPos === 'P' ? overall(inP) : overallAt(inP, inPos)}
          </small>
        </span>
      </div>
      <table className="cmp-table">
        <caption className="sr-only">Comparison ({mode === 'stats' ? (period === 'season' ? 'season' : 'last 5 games') : 'attributes'})</caption>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className={r.better === 'out' ? 'better' : ''}>{r.out}</td>
              <th scope="row">{r.label}</th>
              <td className={r.better === 'in' ? 'better' : ''}>{r.in}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="cmp-lines">
        {lines.map((l) => (
          <li key={l.text} className={`note-${l.tone}`}>
            {l.text}
          </li>
        ))}
      </ul>
      {blocker && <p className="blocker">{blocker}</p>}
      <div className="lineup-actions">
        <button className="btn btn-secondary pm-apply" onClick={onApply} disabled={!!blocker}>
          Apply swap
        </button>
        <button className="btn btn-small btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p className="small muted">Applying changes the draft only. Nothing is final until you confirm the lineup.</p>
    </section>
  );
}

interface Row {
  label: string;
  out: string;
  in: string;
  better: 'out' | 'in' | null;
}

/** Comparison in the active data mode; stats rows always show their sample size. */
function compareRows(api: DraftApi, a: Player, b: Player, aPos: LineupPosition | 'P'): Row[] {
  const { state: s, mode, period } = api;
  const num = (label: string, x: number, y: number, fmt = (v: number) => String(v), higherBetter = true): Row => ({
    label,
    out: fmt(x),
    in: fmt(y),
    better: x === y ? null : (x > y) === higherBetter ? 'out' : 'in',
  });
  const rows: Row[] = [];
  const pitcher = aPos === 'P';
  if (mode === 'attributes') {
    if (pitcher) {
      rows.push(num('Pitching', a.ratings.pitching, b.ratings.pitching), num('OVR', overall(a), overall(b)));
    } else {
      // Both measured at the spot being filled (the outgoing player's position).
      rows.push(
        num(`OVR at ${aPos}`, overallAt(a, aPos as LineupPosition), overallAt(b, aPos as LineupPosition)),
        num('Contact', a.ratings.contact, b.ratings.contact),
        num('Power', a.ratings.power, b.ratings.power),
        num('Speed', a.ratings.speed, b.ratings.speed),
        num('Fielding', a.ratings.fielding, b.ratings.fielding),
      );
    }
  } else if (pitcher) {
    const x = pitchingStats(s, a, period);
    const y = pitchingStats(s, b, period);
    rows.push(
      { label: 'ERA', out: fmtEra(x.era), in: fmtEra(y.era), better: x.era === null || y.era === null || x.era === y.era ? null : x.era < y.era ? 'out' : 'in' },
      { label: 'IP', out: fmtIp(x.outs), in: fmtIp(y.outs), better: null },
    );
  } else {
    const x = battingStats(s, a, period);
    const y = battingStats(s, b, period);
    const small = (ab: number) => (ab > 0 && ab < 15 ? ' (small sample)' : '');
    rows.push(
      { label: 'AVG', out: `${fmtRate(x.avg)} over ${x.ab} AB${small(x.ab)}`, in: `${fmtRate(y.avg)} over ${y.ab} AB${small(y.ab)}`, better: null },
      { label: 'OBP', out: fmtRate(x.obp), in: fmtRate(y.obp), better: null },
      num('HR', x.hr, y.hr),
      num('RBI', x.rbi, y.rbi),
    );
  }
  if (pitcher) {
    const wa = pitcherWorkload(s, a).last;
    const wb = pitcherWorkload(s, b).last;
    rows.push({ label: 'Last outing', out: wa ? `${wa.gamesAgo} game${wa.gamesAgo > 1 ? 's' : ''} ago` : 'None yet', in: wb ? `${wb.gamesAgo} game${wb.gamesAgo > 1 ? 's' : ''} ago` : 'None yet', better: null });
  }
  rows.push(num('Fitness', a.fitness, b.fitness, (v) => `${v}%`), num('Happiness', a.satisfaction, b.satisfaction));
  return rows;
}
