# CLI Completions

PairOfCleats can generate shell completions directly from the canonical command registry.

## Generate completions

- PowerShell: `pairofcleats cli completions --shell powershell`
- bash: `pairofcleats cli completions --shell bash`
- zsh: `pairofcleats cli completions --shell zsh`

## Load into the current shell

- PowerShell: `pairofcleats cli completions --shell powershell | Out-String | Invoke-Expression`
- bash: `eval "$(pairofcleats cli completions --shell bash)"`
- zsh: `eval "$(pairofcleats cli completions --shell zsh)"`

## Persist across sessions

- PowerShell: append the generated script to your PowerShell profile.
- bash: source the generated output from your shell profile or a file under `~/.bash_completion.d/`.
- zsh: source the generated output from your `.zshrc` or a completion file on your `fpath`.

## Self-audit

Use `pairofcleats cli audit` to validate that the local command surface, generated command docs, help output, and runtime capability manifest stay aligned.
