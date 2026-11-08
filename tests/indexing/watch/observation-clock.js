export const createObservationClock = () => {
  let time = 0, nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(fn, delay) {
      const id = ++nextId;
      timers.set(id, { fn, at: time + delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    pending: () => timers.size,
    advance(ms) {
      time += ms;
      const due = [...timers].filter(([, timer]) => timer.at <= time);
      for (const [id, timer] of due) {
        if (timers.delete(id)) timer.fn();
      }
    }
  };
};
