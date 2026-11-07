# Native reader original observations — 2026-10-27

**Unvalidated source:** `cd2583658aa29fba7c137f9d0b3d967abbb290c0`, tree
`590e9327763a3adca6266c94d65abad4b3967f37`. Windows x64, Node 26.12.1,
branch `codex/pr557-audit-repairs-20261012`. Not pushed or functionally qualified.

The native-reader admission owner caught and discarded failed-open observation
errors before retaining the original failure again. That could lose independent
pending work thrown by the first observer or adopt a different callback from a
later getter. Its stored boolean observations also needed the existing common
composer's retention of independently thrown observer errors.

Failed-open handling now retains the first captured observation and its exact
inspection failure. Stored error and physical-close observations use the existing
storage composer, preserving original callbacks/receivers and independent work
across later boolean checks. The same native-reader/session owner still controls
metadata release. No new backend registration, native disposal, deletion or
recovery authority is introduced.

Five **unexecuted** `shared/storage/native-reader-observation/*` cases use actual
canonical category/resource leases and inert native-open/close controls. They
cover ordinary failed-open cleanup, independently pending open observers,
first-callback capture, retained error observers and physical-close observer
failure. Existing real SQLite/cache/LMDB reader qualifications remain required
against the resulting candidate; earlier green receipts qualify their own heads.

Format/ESLint, changed JavaScript syntax, config budget, generated command
inventory and whitespace checks pass. No functional case, native addon, child,
benchmark or publication gate ran. #1574/#1267 custom/backend/category adoption
and full qualification remain. These source defects do not attribute an access
violation or establish native runtime acceptance.
