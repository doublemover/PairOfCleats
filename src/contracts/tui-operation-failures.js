import { readFileSync } from 'node:fs';

const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
export const TUI_OPERATION_FAILURES = freeze(JSON.parse(readFileSync(
  new URL('./tui-operation-failures.json', import.meta.url), 'utf8')));
