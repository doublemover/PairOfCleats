/** The render loop owns the frame boundary; pointer delivery owns only the most
 * recent coordinates. Idle frames do no picking until an explicit invalidation. */
export const createHoverFrame = ({ pick, clear }) => {
  let pointer = null, dirty = false, dragging = false, disposed = false;
  return {
    move(event) {
      if (disposed) return;
      pointer = { clientX: event.clientX, clientY: event.clientY };
      dirty = true;
    },
    invalidate() { if (pointer && !disposed) dirty = true; },
    startDrag() { dragging = true; dirty = false; clear(); },
    endDrag() { dragging = false; if (pointer) dirty = true; },
    leave() { pointer = null; dirty = false; dragging = false; clear(); },
    frame() {
      if (disposed || dragging || !pointer || !dirty) return false;
      dirty = false; pick(pointer); return true;
    },
    dispose() { disposed = true; pointer = null; dirty = false; clear(); }
  };
};
