# Explicit Sublime host qualification

This Windows qualification opens actual editor windows. It is outside automatic
test discovery and requires both a case and an explicit installed runtime:

```powershell
node tests/fixtures/sublime/native-package-host.js --case packed --host-dir 'C:\Program Files\Sublime Text'
```

The other cases are `unpacked` and `legacy-and-shadow`. Run cases serially. Each
case has a bounded deadline, copies the selected runtime into its own test-cache
profile, uses fixture-only settings and project data, and shuts down its own
host. It does not select or terminate an existing editor session. The background
flag does not guarantee invisible windows. Do not include this command in a
headless test cohort.

The ordinary qualification probe uses the package's default Python environment;
putting it in `User` would select the newest interpreter instead. The probe
observes native loading and registration without importing or activating the
target plugin. The fixture uses canonical published index artifacts and verifies
the same search queries through the real CLI before invoking native commands.
It does not qualify a full index build.

Current status: the Windows build 4192 packed-host control demonstrated zero
registered commands before the root export repair, then 61 afterward. Native
search, update/reload, uninstall, unpacked and shadowing acceptance are still
pending; the last packed run stopped waiting for a search result. This fixture
is an unfinished qualification owner, not passing evidence. Preserve its raw
failure receipts when continuing diagnosis. The headless
`tooling/sublime/root-command-registration` fixture covers root discovery in CI.

See the [native API environments](https://www.sublimetext.com/docs/api_environments.html)
and [command-line interface](https://www.sublimetext.com/docs/command_line.html).
