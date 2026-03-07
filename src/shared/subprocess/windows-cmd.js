/**
 * Quote one argument for Windows `cmd.exe` command-line execution.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const quoteWindowsCmdArg = (value) => {
  const text = String(value ?? '');
  if (!text) return '""';
  if (!/[\s"&|<>^();]/u.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
};

/**
 * Build a command line string suitable for `cmd.exe /c`.
 *
 * @param {string} cmd
 * @param {Array<string>} [args]
 * @returns {string}
 */
export const buildWindowsShellCommand = (cmd, args = []) => (
  [cmd, ...(Array.isArray(args) ? args : [])]
    .map(quoteWindowsCmdArg)
    .join(' ')
);
