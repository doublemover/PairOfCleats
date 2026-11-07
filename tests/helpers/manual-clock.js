import assert from 'node:assert/strict';

/** Local, explicitly restored virtual clock for plain-script lifecycle fixtures. */
export const createManualClock = (start = 1000000) => {
  const native = { now: Date.now, setTimeout, clearTimeout, setInterval, clearInterval };
  let time = start, sequence = 0;
  const timers = new Map();
  const add = (callback, delay = 0, interval = false, args = []) => {
    const timer = { id: ++sequence, at: time + Math.max(0, delay), callback, args,
      interval: interval ? Math.max(1, delay) : null, unref() { return this; } };
    timers.set(timer.id, timer); return timer;
  };
  Date.now = () => time;
  globalThis.setTimeout = (callback, delay, ...args) => add(callback, delay, false, args);
  globalThis.setInterval = (callback, delay, ...args) => add(callback, delay, true, args);
  globalThis.clearTimeout = globalThis.clearInterval = timer => timers.delete(timer?.id);
  const settle = async () => { for (let step = 0; step < 80; step++) await Promise.resolve(); };
  return {
    timers, now: () => time, settle,
    async advance(milliseconds) {
      const target = time + milliseconds;
      let steps = 0;
      for (;;) {
        const next = [...timers.values()].filter(timer => timer.at <= target)
          .sort((left, right) => left.at - right.at || left.id - right.id)[0];
        if (!next) break;
        assert.ok(++steps < 1000, 'bounded virtual timer activity');
        time = next.at;
        if (next.interval) next.at += next.interval;
        else timers.delete(next.id);
        next.callback(...next.args); await settle();
      }
      time = target; await settle();
    },
    restore() {
      Date.now = native.now;
      globalThis.setTimeout = native.setTimeout; globalThis.clearTimeout = native.clearTimeout;
      globalThis.setInterval = native.setInterval; globalThis.clearInterval = native.clearInterval;
    }
  };
};
