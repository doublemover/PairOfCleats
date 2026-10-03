import assert from 'node:assert/strict';
import { runNode } from '../../helpers/run-node.js';

export const assertMissingIngestInputFailsCleanly = ({
  cliPath,
  kind,
  repoRoot,
  missingInputPath,
  outPath
}) => {
  const result = runNode(
    [cliPath, 'ingest', kind, '--repo', repoRoot, '--input', missingInputPath, '--out', outPath, '--json'],
    `missing ${kind} ingest input`,
    process.cwd(),
    process.env,
    { stdio: 'pipe', allowFailure: true }
  );
  assert.notEqual(result.status, 0, 'expected missing input to fail');
  const output = `${result.stderr || ''}${result.stdout || ''}`;
  assert.equal(
    output.includes("Unhandled 'error' event"),
    false,
    'expected missing input failure to avoid unhandled stream error'
  );
  return result;
};
