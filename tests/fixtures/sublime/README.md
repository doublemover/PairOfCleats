# Explicit Sublime host qualification

This Windows qualification starts an actual editor on a private Windows desktop.
It is outside automatic test discovery and requires both a case and an explicit
installed runtime:

```powershell
node tests/fixtures/sublime/native-package-host.js --case packed --host-dir 'C:\Program Files\Sublime Text'
```

The other cases are `unpacked` and `legacy-and-shadow`. Run cases serially. Each
case has a bounded deadline, copies the selected runtime into its own test-cache
profile, uses fixture-only settings and project data, and shuts down its own
host. It does not select or terminate an existing editor session. The launcher
assigns the actual GUI process to its private desktop, checks that its windows
stay off the input desktop, and closes its owned desktop handle after settlement.
It never switches desktops or changes security settings. There is no fallback to
the user's desktop. The background flag alone does not provide this isolation.
Do not include this command in a headless test cohort.

Before using the GUI owner on a new Windows launch, explicitly run
`tests/fixtures/windows/private-desktop-host.ps1` with a fresh disposable
`-FixtureRoot` directory. Its observer child confirms desktop assignment before
its window child can create a real visible-style window. It requires that window
on the private desktop, absent from the input desktop, followed by successful
child exit and desktop closure. The separate `private-desktop-capability.ps1`
probe creates no application or window and cannot replace this control.

The ordinary qualification probe uses the package's default Python environment;
putting it in `User` would select the newest interpreter instead. The probe
observes native loading and registration without importing or activating the
target plugin. The fixture uses canonical published index artifacts and verifies
the same search queries through the real CLI before invoking native commands.
It does not qualify a full index build. The observer is ready before it opens the
explicit fixture project in the same instance. Each RPC uses distinct immutable
request/response files, avoiding replacement of a file held open by Windows.

Current status: the Windows build 4192 packed-host control demonstrated zero
registered commands before the root export repair, then 61 afterward. Native
search, update/reload, uninstall, unpacked and shadowing acceptance are still
pending. Native thread stacks exposed an operation-lock/UI-callback deadlock;
the repair and five bounded headless controls preserve epoch and request fences
while moving editor API reads outside shared locks. The latest private-desktop
packed run stayed responsive but observed a revoked search epoch and no result.
The event causing that revocation still needs attribution. No retry or larger
deadline counts as passing evidence. Preserve the raw failures when continuing.
The headless `tooling/sublime/root-command-registration` fixture covers root
discovery in CI; `operation-context-lock` covers the lock cycle. Ordinary Sublime
fixtures and their CLI/Python children request no console windows. The minimum
runtime fixture checks the actual Windows child's console handle as well as
Python 3.3's missing exported `CREATE_NO_WINDOW` constant.

See the [native API environments](https://www.sublimetext.com/docs/api_environments.html)
and [command-line interface](https://www.sublimetext.com/docs/command_line.html).
Desktop assignment follows Microsoft's
[STARTUPINFO desktop field](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-startupinfow).
