# Native settings draft and effective validation recovery

Native edit drafts remain volatile and are bound to the selected scope, field,
repository revision and schema revision. Syntax errors, canonical schema
rejection, effective retrieval guardrail rejection and transient preview failures
retain the draft for correction. They grant no save token. Stale input requires
reload and a fresh canonical preview. Explicit discard, scope changes and
successful saves clear the draft; drafts do not enter persisted layouts or logs.

The settings owner resolves proposed effective configuration through the existing
source loader and trust policy, then calls the retrieval owner's canonical
operational guardrails. Search and settings share those defaults and validation.
The editor neither duplicates constraints nor initializes retrieval backends.
Commit rechecks the effective combination and the selected field's current
authority immediately before publication, including trust changes that do not
change repository bytes. Rejected authority invalidates the old token.

Ordinary fields retain one-field editing. The canonical `retrieval` object also
has an explicit repository-object editor. This allows a valid atomic repair when
minimum, maximum and candidate cap are mutually inconsistent and every
single-field intermediate fails. Its schema is the actual canonical retrieval
schema. The editor starts from repository overrides, or an empty object when no
override exists; it never copies an effective trusted/default layer into the
repository simply to open that editor.

The object editor uses the existing edit request and preview/confirmation token.
It replaces only the reviewed repository object, applying at most 256 differing
property operations so unchanged member comments and unrelated configuration
remain intact. The existing request, depth, byte, sensitive-value, containment,
stale-revision and publication checks remain in force. It does not expose a
generic parent editor for execution or storage authority objects.

The actual settings producer/save and Rust draft-consumer regressions are authored
for the frozen validation run. They do not constitute native terminal, race or
platform qualification until executed against that candidate.
