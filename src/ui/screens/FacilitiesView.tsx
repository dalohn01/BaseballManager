import { useRef, useState, type Ref } from 'react';
import { BALANCE } from '../../balance/config';
import { absoluteRound, userClub } from '../../domain/state';
import type { Club, FacilityId, FacilityModifier } from '../../domain/types';
import { FACILITY_LABELS } from '../../simulation/economy';
import { FACILITY_EFFECTS, FACILITY_IDS, FACILITY_TAGLINE, facilityUpkeep, listPrice, MAX_FACILITY_LEVEL, modifierEffect, modifiersFor, upgradeBlocker, upgradePrice } from '../../simulation/facilities';
import { Icon } from '../components/icons';
import { money, moneyExact } from '../format';
import { useController, useGame, useSnapshot } from '../hooks';

const ROUNDS = BALANCE.season.rounds;
const perSeason = (id: FacilityId, level: number) => facilityUpkeep(id, level) * ROUNDS;
const matchesText = (n: number) => `${n} match${n === 1 ? '' : 'es'} left`;

/**
 * Club → Facilities: permanent levels bought directly (Club Cash only, no
 * event, no Time) next to temporary happenings, which are listed separately.
 */
export function FacilitiesView() {
  const s = useGame();
  const club = userClub(s);
  const [selected, setSelected] = useState<FacilityId>('training');
  const detailRef = useRef<HTMLElement>(null);

  const select = (id: FacilityId) => {
    setSelected(id);
    // On narrow screens the detail panel sits below the cards.
    if (window.matchMedia?.('(max-width: 900px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="fac-layout">
      <div className="fac-cards">
        {FACILITY_IDS.map((id) => (
          <FacilityCard key={id} id={id} club={club} selected={selected === id} onSelect={() => select(id)} />
        ))}
      </div>
      <div className="fac-side">
        <UpgradePanel ref={detailRef} id={selected} />
        <Happenings club={club} />
      </div>
      {club.project && (
        <p className="fac-foot small muted">
          <Icon name="stadium" size={18} /> Construction from an older save: {FACILITY_LABELS[club.project.facility]} → level {club.project.toLevel}, ready after round{' '}
          {club.project.completesRound - absoluteRound(s.calendar.season, 0)}.
        </p>
      )}
    </div>
  );
}

function FacilityCard({ id, club, selected, onSelect }: { id: FacilityId; club: Club; selected: boolean; onSelect: () => void }) {
  const level = club.facilities[id];
  const row = FACILITY_EFFECTS[id][0];
  const mods = modifiersFor(club, id);
  const max = level >= MAX_FACILITY_LEVEL;
  return (
    <button className={`fac-card ${selected ? 'on' : ''}`} onClick={onSelect} aria-pressed={selected} aria-label={`${FACILITY_LABELS[id]}, level ${level}. View upgrade`}>
      {selected && (
        <span className="fac-selected">
          <Icon name="check" size={14} /> Selected
        </span>
      )}
      <FacilityArt id={id} club={club} />
      <span className="fac-card-head">
        <strong className="fac-name">{FACILITY_LABELS[id]}</strong>
        <span className="fac-level">Level {level}</span>
      </span>
      <span className="fac-now">
        <Icon name="chart" size={22} />
        <span>
          <strong>
            {row.label}: {row.value(level)}
          </strong>
          <small className="muted">Current effect</small>
        </span>
      </span>
      {mods.length > 0 && (
        <span className="fac-chips">
          {mods.map((m) => (
            <span key={m.id} className={`fac-chip ${isNegative(m) ? 'neg' : ''}`}>
              <Icon name={isNegative(m) ? 'warning' : 'influence'} size={14} /> {m.label}
            </span>
          ))}
        </span>
      )}
      <span className="fac-next">
        <Icon name="chart" size={16} />
        {max ? 'Max level reached' : `Next level: ${row.label} ${row.value(level + 1)}`}
      </span>
      <span className="fac-view link">View upgrade →</span>
    </button>
  );
}

const isNegative = (m: FacilityModifier) => m.kind === 'capacityCut' || (m.kind === 'trainingBoost' && m.value < 0);

function UpgradePanel({ id, ref }: { id: FacilityId; ref: Ref<HTMLElement> }) {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const club = userClub(s);
  const [done, setDone] = useState<string | null>(null);
  const level = club.facilities[id];
  const max = level >= MAX_FACILITY_LEVEL;
  const next = level + 1;
  const price = upgradePrice(club, id);
  const list = listPrice(club, id);
  const blocker = upgradeBlocker(s, id);
  const discount = modifiersFor(club, id).find((m) => m.kind === 'upgradeDiscount');
  const upkeepDelta = max ? 0 : perSeason(id, next) - perSeason(id, level);

  const buy = () => {
    const label = `${FACILITY_LABELS[id]} is now level ${next}.`;
    void c.dispatch({ type: 'upgradeFacility', facility: id, revision: s.revision }).then((ok) => ok && setDone(label));
  };

  return (
    <section ref={ref} className="panel fac-detail" aria-label={`${FACILITY_LABELS[id]} upgrade`}>
      <header className="fac-detail-head">
        <FacilityArt id={id} club={club} small />
        <div>
          <h2>{FACILITY_LABELS[id]}</h2>
          <p className="muted">{FACILITY_TAGLINE[id]}</p>
        </div>
      </header>
      <div className="fac-levels">
        <span className="fac-lv now">Level {level}</span>
        {max ? (
          <span className="fac-lv max">Max level</span>
        ) : (
          <>
            <span aria-hidden="true">→</span>
            <span className="fac-lv next">Level {next}</span>
          </>
        )}
      </div>

      <h3 className="fac-sub">Permanent improvement</h3>
      <table className="fac-compare">
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Effect</span>
            </th>
            <th scope="col">Now (level {level})</th>
            {!max && (
              <th scope="col" className="hl">
                Level {next}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {FACILITY_EFFECTS[id].map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.value(level)}</td>
              {!max && <td className="hl strong">{r.value(next)}</td>}
            </tr>
          ))}
          <tr>
            <th scope="row">Upkeep / season</th>
            <td>{money(perSeason(id, level))}</td>
            {!max && <td className="hl">{money(perSeason(id, next))}</td>}
          </tr>
        </tbody>
      </table>

      {max ? (
        <p className="fac-maxnote">
          <Icon name="trophy" size={20} /> The {FACILITY_LABELS[id]} is at the highest level. There is nothing more to buy here.
        </p>
      ) : (
        <>
          <h3 className="fac-sub">Upgrade cost</h3>
          <div className="fac-cost">
            <div className="fac-price">
              <Icon name="cash" size={30} />
              <span>
                <strong>{money(price!)}</strong>
                {discount && (
                  <small>
                    <s>{money(list!)}</s> · {Math.round(discount.value * 100)}% sponsor discount
                  </small>
                )}
              </span>
            </div>
            <dl className="fac-funds">
              <div>
                <dt>Club funds</dt>
                <dd>{moneyExact(club.cash)}</dd>
              </div>
              <div>
                <dt>After upgrade</dt>
                <dd className={club.cash - price! < 0 ? 'bad' : 'good'}>{moneyExact(club.cash - price!)}</dd>
              </div>
              <div>
                <dt>Running cost</dt>
                <dd>+{money(upkeepDelta)} per season</dd>
              </div>
            </dl>
          </div>
          <button className="btn btn-primary fac-buy" onClick={buy} disabled={!!blocker || snap.busy}>
            <Icon name="check" /> {snap.busy ? 'Saving…' : `Upgrade to level ${next} · ${money(price!)}`}
          </button>
          {blocker ? (
            <p className="blocker" role="note">
              <Icon name="warning" size={18} /> {blocker}
            </p>
          ) : (
            <p className="small muted fac-hint">Takes effect right away. Available any time from Facilities; no Time or event needed.</p>
          )}
        </>
      )}
      {done && (
        <p className="fac-done" role="status">
          <Icon name="check" size={18} /> {done}
        </p>
      )}
      {snap.commandError && (
        <p className="blocker" role="alert">
          {snap.commandError}
        </p>
      )}
    </section>
  );
}

function Happenings({ club }: { club: Club }) {
  return (
    <section className="panel fac-happen" aria-label="Club happenings">
      <header className="panel-head">
        <h2>
          <Icon name="influence" size={20} /> Club happenings
        </h2>
      </header>
      <div className="panel-body">
        {club.modifiers.length === 0 ? (
          <p className="muted small">No active happenings. Events such as sponsor offers, guest clinics or breakdowns add temporary effects here, separate from levels.</p>
        ) : (
          <ul className="fac-mods">
            {club.modifiers.map((m) => (
              <li key={m.id} className={isNegative(m) ? 'neg' : ''}>
                <Icon name={isNegative(m) ? 'warning' : 'influence'} size={26} />
                <div>
                  <strong>{m.label}</strong>
                  <span className="muted small">{FACILITY_LABELS[m.facility]}</span>
                  <span>{modifierEffect(m)}</span>
                  <small className="muted">{m.kind === 'upgradeDiscount' ? `Expires after ${m.matchesLeft} match${m.matchesLeft === 1 ? '' : 'es'} · used up by the upgrade` : matchesText(m.matchesLeft)}</small>
                </div>
                <span className={`fac-active ${isNegative(m) ? 'neg' : ''}`}>Active</span>
              </li>
            ))}
          </ul>
        )}
        {club.modifiers.length > 0 && (
          <p className="small muted fac-sep">
            <Icon name="warning" size={16} /> Happenings are temporary and separate from facility levels.
          </p>
        )}
      </div>
    </section>
  );
}

/** Simple code-drawn building per facility, in the club's colours. */
function FacilityArt({ id, club, small }: { id: FacilityId; club: Club; small?: boolean }) {
  const { primary, secondary } = club.colors;
  return (
    <svg className={`fac-art ${small ? 'small' : ''}`} viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="320" height="150" fill="#eaf2fb" />
      <ellipse cx="160" cy="138" rx="150" ry="18" fill="#cfe3c4" />
      {[30, 290, 60].map((x, i) => (
        <g key={x}>
          <rect x={x - 2} y={i === 2 ? 96 : 90} width="4" height="30" fill="#7a5a3a" />
          <circle cx={x} cy={i === 2 ? 92 : 86} r={i === 2 ? 12 : 16} fill={i % 2 ? '#4d9b45' : '#5cab4f'} />
        </g>
      ))}
      {id === 'training' && (
        <g>
          <path d="M70 70 L170 50 L250 66 L150 88 Z" fill={primary} />
          <path d="M70 70 L150 88 L150 128 L70 110 Z" fill="#f4f7fb" stroke="#c6d1e0" />
          <path d="M150 88 L250 66 L250 106 L150 128 Z" fill="#dfe7f1" stroke="#c6d1e0" />
          <rect x="94" y="88" width="20" height="18" fill="#9cc2e8" transform="skewY(12)" />
          <path d="M185 100 l40 -9 v18 l-40 9z" fill="none" stroke="#6b7c93" strokeWidth="1.5" />
          {/* Batting cage */}
          <path d="M230 112 L290 100 L290 76 L230 88 Z" fill="none" stroke="#6b7c93" strokeWidth="1.5" strokeDasharray="3 2" />
          <circle cx="125" cy="80" r="9" fill={secondary} />
        </g>
      )}
      {id === 'scouting' && (
        <g>
          <path d="M90 64 L165 48 L235 62 L160 78 Z" fill="#2c3e55" />
          <path d="M90 64 L160 78 L160 124 L90 110 Z" fill="#b5654a" />
          <path d="M160 78 L235 62 L235 108 L160 124 Z" fill="#9b5540" />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={170 + i * 20} y={84 - i * 4} width="12" height="14" fill="#cfe2f5" />
          ))}
          <circle cx="125" cy="86" r="14" fill={primary} stroke="#fff" strokeWidth="2" />
          <circle cx="120" cy="86" r="4" fill="#fff" />
          <circle cx="130" cy="86" r="4" fill="#fff" />
        </g>
      )}
      {id === 'stadium' && (
        <g>
          <ellipse cx="160" cy="98" rx="120" ry="42" fill="#b5654a" />
          <ellipse cx="160" cy="92" rx="104" ry="32" fill={primary} />
          <ellipse cx="160" cy="96" rx="80" ry="22" fill="#5fae5a" />
          <path d="M160 82 l22 12 -22 12 -22 -12z" fill="#d6a877" />
          {[70, 250].map((x) => (
            <g key={x}>
              <rect x={x - 2} y="30" width="4" height="50" fill="#8d9bb0" />
              <rect x={x - 12} y="24" width="24" height="10" rx="2" fill="#f4f7fb" stroke="#8d9bb0" />
            </g>
          ))}
          <rect x="120" y="120" width="80" height="14" rx="3" fill={primary} stroke="#fff" />
          <rect x="150" y="60" width="4" height="16" fill="#5b6778" />
          <path d="M154 61 l14 5 -14 5z" fill={secondary} />
        </g>
      )}
    </svg>
  );
}
