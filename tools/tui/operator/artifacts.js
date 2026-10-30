import fs from 'node:fs/promises';
import path from 'node:path';
import { assertTuiArtifactRequest } from '../../../src/contracts/validators/tui-artifact.js';
import { assertNoSymlinkPath, verifyContainedFileHandle, readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { atomicWriteText } from '../../../src/shared/io/atomic-write.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { resolveTrustedTuiCommand, runTrustedTuiCommand } from './command.js';
import { createOwnedCleanupRetirements, ownedCleanupIsPending } from './settle-owned.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const clipboardNames = () => process.platform === 'win32' ? ['powershell']
  : process.platform === 'darwin' ? ['pbcopy'] : ['wl-copy', 'xclip'];
const clipboardArgs = name => name === 'powershell' ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
  '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())']
  : name === 'xclip' ? ['-selection', 'clipboard'] : [];

/** Side effects only act on current, reverified collector selections. */
export const createTuiArtifactActions = ({ registry, toolRoot, env = process.env }) => {
  const controllers = new Set(), work = new Set();
  const retirements = createOwnedCleanupRetirements();
  let disposed = false;
  const execute = async (method, request, { signal, onSpawn } = {}) => {
    assertTuiArtifactRequest(method, request);
    if (disposed) fail('ERR_TUI_ARTIFACT_SESSION', 'Artifact session is closed.');
    retirements.assertSettled();
    if (work.size) fail('ERR_TUI_ARTIFACT_BUSY', 'An artifact action is already running.');
    const controller = new AbortController();
    controllers.add(controller);
    const linked = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const operation = (async () => {
      const selected = await registry.resolve(request, { signal: linked });
      const { pin, read, signal: scopedSignal } = selected;
      const verify = async () => { await registry.resolve(request, { signal: scopedSignal }); };
      if (method === 'open' || method === 'copy') {
        const prefix = method === 'open' ? 'ERR_TUI_EDITOR' : 'ERR_TUI_CLIPBOARD';
        const command = await resolveTrustedTuiCommand({ names: method === 'open' ? ['code'] : clipboardNames(),
          repoRoot: pin.repoRoot, toolRoot, env, prefix });
        const args = method === 'open' ? ['--reuse-window', pin.target] : clipboardArgs(command.name);
        await runTrustedTuiCommand({ selected: command, args, repoRoot: pin.repoRoot, env,
          signal: scopedSignal, onSpawn, prefix, beforeSpawn: verify,
          input: method === 'copy' ? pin.target : undefined });
        return { [method === 'open' ? 'opened' : 'copied']: true,
          sourceJobId: request.sourceJobId, artifactId: request.artifactId };
      }
      if (pin.type !== 'file') fail('ERR_TUI_ARTIFACT_TYPE', 'Only a verified file can be exported.');
      const destination = path.resolve(pin.repoRoot, request.destination);
      assertNoSymlinkPath(pin.repoRoot, destination, { allowMissing: true });
      const parent = path.dirname(destination), parentStat = await fs.stat(parent, { bigint: true });
      if (!parentStat.isDirectory()) fail('ERR_TUI_ARTIFACT_DESTINATION', 'Choose an existing destination directory.');
      const verifyDestination = async (handle, tempPath) => {
        assertNoSymlinkPath(pin.repoRoot, destination, { allowMissing: true });
        const current = await fs.stat(parent, { bigint: true });
        if (current.dev !== parentStat.dev || current.ino !== parentStat.ino) {
          fail('ERR_FILE_CHANGED', 'Destination directory changed.');
        }
        verifyContainedFileHandle(handle, pin.repoRoot, tempPath);
      };
      throwIfAborted(scopedSignal);
      try {
        await atomicWriteText(destination, read.buffer, { mkdir: false, mode: 0o600, newline: false,
          signal: scopedSignal, createOnly: true, verifyStaging: verifyDestination,
          beforeCommit: async (handle, tempPath) => { await verify(); await verifyDestination(handle, tempPath); },
          verifyPublished: async (handle, target) => {
            // Publication has committed: a late cancellation cannot turn a
            // completed effect into a cancelled result. Verification is bounded.
            await verifyDestination(handle, target);
            const opened = await handle.stat({ bigint: true });
            await readVerifiedContainedFile(pin.repoRoot, target, { maxBytes: read.buffer.length,
              expectedBytes: read.buffer.length, expectedHash: read.hash,
              expectedFileIdentity: { dev: opened.dev.toString(), ino: opened.ino.toString() } });
            await verifyDestination(handle, target);
          } });
      } catch (error) {
        retirements.capture(error);
        if (ownedCleanupIsPending(error)) throw error;
        if (error.causeCode === 'EEXIST') fail('ERR_TUI_ARTIFACT_DESTINATION_EXISTS', 'Destination exists; choose a new filename.');
        throw error;
      }
      return { exported: true, bytes: read.buffer.length, sha256: read.hash,
        sourceJobId: request.sourceJobId, artifactId: request.artifactId };
    })().catch(error => { throw retirements.capture(error); });
    work.add(operation);
    try { return await operation; }
    finally { controllers.delete(controller); work.delete(operation); }
  };
  return { execute, async dispose() {
    disposed = true;
    for (const controller of controllers) controller.abort();
    await Promise.allSettled([...work]);
    retirements.assertSettled();
  } };
};
