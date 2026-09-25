export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export class ManualClock implements Clock {
  constructor(public t = 0) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}
