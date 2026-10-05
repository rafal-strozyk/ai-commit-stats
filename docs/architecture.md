# Architecture

Status: design in progress. Requirements below are agreed; the automatic commit
mechanism remains unproven. See [decisions](decisions.md) and
[investigation](investigation.md).

## User experience

JetBrains and VS Code integrations expose **Install AI Commit Stats in this
repository**, followed by Status, Repair, and Uninstall actions. Setup detects
compatible existing dependencies, provisions missing ones, explains Git AI's
shared agent configuration, and checks readiness. Required agent or IDE restarts
must be reported; installing a binary alone does not prove attribution works.

Activation applies to the local repository checkout, not every clone of the
remote repository. Git AI's attribution setup may track other repositories;
AI Commit Stats must only update messages in repositories explicitly enabled.

The feature covers IDE and terminal commits and continues working when the
editor is closed. This rules out relying solely on editor commit callbacks.

## Components and intended layout

```text
packages/
  core/                 # Git AI client, statistics, trailers, Git operations
  cli/                  # Commands, repository setup, status and recovery
editors/
  jetbrains/            # Kotlin plugin
  vscode/               # TypeScript extension
tests/
  fixtures/             # Version-labelled Git AI JSON samples
  integration/          # Disposable-repository tests
docs/
  architecture.md
  decisions.md
  investigation.md
```

This is a target layout; implementation directories will be created when they
contain actual code or fixtures.

Both core and CLI use TypeScript. JetBrains invokes the CLI as a subprocess;
VS Code uses the same CLI interface. Attribution and message rewriting belong in
the shared core. CLI responses to editor integrations use structured JSON.

Ship the CLI as a standalone executable containing its runtime. Persist shared
executables in a user-level application directory so terminal operations do not
depend on a running editor or its temporary files. Repository activation and
operational state stay local and are not committed as binaries or setup files.
Exact storage paths, packaging toolchain, and supported platform matrix remain
to be validated.

Git AI remains the attribution engine. AI Commit Stats consumes its statistics;
it does not infer authorship from code or reproduce Git AI's line tracking.

## Commit and push requirements

Annotation may finish shortly after commit creation. It must target an explicit
commit identity and preserve its tree, parents, author identity, staged changes,
and working files. A message amendment creates a new SHA and needs attribution
preserved for that resulting commit. Signing behavior must be validated.

Push coordination must prevent selected commits from being published while
annotation is pending or has failed. Waiting alone is insufficient: Git may have
already selected the old SHA for a push. The eventual implementation must check
the selected push objects and either complete safely or abort with a retry
instruction. It must also account for explicit SHA pushes, concurrent Git
commands, recursion, existing hooks, and worktrees. The precise mechanism is
still under investigation; this is not an implemented guarantee.

If attribution or annotation fails, keep the original commit and message. Emit
a clear terminal diagnostic and expose the failure in editor status. Provide a
copyable command to retry the affected commit, including the repository and
expected SHA. Never present missing attribution as zero AI usage or confirmed
human authorship. Uninstallation must not silently remove a shared Git AI
installation used elsewhere.

## Proposed CLI and statistics

Expose both `ai-commit-stats` and the short command `acs` with identical arguments
and behavior. Install `acs` as an executable entry point, not a shell alias, so it
works across shells and in subprocesses. Prefer `acs` in user-facing examples and
copyable retry commands. Editor integrations and Git automation use an absolute
managed executable path rather than relying on the user's PATH. Setup must make
the short command available in terminals and report any existing command-name
collision instead of overwriting it.

These interfaces are proposals, not commands available today:

```text
acs inspect --repo <path> --commit <sha> --json
acs annotate --repo <path> --expected-head <sha> --json
acs install --repo <path>
acs status --repo <path> --json
acs repair --repo <path>
acs uninstall --repo <path>
```

Start explicit annotation with the current HEAD; never silently annotate a
different commit if HEAD has moved. Historical recovery needs a separate design
before support can be promised. Generated retry instructions must quote paths
for the user's shell and explain an expected-HEAD mismatch.

The proposed footer has version, AI-added, human-added, unknown-added, and
AI-share-added trailers. Preserve unrelated message content and trailers;
repeated annotation must not duplicate the footer. The intended percentage is
AI additions divided by additions counted under Git AI's effective filtering,
with `N/A` for zero additions. Exact trailer names and filtering compatibility
will be finalized against versioned fixtures.
