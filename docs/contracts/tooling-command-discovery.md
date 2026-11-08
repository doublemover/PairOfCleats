# Tooling command discovery observations

One resolution attempt shares bounded candidate observations across scoped
directories, PATH, final selection and handshake admission. Regular-file kind,
discovered spelling, actual target path/stat identity, lookup origin/order and
platform launch kind remain distinct. A directory, broken link or known missing
execute permission cannot shadow a later eligible candidate in the authorized
scope. Explicit command paths retain their exact selection/failure.

POSIX candidates require the observed execute access check. Windows uses the
existing native `.exe` and command-shim `.cmd`/`.bat` routes; X_OK is not used as
a Windows permission proof. Existing suffixes stay exact and the existing CMD
invocation owner still handles the actual launch. Basic eligibility is advisory:
it does not verify PE bytes, version, protocol readiness, native lifetime or
guarantee that a later launch succeeds.

The attempt observes at most 4,096 distinct candidates and exports at most 64
diagnostic observations plus its selected candidate. Complete bounded counters,
not a truncated diagnostic prefix, classify absence versus ineligible/unknown.
Empty PATH, inaccessible observations and exhausted admission remain unknown;
no global machine absence is inferred. Known denied execution policy remains a
denial and cannot select another installation. Original unknown resource failures
propagate before diagnostic inspection. No durable eligibility cache is added.

Profiles and handshakes return classified selection failures without a fabricated
spawn attempt. Actual launch/probe failures and the existing managed-client,
process and trust owners remain authoritative. Probe/profile identity retains
the selected path; a new resolution observes replacement or permission changes
before consulting probe success caches. Broader tool-byte/profile identity remains
its existing separate contract.

Internal read-only selection and real command preflight share this discovery and
policy owner. Eligible read-only selection has `probe.ok: null` and no attempted
probes; it launches no child. Operator commands resolve relative PATH/explicit
inputs against their selected repository cwd and retain an absolute selected
path before the existing trust checks. Selection does not authorize execution.

Actual filesystem candidate controls and real profile/handshake consumers with
intercepted benign launch boundaries are authored and unrun. Link cases inject
metadata and create no symlinks; they do not qualify physical-link behavior.
The existing binary parity fixture now gives its POSIX positive file execute
permission rather than treating plain text existence as launch eligibility.
Scoped formatting and whitespace checks are the only validation for this batch.
