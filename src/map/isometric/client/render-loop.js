/** One RAF owner; settled static/hidden views retain no recurring callbacks. */
export const createRenderLoop = ({ render, visible = () => true,
  request = requestAnimationFrame, cancel = cancelAnimationFrame }) => {
  let pending = null, retired = false, dirty = false, continuous = false;
  const schedule = () => {
    if (!retired && pending === null && visible() && dirty) pending = request(frame);
  };
  const frame = time => {
    pending = null;
    if (retired || !visible()) { continuous = false; return; }
    dirty = false;
    const active = render(time, { continuous });
    continuous = active === true;
    if (continuous) dirty = true;
    schedule();
  };
  return {
    invalidate() { dirty = true; schedule(); },
    visibilityChanged() {
      if (pending !== null) cancel(pending);
      pending = null; continuous = false; dirty = true; schedule();
    },
    dispose() {
      if (retired) return;
      retired = true;
      if (pending !== null) cancel(pending);
      pending = null;
    }
  };
};
