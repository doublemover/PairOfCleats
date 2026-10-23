const fs = require('node:fs');
const path = require('node:path');

function boundedText(file, limit = 65536) {
  if (fs.statSync(file).size > limit) throw new Error('Repository identity metadata exceeds the editor bound.');
  return fs.readFileSync(file, 'utf8');
}

function readGitHead(root) {
  try {
    let git = path.join(root, '.git');
    if (fs.statSync(git).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(boundedText(git));
      if (!pointer) return null;
      git = path.resolve(root, pointer[1].trim());
    }
    const head = boundedText(path.join(git, 'HEAD')).trim();
    if (/^[a-f0-9]{40,64}$/i.test(head)) return head.toLowerCase();
    const ref = /^ref: (refs\/[a-zA-Z0-9._/-]+)$/.exec(head)?.[1];
    if (!ref || ref.split('/').some(part => part === '..' || part === '.')) return null;
    const roots = [git];
    try { roots.push(path.resolve(git, boundedText(path.join(git, 'commondir')).trim())); } catch {}
    for (const directory of roots) {
      try {
        const loose = boundedText(path.join(directory, ref)).trim();
        if (/^[a-f0-9]{40,64}$/i.test(loose)) return loose.toLowerCase();
      } catch {}
      try {
        const rows = boundedText(path.join(directory, 'packed-refs'), 4 * 1024 * 1024).split('\n');
        for (const row of rows) {
          const [hash, name] = row.trim().split(' ');
          if (name === ref && /^[a-f0-9]{40,64}$/i.test(hash)) return hash.toLowerCase();
        }
      } catch {}
    }
  } catch {}
  return null;
}

function validateServiceRoot(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.includes('\0') || (!path.posix.isAbsolute(raw) && !path.win32.isAbsolute(raw))) {
    throw new Error('Service repository must be an absolute path on the service host.');
  }
  if (raw.replace(/\\/g, '/').split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Service repository paths cannot contain traversal components.');
  }
  return raw;
}

function serviceRelativeFile(file, serviceRoot) {
  const raw = String(file || '');
  const flavor = /^[a-z]:[\\/]|^\\\\/i.test(serviceRoot) ? path.win32 : path.posix;
  const absolute = flavor.isAbsolute(raw);
  const relative = absolute ? flavor.relative(serviceRoot, raw) : raw;
  const normalized = relative.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes(':')
    || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('The service returned a source path outside the selected service repository.');
  }
  return normalized;
}

function mapServicePayload(payload, serviceRoot) {
  return { ...payload, ...Object.fromEntries(['code', 'prose', 'extractedProse', 'records'].map(section => [section,
    Array.isArray(payload?.[section]) ? payload[section].map(hit => ({ ...hit,
      file: serviceRelativeFile(hit.file, serviceRoot) })) : payload?.[section]
  ])) };
}

function verifyServiceRevision(status, expectedCommit) {
  const provenance = status?.coverage?.currentProvenance;
  const commit = provenance?.head?.commitId || provenance?.commit;
  if (!expectedCommit || !commit || String(commit).toLowerCase() !== expectedCommit.toLowerCase()) {
    throw new Error('Service source revision does not match this editor checkout. Select a matching checkout/service repository.');
  }
  if (provenance.dirty !== false) throw new Error('Service working tree is dirty or its clean state is unknown; source mapping cannot be qualified.');
  return { commit: String(commit).toLowerCase(), workingTree: 'editor-worktree-unverified' };
}

/** The same repository authority must survive each async status/consent wait.
 * A matching old service commit cannot qualify a newly checked-out editor root. */
function assertServiceMappingCurrent(repoContext, mapping, workspaceFolders) {
  const uri = repoContext.repoUri;
  const folder = (workspaceFolders || []).find(item => {
    if (item.uri?.scheme !== 'file' || !item.uri.fsPath) return false;
    if (repoContext.workspaceUri && item.uri.toString() !== repoContext.workspaceUri.toString()) return false;
    const relative = path.relative(item.uri.fsPath, repoContext.repoRoot);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  });
  if (!folder || uri?.scheme !== 'file' || mapping.editorUri !== uri.toString()
    || readGitHead(repoContext.repoRoot) !== mapping.commit) {
    throw new Error('Editor repository identity changed during service mapping. Select the repository again.');
  }
  validateServiceRoot(mapping.serviceRoot);
  return true;
}

module.exports = { readGitHead, validateServiceRoot, serviceRelativeFile, mapServicePayload, verifyServiceRevision, assertServiceMappingCurrent };
