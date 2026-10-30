/** Explicit simulated complete output for SCM adapter fixtures. This describes
 * supplied fixture bytes only; it is not a native command/readiness receipt. */
export const completeScmFixtureOutput = (stdout = '', fields = {}) => {
  const bytes = Buffer.byteLength(stdout, 'utf8');
  return { exitCode: 0, signal: null, stdout, stderr: '', outputCapture: { stdout: {
    enabled: true, observedBytes: bytes, retainedBytes: bytes, droppedBytes: 0, outputBytes: bytes,
    encodingLoss: false, truncated: false
  } }, ...fields };
};
