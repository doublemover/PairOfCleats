import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';

export const runIdleActivityProbeScenario = async ({
  label,
  expectedOkMessage,
  makeActivityProbe
}) => {
  ensureTestingEnv(process.env);

  const captured = [];
  let probeCount = 0;
  const runner = createProcessRunner({
    appendLog: (line) => {
      if (line) captured.push(String(line));
    },
    writeLog: () => {},
    writeLogSync: () => {},
    logHistory: [],
    logPath: null,
    getLogPaths: () => [],
    onProgressEvent: () => {},
    sampleProcessActivity: (pid) => makeActivityProbe(pid, () => {
      probeCount += 1;
      return probeCount;
    })
  });

  const result = await runner.runProcess(
    label,
    process.execPath,
    ['-e', 'setTimeout(() => process.exit(0), 2300);'],
    {
      continueOnError: true,
      idleTimeoutMs: 900,
      timeoutMs: 6000
    }
  );

  return {
    captured,
    expectedOkMessage,
    label,
    probeCount,
    result
  };
};
