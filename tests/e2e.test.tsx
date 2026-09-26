// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GameController } from '../src/application/controller';
import { ManualClock } from '../src/platform/clock';
import { IndexedDbSaveRepository } from '../src/platform/indexedDbRepository';
import { App } from '../src/ui/App';
import { ControllerContext } from '../src/ui/hooks';
import { T0 } from './helpers';

/**
 * End-to-end flow through the real React UI, the real controller and the real
 * IndexedDB adapter (backed by fake-indexeddb): new game → decision → result →
 * continue → "reload" (fresh controller + UI on the same database) → keep playing.
 */

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as never;
  Element.prototype.scrollIntoView ??= () => {};
  window.scrollTo = () => {};
});
afterEach(() => cleanup());

async function mount(clock: ManualClock) {
  const controller = new GameController(new IndexedDbSaveRepository(indexedDB), clock);
  await act(async () => {
    await controller.init();
  });
  render(
    <ControllerContext.Provider value={controller}>
      <App />
    </ControllerContext.Provider>,
  );
  return controller;
}

const click = async (el: Element) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

/** Resolves or continues whatever the Home screen currently offers. Returns what it clicked. */
async function advance(): Promise<string> {
  const skip = screen.queryByRole('button', { name: /Skip to result/i });
  if (skip) {
    await click(skip);
    return 'skip';
  }
  const cont = screen.queryByRole('button', { name: /^Continue/ });
  if (cont && !(cont as HTMLButtonElement).disabled) {
    await click(cont);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Continue/ })).toBeNull());
    return 'continue';
  }
  const confirm = await screen.findByRole('button', { name: /^Confirm/ });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  await click(confirm);
  // A normal event shows its result; a league game first shows the highlight playback.
  await waitFor(() => expect(screen.queryByText('What changed') ?? screen.queryByRole('button', { name: /Skip to result/i })).toBeTruthy());
  return 'confirm';
}

describe('end-to-end', () => {
  it('new game → decisions → save → reload → continue playing', async () => {
    await new IndexedDbSaveRepository(indexedDB).clear();
    const clock = new ManualClock(T0);
    await mount(clock);

    // New game screen: name the club and enable test mode.
    expect(await screen.findByText('Take over the club')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Club name'), { target: { value: 'Testers' } });
    await click(screen.getByRole('checkbox', { name: /Unlimited Time/ }));
    await click(screen.getByRole('button', { name: 'Start career' }));

    // First event: the owners' season plan, clearly the main action.
    expect(await screen.findByRole('heading', { name: 'Season 1 Plan' })).toBeTruthy();
    await click(screen.getByRole('radio', { name: /Rebuild/ }));
    await click(screen.getByRole('button', { name: /^Confirm/ }));
    expect(await screen.findByRole('heading', { name: /Rebuild: the plan is set/ })).toBeTruthy();
    expect(screen.getByText('What changed')).toBeTruthy();

    // Continue to the next (pre-created) event.
    await click(screen.getByRole('button', { name: /^Continue/ }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).not.toMatch(/plan is set/));
    const nextTitle = screen.getByRole('heading', { level: 1 }).textContent;
    expect(nextTitle).not.toMatch(/Season 1 Plan/);

    // "Reload": unmount, new controller and UI on the same database.
    cleanup();
    await mount(clock);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(nextTitle);
    expect(screen.getByText('Rebuild')).toBeTruthy(); // season goal panel survived the reload

    // Keep playing through the UI until the first league game has been played.
    const clicks: string[] = [];
    // The visual match view ends on FINAL with the existing match summary underneath.
    for (let i = 0; i < 30 && screen.queryAllByText(/^Final/i).length === 0; i++) clicks.push(await advance());
    expect(screen.getAllByText(/^Final/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Line score' })).toBeTruthy();
    expect(clicks).toContain('confirm');

    // History lists the decisions made across the reload.
    await act(async () => {
      location.hash = '#/history';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByText(/Rebuild — |Season 1 Plan/)).toBeTruthy();
    expect(screen.getAllByText(/League|vs |@ /).length).toBeGreaterThan(0);
  }, 60_000);
});
