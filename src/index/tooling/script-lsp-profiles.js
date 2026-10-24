import path from 'node:path';

/** Canonical preset definitions for import by the existing LSP preset owner.
 * These are explicit experimental launch contracts, not installer recipes or
 * version qualifications. Actual executable/runtime closure remains observed. */
export const SCRIPT_LSP_PRESET_DEFINITIONS = Object.freeze({
  'bash-language-server': Object.freeze({ id: 'bash-language-server', cmd: 'bash-language-server', args: Object.freeze(['start']),
    languages: Object.freeze(['shell', 'bash', 'sh']), label: 'Bash/POSIX shell (explicit experimental navigation profile)',
    explicitOnly: true, profileContractVersion: 1, priority: 80, preflightPolicy: 'optional',
    hoverEnabled: false, signatureHelpEnabled: false, typeDefinitionEnabled: false,
    initializationOptions: Object.freeze({ explainshellEndpoint: '', backgroundAnalysisMaxFiles: 0,
      includeAllWorkspaceSymbols: false, shellcheckPath: '', shellcheckExternalSources: false,
      shfmt: Object.freeze({ path: '', ignoreEditorconfig: true }) }) }),
  'perl-navigator': Object.freeze({ id: 'perl-navigator', cmd: 'perlnavigator', args: Object.freeze(['--stdio']),
    languages: Object.freeze(['perl']), label: 'Perl (Perl Navigator, explicit experimental navigation profile)',
    explicitOnly: true, profileContractVersion: 1, priority: 80, preflightPolicy: 'required', requiresWorkspaceExecution: true,
    hoverEnabled: false, signatureHelpEnabled: false, typeDefinitionEnabled: false,
    preflightRuntimeRequirements: Object.freeze([Object.freeze({ id: 'perl', cmd: 'perl', args: Object.freeze(['--version']), label: 'Perl interpreter' })]),
    initializationOptions: Object.freeze({ settings: Object.freeze({ perlnavigator: Object.freeze({
      perlCompileEnabled: false, perlcriticEnabled: false, perlimportsLintEnabled: false, perlimportsTidyEnabled: false,
      perltidyEnabled: false, includeLib: false, includePaths: Object.freeze([]), perlEnvAdd: false
    }) }) }) })
});

export const SCRIPT_LSP_PRESET_ALIASES = Object.freeze({
  'bash-language-server': 'bash-language-server', bashls: 'bash-language-server',
  'perl-navigator': 'perl-navigator', perlnavigator: 'perl-navigator'
});

/** Filter before preflight/launch as well as before document opening. Shell's
 * broad extension route cannot qualify zsh/ksh for the Bash language server. */
export const admitScriptLspInputs = ({ serverId, inputs }) => {
  const documents = Array.isArray(inputs?.documents) ? inputs.documents : [], targets = Array.isArray(inputs?.targets) ? inputs.targets : [];
  if (serverId !== 'bash-language-server') return { ...inputs, documents, targets, checks: [] };
  const rejected = [], admitted = [];
  for (const document of documents) {
    const filename = document.containerPath || document.virtualPath || '', extension = String(document.effectiveExt || path.extname(filename)).toLowerCase();
    const firstLine = typeof document.text === 'string' ? document.text.split(/\r?\n/u, 1)[0].replace(/^\uFEFF/u, '') : '';
    let dialect = extension === '.bash' ? 'bash' : extension === '.sh' ? 'shell-unspecified' : null;
    if (firstLine.startsWith('#!')) {
      const interpreter = firstLine.slice(2).trim().split(/\s+/u);
      let executable = path.posix.basename(interpreter[0]?.replaceAll('\\', '/') || '');
      if (executable === 'env') {
        const tokens = interpreter.slice(1).filter(value => !value.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(value));
        executable = path.posix.basename(tokens[0] || '');
      }
      if (executable === 'bash') dialect = 'bash';
      else if (['sh', 'dash'].includes(executable)) dialect = 'posix-sh';
      else dialect = null;
    }
    if (!dialect || ['.zsh', '.ksh'].includes(extension) || typeof document.virtualPath !== 'string' || !document.virtualPath) {
      rejected.push({ path: filename, reason: 'unsupported_shell_dialect' }); continue;
    }
    admitted.push({ ...document, scriptDialect: dialect });
  }
  const paths = new Set(admitted.map(document => document.virtualPath));
  return { ...inputs, documents: admitted, targets: targets.filter(target => paths.has(target.virtualPath)),
    checks: rejected.length ? [{ name: 'bash_lsp_unsupported_dialects', status: 'warn',
      message: 'Bash navigation excluded documents outside the admitted Bash/POSIX shell dialects.', details: { rejected } }] : [] };
};
