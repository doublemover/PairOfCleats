export const createViewportInputOwner = ({ viewport, canvas, window, document, cancelMotion, shortcut, invalidate }) => {
  const keys = Object.create(null), removers = [];
  let focused = false;
  const owns = target => target === viewport || target === canvas;
  const listen = (target, name, callback) => {
    target.addEventListener(name, callback);
    removers.push(() => target.removeEventListener(name, callback));
  };
  const reset = () => {
    for (const code of Object.keys(keys)) delete keys[code];
    cancelMotion();
    invalidate();
  };
  listen(viewport, 'pointerdown', event => {
    if (!owns(event.target)) return;
    viewport.focus({ preventScroll: true });
  });
  listen(document, 'focusin', event => {
    focused = owns(event.target);
    if (!focused) reset();
  });
  listen(viewport, 'focusout', event => {
    if (!owns(event.relatedTarget)) { focused = false; reset(); }
  });
  listen(window, 'blur', () => { focused = false; reset(); });
  listen(document, 'visibilitychange', () => { if (document.hidden) { focused = false; reset(); } });
  for (const event of ['pointercancel', 'lostpointercapture']) listen(canvas, event, reset);
  listen(window, 'keydown', event => {
    if (!focused || !owns(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (shortcut(event)) { event.preventDefault(); return; }
    if (!['KeyW','KeyA','KeyS','KeyD'].includes(event.code)) return;
    event.preventDefault(); keys[event.code] = true; invalidate();
  });
  // Key release always retires ownership, including after focus transfer/blur.
  listen(window, 'keyup', event => { delete keys[event.code]; invalidate(); });
  focused = owns(document.activeElement);
  return { keys, reset, dispose() { reset(); for (const remove of removers.splice(0)) remove(); } };
};
