import { stripVTControlCharacters } from 'node:util';
import { writeBootstrapStatus, writeBootstrapText } from './task-progress-output.js';
import { createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { requireCheckoutMutationSession } from './checkout-mutation.js';

/** Logging cannot interrupt pure result classification and lose a compiler
 * failure. New child/readiness admission checks the same reporter, and finish
 * retains the original domain error alongside independent transport errors. */
export const withBootstrapSummaryOutput = async (root, session, operation, { stderr = process.stderr } = {}) => {
  requireCheckoutMutationSession(root, session);
  const errors = [], observations = createStorageObservationLedger();
  let outputError;
  const remember = error => {
    if (errors.length < 64) errors.push(error); else observations.markIncomplete();
    observations.remember(error);
  };
  const check = () => {
    if (!errors.length) return;
    outputError ||= Object.assign(new AggregateError(errors, 'Bootstrap summary transport failed.', { cause: errors[0] }), {
      code: 'ERR_BOOTSTRAP_SUMMARY_OUTPUT', cacheOwnershipPending: true, cacheOwnershipReleased: observations.isSettled
    });
    throw outputError;
  };
  const context = { root, session };
  const reporter = Object.freeze({ check,
    status: async message => {
      if (errors.length) return;
      try {
        if (typeof message !== 'string') throw new TypeError('Bootstrap summary requires original text.');
        const lines = stripVTControlCharacters(message.slice(0, 65536)).split(/\r\n|\r|\n/);
        for (const line of lines.slice(0, 32)) {
          const bytes = Buffer.from(line.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')); let end = Math.min(bytes.length, 2048);
          while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
          await writeBootstrapStatus(bytes.subarray(0, end).toString('utf8') + (end < bytes.length ? ' [status text truncated]' : ''), stderr, context);
        }
        if (message.length > 65536 || lines.length > 32) await writeBootstrapStatus('[bootstrap] additional status text truncated', stderr, context);
      } catch (error) { remember(error); }
    },
    raw: async (text, stream) => {
      if (errors.length) return;
      try {
        if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw new TypeError('Bootstrap diagnostic tail exceeds its original text bound.');
        await writeBootstrapText(text, stream, context);
      } catch (error) { remember(error); }
    }
  });
  let result, primary, failed = false;
  try { result = await operation(reporter); } catch (error) { primary = error; failed = true; }
  try { check(); }
  catch (logging) { primary = failed && primary !== logging ? addStorageFailureContext(primary, {}, logging, { secondaryPresent: true }) : logging; failed = true; }
  if (failed) throw primary;
  return result;
};
