import { parseSearchArgs } from '../cli-args.js';
import { parseModifiedArgs } from '../query-time.js';
import { createError, ERROR_CODES } from '../../shared/error-codes.js';

/** Bind both child execution and result-cache identity to the same cutoff. */
export const bindRelativeModificationArgs = (args, timeAnchor) => {
  const marker = args.indexOf('--');
  const options = marker < 0 ? args : args.slice(0, marker);
  const argv = parseSearchArgs(options);
  if (argv['modified-since'] == null) return args;
  let modifiedAfter;
  try {
    ({ modifiedAfter } = parseModifiedArgs(argv['modified-after'], argv['modified-since'], timeAnchor));
    if (!Number.isFinite(modifiedAfter) || Math.abs(modifiedAfter) > 8.64e15) throw new Error('Invalid modified-since interval.');
  } catch (error) { throw createError(ERROR_CODES.INVALID_REQUEST, error.message); }
  const result = [];
  for (let i = 0; i < options.length; i += 1) {
    const token = options[i];
    if (token === '--modified-since' || token === '--modified-after') { i += 1; continue; }
    if (token.startsWith('--modified-since=') || token.startsWith('--modified-after=')) continue;
    result.push(token);
  }
  return [...result, '--modified-after', new Date(modifiedAfter).toISOString(), ...(marker < 0 ? [] : args.slice(marker))];
};
