const quote = value => `'${String(value).replaceAll("'", "''")}'`;

/** Structured argv is authoritative. Copy text explicitly names its shell;
 * neither ambient cwd nor shell interpretation supplies a repository target. */
export const createIndexRepairAction = ({ root, mode, backend, indexRoot }) => {
  const argv = backend === 'lmdb'
    ? ['lmdb', 'build', '--repo', root, '--mode', mode, '--index-root', indexRoot]
    : ['index', 'build', '--repo', root, '--mode', mode, '--stage', backend === 'sqlite' ? '4' : '2',
      ...(backend === 'sqlite' ? ['--index-root', indexRoot] : ['--no-sqlite'])];
  return { operation: 'build', repository: root, modes: [mode], backend,
    observedIndexRoot: indexRoot, executable: 'pairofcleats', argv, cwd: null,
    effects: backend === 'files' ? ['publishes-new-current-generation', 'rebuilds-file-artifacts'] : [`rebuilds-${backend}`],
    shell: 'powershell', command: `& ${['pairofcleats', ...argv].map(quote).join(' ')}` };
};
