import { listCommandRegistry } from './command-registry.js';

export const SUPPORTED_COMPLETION_SHELLS = Object.freeze(['bash', 'powershell', 'zsh']);

const SPECIAL_ROOT_TOKENS = Object.freeze(['help', 'help-all', 'version', '--help', '--help-all', '--version']);
const HELP_TOPIC_TOKENS = Object.freeze(['--all']);

const quoteShellWord = (value) => String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const quoteSingleQuotedShellWord = (value) => String(value || '').replace(/'/g, `'\\''`);
const quotePowerShellSingle = (value) => String(value || '').replace(/'/g, "''");

const sortedUnique = (values) => Array.from(new Set(
  values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
)).sort((left, right) => left.localeCompare(right));

export function buildCompletionIndex() {
  const registry = listCommandRegistry({
    supportTiers: ['stable', 'operator', 'internal', 'experimental']
  });
  const index = new Map();

  const addCandidates = (key, values) => {
    const existing = index.get(key) || [];
    index.set(key, sortedUnique([...existing, ...values]));
  };

  addCandidates('', SPECIAL_ROOT_TOKENS);
  addCandidates('help', HELP_TOPIC_TOKENS);

  for (const entry of registry) {
    const path = entry.commandPath.slice();
    if (!path.length) continue;
    addCandidates('', [path[0]]);
    addCandidates('help', [path[0]]);
    for (let i = 0; i < path.length - 1; i += 1) {
      addCandidates(path.slice(0, i).join(' '), [path[i]]);
      addCandidates(path.slice(0, i + 1).join(' '), [path[i + 1]]);
    }
  }

  return Object.fromEntries(
    Array.from(index.entries()).sort(([left], [right]) => left.localeCompare(right))
  );
}

export function renderBashCompletion(index = buildCompletionIndex()) {
  const lines = [
    '# shellcheck shell=bash',
    '__pairofcleats_complete() {',
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local -a prefix=()',
    '  local token=""',
    '  local key=""',
    '  local candidates=""',
    '  local i=0',
    '  declare -A tree=()'
  ];
  for (const [key, values] of Object.entries(index)) {
    lines.push(`  tree["${quoteShellWord(key)}"]="${values.map(quoteShellWord).join(' ')}"`);
  }
  lines.push(
    '  for ((i=1; i<COMP_CWORD; i++)); do',
    '    token="${COMP_WORDS[i]}"',
    '    [[ "$token" == -* ]] && continue',
    '    prefix+=("$token")',
    '  done',
    '  key="${prefix[*]}"',
    '  candidates="${tree[$key]}"',
    '  COMPREPLY=($(compgen -W "$candidates" -- "$cur"))',
    '}',
    'complete -F __pairofcleats_complete pairofcleats'
  );
  return `${lines.join('\n')}\n`;
}

export function renderZshCompletion(index = buildCompletionIndex()) {
  const lines = [
    '#compdef pairofcleats',
    'typeset -A _pairofcleats_tree'
  ];
  for (const [key, values] of Object.entries(index)) {
    lines.push(`_pairofcleats_tree['${quoteSingleQuotedShellWord(key)}']='${quoteSingleQuotedShellWord(values.join(' '))}'`);
  }
  lines.push(
    '',
    '_pairofcleats() {',
    '  local -a prefixTokens candidates',
    '  local rawCandidates=""',
    '  local token=""',
    '  local key=""',
    '  local i=0',
    '  for ((i=2; i<CURRENT; i++)); do',
    '    token="${words[i]}"',
    '    [[ "$token" == -* ]] && continue',
    '    prefixTokens+=("$token")',
    '  done',
    '  key="${(j: :)prefixTokens}"',
    '  rawCandidates="${_pairofcleats_tree[$key]}"',
    '  candidates=(${=rawCandidates})',
    "  _describe 'command' candidates",
    '}',
    'compdef _pairofcleats pairofcleats'
  );
  return `${lines.join('\n')}\n`;
}

export function renderPowerShellCompletion(index = buildCompletionIndex()) {
  const lines = [
    '$PairOfCleatsCompletionTree = @{'
  ];
  for (const [key, values] of Object.entries(index)) {
    const renderedValues = values.map((value) => `'${quotePowerShellSingle(value)}'`).join(', ');
    lines.push(`  '${quotePowerShellSingle(key)}' = @(${renderedValues})`);
  }
  lines.push(
    '}',
    '',
    "Register-ArgumentCompleter -CommandName 'pairofcleats' -ScriptBlock {",
    '  param($commandName, $wordToComplete, $commandAst, $cursorPosition)',
    '  $tokens = @()',
    '  foreach ($element in @($commandAst.CommandElements | Select-Object -Skip 1)) {',
    '    $text = [string]$element.Extent.Text',
    "    if ($text.StartsWith('-')) { continue }",
    '    $tokens += $text',
    '  }',
    "  if ($wordToComplete -and $tokens.Count -gt 0 -and $tokens[-1] -eq $wordToComplete) {",
    '    if ($tokens.Count -eq 1) {',
    '      $tokens = @()',
    '    } else {',
    '      $tokens = $tokens[0..($tokens.Count - 2)]',
    '    }',
    '  }',
    "  $key = if ($tokens.Count -gt 0) { [string]::Join(' ', $tokens) } else { '' }",
    '  $candidates = $PairOfCleatsCompletionTree[$key]',
    '  if (-not $candidates) { return }',
    '  foreach ($candidate in $candidates) {',
    "    if ($candidate -notlike \"$wordToComplete*\") { continue }",
    "    [System.Management.Automation.CompletionResult]::new($candidate, $candidate, 'ParameterValue', $candidate)",
    '  }',
    '}'
  );
  return `${lines.join('\n')}\n`;
}

export function renderShellCompletion(shell, index = buildCompletionIndex()) {
  const normalizedShell = String(shell || '').trim().toLowerCase();
  if (normalizedShell === 'bash') return renderBashCompletion(index);
  if (normalizedShell === 'powershell') return renderPowerShellCompletion(index);
  if (normalizedShell === 'zsh') return renderZshCompletion(index);
  throw new Error(
    `Unsupported shell: ${shell}. Expected one of ${SUPPORTED_COMPLETION_SHELLS.join(', ')}.`
  );
}
