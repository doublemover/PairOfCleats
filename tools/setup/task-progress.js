import { stripVTControlCharacters } from 'node:util';

const plain = value => stripVTControlCharacters(typeof value === 'string' ? value : '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 180);
const terminal = new Set(['succeeded', 'failed', 'blocked', 'cancelled']);

/** One stable non-TTY/TTY line per actual start/terminal transition. Machine
 * events stay in the explicitly supplied callback; raw child output is never
 * parsed, edited or mixed into a JSON stdout contract by this formatter.
 */
export const formatBootstrapTaskProgress = (event, label) => {
  if (event.state !== 'started' && !terminal.has(event.state)) return null;
  const resource = event.taskResourceState === 'pending' ? '; original resource retirement pending' : '';
  const message = event.state === 'failed' && event.error?.message ? ': ' + plain(event.error.message) : '';
  return '[bootstrap:' + plain(label) + '] ' + plain(event.taskId) + ' ' + event.state
    + (event.required ? '' : ' (optional)') + resource + message;
};
