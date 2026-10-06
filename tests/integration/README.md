# Commit workflow experiment

This feasibility experiment now also exercises the separately compiled ACS core
and CLI. Its prototype hooks are not an installer or production push protection.
A passing report includes negative controls that deliberately
publish unannotated commits to a disposable local remote or amend the wrong
disposable commit. Do not copy its hooks or amendment implementation into an
enabled repository.

## Reproduce

The recorded run uses unmodified Git AI v1.7.5 source at revision
`f67fe0d732dfebf6bc229ad7c784e3a8a2d42a66`, built with `test-support`.
Build it outside this repository, with Rust and Cargo installed:

```sh
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 git clone \
  --depth 1 --branch v1.7.5 https://github.com/git-ai-project/git-ai.git \
  /tmp/acs-git-ai-v1.7.5
git -C /tmp/acs-git-ai-v1.7.5 rev-parse HEAD
CARGO_TARGET_DIR=/tmp/acs-git-ai-target cargo build --locked \
  --manifest-path /tmp/acs-git-ai-v1.7.5/Cargo.toml \
  --features test-support --bin git-ai
```

Check that the printed revision matches the revision above. From this repository:

```sh
pnpm experiment:commit-workflow /tmp/acs-git-ai-target/debug/git-ai /tmp/acs-report.json
```

The optional second argument writes a report, including on scenario failure
when cleanup succeeds. Do not replace the archived report unless the complete
experiment passes. Reports record the executable checksum, runtime versions,
checks and observations. Source provenance is documented here; the executable
does not attest its source revision.

The experiment currently requires Unix, `/usr/bin/git`, `/usr/bin/ssh-keygen`,
and permission to bind local Unix sockets. It was verified on macOS arm64 only.
The first sandboxed attempt failed at socket binding; that does not indicate an
attribution failure. Use an execution environment that permits these sockets.
An ordinary Git AI release binary is unsuitable: the harness requires verified
test-support configuration overrides to isolate state.

Each run creates and removes disposable repositories, a local bare remote,
temporary HOME, databases, sockets, signing keys, and hooks. It disables system
and global Git configuration, remote API access, telemetry and updates in its
test environment. It checks that the user's Git configuration, Git AI
configuration, and Git AI identity file remain unchanged. No user agent setup
or project history is modified. Owned workers and the daemon are reaped.

## What the checks establish

- Mixed mock checkpoints give two AI additions and one human addition in a
  partial commit; an unstaged addition is excluded.
- Message amendment preserves the tested tree, parents, author, index, staged
  content and working files; attribution transfers and repeat annotation is
  idempotent. Empty commits use `N/A`. A temporary SSH signature verifies.
- A guard aborts pending publication, rejects the explicitly pushed original SHA,
  and permits retry with the amended SHA. Failed calculation permits push with
  warning and retry instructions under the updated policy. Remote refs are checked.
- Missing notes, invalid JSON, negative or inconsistent counts, subprocess
  failure, unavailable daemon and worker readiness timeout remain failures.
- Default lockfile filtering, `.git-ai-ignore`, `.gitattributes` and explicit
  ignore patterns use the same filtered additions for numerator and denominator.
- A linked worktree can be annotated without modifying the main worktree.
- The compiled core uses prepared commit objects and an atomic branch/state
  transaction with real Git AI notes. It preserves complete attribution,
  staged/working data, a verifiable SSH signature and mixed filtered statistics.

The experiment also reproduces failures of proposed mechanisms:

- `await` inside `post-commit` times out; it succeeds after the outer commit ends.
- With worker Git commands observed as independent Trace2 roots, annotation and
  readiness inside `pre-push` complete, but Git still sends the SHA selected
  before amendment, rather than the new HEAD. Workers remove the inherited
  `GIT_TRACE2_PARENT_SID`; retaining it with nesting zero prevented observation
  of the nested amendment during initial development attempts.
- A concurrent commit after the final HEAD check receives the wrong message and
  stale statistics. Checking HEAD before `git commit --amend` is not atomic.
- Replacing one pending state entry forgets the earlier pending SHA, which can
  then be published. Main-worktree state does not cover an untracked linked
  worktree commit. `--no-verify` bypasses the hook entirely.

The existing pre-commit hook runs during both commit and amendment. The harness
uses a temporary custom `core.hooksPath`; it does **not** implement installation
or chaining of existing pre-push/post-commit hooks, shared-hook preservation,
or detached-worker lifecycle.

## Evidence and remaining gate

See the [archived report](reports/git-ai-1.7.5-darwin-arm64.json),
[versioned statistics fixtures](../fixtures/git-ai-1.7.5/README.md), and
[investigation](../../docs/investigation.md).

Mock checkpoints and this debug build do not establish installed-release or
JetBrains-embedded agent compatibility. GPG, interactive signing, hardware
keys, Windows and history rewrites remain unverified. The core now has shared
per-commit state and an explicit-branch compare-and-swap update, verified in the
[CLI tests](cli.test.mjs). Automatic hook installation, commit registration,
detached-worker lifecycle and runtime packaging still need implementation and
validation. Deliberate hook bypasses are outside the accepted guarantee; failed
calculation permits publication with warning and retry.
