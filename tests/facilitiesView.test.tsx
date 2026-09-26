// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameController } from '../src/application/controller';
import { ManualClock } from '../src/platform/clock';
import { MemorySaveRepository } from '../src/platform/saveRepository';
import { App } from '../src/ui/App';
import { ControllerContext } from '../src/ui/hooks';
import { T0 } from './helpers';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as never;
  Element.prototype.scrollIntoView ??= () => {};
  window.scrollTo = () => {};
});
afterEach(() => cleanup());

/** A fresh game with the given changes, loaded through the real controller and shown on Club → Facilities. */
async function mountWith(change: (state: Record<string, any>) => void) {
  const controller = new GameController(new MemorySaveRepository(), new ManualClock(T0));
  await act(async () => {
    await controller.init();
    await controller.newGame({ seed: 31, timeMode: 'unlimited' });
  });
  const env = JSON.parse(controller.exportCurrent()!);
  change(env.state);
  await act(async () => {
    expect(await controller.importSave(JSON.stringify(env))).toBeNull();
  });
  location.hash = '#/club';
  render(
    <ControllerContext.Provider value={controller}>
      <App />
    </ControllerContext.Provider>,
  );
  return controller;
}

describe('Club → Facilities', () => {
  it('shows happenings separately, marks the affected card and applies the discount to the price', async () => {
    const c = await mountWith((s) => {
      s.clubs.hfx.modifiers = [{ id: 'mod1', facility: 'stadium', kind: 'upgradeDiscount', value: 0.2, label: 'Local sponsor partnership', source: 'test', matchesLeft: 3 }];
    });
    const happenings = await screen.findByRole('region', { name: 'Club happenings' });
    expect(within(happenings).getByText('Local sponsor partnership')).toBeTruthy();
    expect(within(happenings).getByText(/20% off the next Stadium/)).toBeTruthy();
    expect(within(happenings).getByText(/Expires after 3 matches/)).toBeTruthy();
    // The stadium card carries the happening chip; other cards do not.
    const stadium = screen.getByRole('button', { name: /Stadium & Fan Facilities, level 1/ });
    expect(within(stadium).getByText('Local sponsor partnership')).toBeTruthy();
    await act(async () => {
      fireEvent.click(stadium);
    });
    const detail = screen.getByRole('region', { name: /Stadium & Fan Facilities upgrade/ });
    expect(within(detail).getByText('$96K')).toBeTruthy(); // 120K − 20%
    await act(async () => {
      fireEvent.click(within(detail).getByRole('button', { name: /Upgrade to level 2/ }));
    });
    expect(c.getSnapshot().state!.clubs.hfx.facilities.stadium).toBe(2);
    expect(c.getSnapshot().state!.clubs.hfx.modifiers).toHaveLength(0);
    expect(await screen.findByText('Stadium & Fan Facilities is now level 2.')).toBeTruthy();
  });

  it('explains missing money and max level instead of offering the button', async () => {
    await mountWith((s) => {
      s.clubs.hfx.cash = 5_000;
      s.clubs.hfx.facilities.scouting = 3;
    });
    const detail = await screen.findByRole('region', { name: /Training Center upgrade/ });
    expect((within(detail).getByRole('button', { name: /Upgrade to level 2/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(detail).getByText(/Not enough Club Cash: needs \$80,000/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Scouting Department, level 3/ }));
    });
    const scouting = screen.getByRole('region', { name: /Scouting Department upgrade/ });
    expect(within(scouting).queryByRole('button', { name: /Upgrade/ })).toBeNull();
    expect(within(scouting).getByText(/highest level/)).toBeTruthy();
  });
});
