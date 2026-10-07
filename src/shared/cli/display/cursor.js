export const moveCursorDown = (term, count) => {
  if (!count || count <= 0) return;
  if (typeof term.down === 'function') {
    term.down(count);
  } else {
    term(`\x1b[${count}B`);
  }
  term('\r');
};

export const moveCursorUp = (term, count) => {
  if (!count || count <= 0) return;
  if (typeof term.up === 'function') {
    term.up(count);
    return;
  }
  term(`\x1b[${count}A`);
};
