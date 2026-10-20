# GNU Global (GTAGS) ingest

Use the GTAGS ingest tool to convert GNU Global cxref output into normalized JSONL.
Build the repository's GTAGS database with `gtags` before using `--run`.

## CLI

```bash
# Preferred wrapper route
pairofcleats ingest gtags --repo . --run

# Run an all-symbol query inside the repo
node tools/ingest/gtags.js --repo . --run

# Select references (use = when the argument string starts with a flag)
pairofcleats ingest gtags --repo . --run --args='-r alpha'

# Ingest from a file
node tools/ingest/gtags.js --repo . --input gtags.txt --out ./gtags.jsonl

# Read from stdin (default when --run is not used)
global -x --encode-path=' %' --color=never '.' | node tools/ingest/gtags.js --repo . --input -
```

## Options

- `--repo`: repo root used to resolve paths and the cache root (defaults to auto-detected repo root).
- `--input`: text file path or `-` for stdin. If omitted and `--run` is not set, stdin is used.
- `--run`: execute a cxref symbol query directly, using `.` when no query arguments are supplied.
- `--global`: global binary name (default: `global`).
- `--args`: search arguments, parsed by the shared CLI argument splitter. The ingester owns `-x`, `--result=ctags-x`, space/tab/percent path encoding and `--color=never`. Format overrides, non-symbol commands, directory overrides and context-dependent `--from-here` queries reject before starting the producer. Arguments after `--` remain literal query arguments.
- `--out`: output JSONL path (default: `<cacheRoot>/gtags/gtags.jsonl`).
- `--json`: emit the summary JSON to stdout instead of status lines.

## Output

- JSONL entries include: `file`, `ext`, `name`, `startLine`, `endLine`, `role`, `source` (`gtags`). File/stdin listings are definitions; explicit `--run` reference (`-r`) and symbol (`-s`) queries produce references.
- `<output>.meta.json`: summary with `generatedAt`, `repoRoot`, `input`, `output`, and `stats` (entries, errors).

## Notes

- The cxref columns are `name line file source-image`. Only the first three fields identify an occurrence; the optional source image can contain arbitrary spaces and punctuation. Older three-column listings and blank source images remain supported.
- Paths must percent-encode whitespace and literal percent signs. `--run` requests space, tab and percent encoding from GNU Global; the pipe example encodes spaces and percent signs. For paths containing tabs, include a literal tab in `--encode-path` too. Unescaped whitespace in a captured filename is ambiguous in cxref and cannot be recovered from source text.
- Paths decode exactly once and normalize relative to the repo root. Invalid encodings, NUL, escaping paths and invalid positive line numbers count as parse errors. Failed producer commands preserve the prior output and summary.
- The protocol fixtures include captured GNU Global 6.6.14 output from a real C index, including a space/percent filename and a reference query. The [GNU Global manual](https://www.gnu.org/software/global/manual/global.html) defines cxref and path encoding; argv fixtures separately verify command ownership.
