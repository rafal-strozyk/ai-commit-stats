# Commit workflow investigation

Last inspected: 2026-10-07. Findings below distinguish observations, upstream
behavior, and conclusions that still require experiments.

## Local observations

- The project contains a shared TypeScript core, a development CLI and research
  integration code; automatic installation and editor integrations are absent.
- The experiment uses Git AI **1.7.5**, a debug `test-support` build from
  revision `f67fe0d732dfebf6bc229ad7c784e3a8a2d42a66`, Git **2.50.1 (Apple
  Git-155)** and Node.js **24.19.0** on macOS arm64.
- On 2026-10-05, global Git configuration set `trace2.eventtarget` to Git AI's
  daemon socket. The experiment ignores that configuration and uses its own
  daemon, sockets, HOME and databases; user configuration is checked unchanged.
- Previously inspected Git AI help advertised committed statistics,
  working-directory status, checkpoints, and a beta `await --timeout <seconds>`
  command.
- The first experimental run could not bind daemon sockets in the Codex
  sandbox. Running with socket permission enabled allowed end-to-end tests.
  This restriction is not evidence of a failure in the user's normal setup.

## Verified experiment results

The [reproduction instructions](../tests/integration/README.md),
[archived report](../tests/integration/reports/git-ai-1.7.5-darwin-arm64.json) and
[raw statistics fixtures](../tests/fixtures/git-ai-1.7.5/README.md) record the
tested version and scope. A passing report includes expected negative controls;
it is not certification of a production mechanism.

| Scenario | Observed result |
| --- | --- |
| Mixed attribution and partial commit | Two AI additions plus one human addition; the unstaged line is excluded. |
| Message-only amendment | Tested tree, parents, author, staged changes, index and working files remain unchanged; attribution transfers to the new SHA. |
| Repeat annotation and zero additions | Repeat keeps the same SHA; zero additions produce `N/A`. |
| Bounded `await` in `post-commit` | One-second timeout inside the hook; success after the outer commit returns. |
| Guarded push | Pending state publishes nothing; failed calculation allows push with warning/retry; retry after successful annotation publishes amended SHA; an explicit original SHA is rejected. |
| Annotation inside `pre-push` | With independent worker Trace2 roots, annotation completes and the amended note is available, but the remote receives the SHA selected before the hook. |
| HEAD race after final precondition | A controlled concurrent commit is amended using the prior commit's message and statistics. |
| Multiple pending commits | Replacing the single state entry allows publication of the earlier pending SHA. |
| Linked worktree | Amendment preserves the main worktree; main-worktree state alone fails to protect a linked-worktree commit. |
| Missing attribution | `stats --json` succeeds with an unknown addition and no note; annotation rejects it and preserves the commit. |
| Invalid output and subprocess errors | Invalid JSON, negative/inconsistent counts and nonzero exit fail without mutation. |
| Unavailable daemon and worker timeout | Failure remains visible; readiness timeout persists failed state and prints a proposed recovery command. |
| Filtering | Default lockfile, `.git-ai-ignore`, `.gitattributes` and explicit ignores change both AI additions and the filtered denominator consistently. |
| Signing | A message amendment has a verifiable SSH signature using a temporary unencrypted key. |
| Compiled core with real Git AI | Prepared replacement and atomically updated branch preserve staged/working data, complete statistics and a verifiable SSH signature; repeated annotation is idempotent. |
| Compiled core with mixed filtered additions | Copying the note and replacing the commit retains all original engine statistics and the 66.67% filtered share. |
| Hook bypass | `git push --no-verify` publishes an unannotated commit. |

In this build, available notes record baseline and residual commit additions as
human. ACS must consume that engine output rather than assigning human authorship
itself. Without a note, successful JSON with unknown additions is insufficient
to establish readiness. The missing-note fixture must never become a zero-AI
success result.

Repository-local Trace2 configuration did not emit events with the tested Git;
the harness uses `GIT_TRACE2_EVENT` and `GIT_TRACE2_EVENT_NESTING=0`. It removes
inherited `GIT_TRACE2_PARENT_SID` for workers so their Git operations can be
observed as independent roots. Retaining the inherited session prevented nested
amendment observation in initial development attempts. This is a harness finding,
not a validated production worker-launch procedure.

Timing measurements and a sanitized bounded daemon-log tail are recorded in the
report. They are observations on this machine, not readiness deadlines or latency
guarantees. No fixed delay substitutes for checking note availability.

The [development CLI](cli.md) now uses an explicit selected branch and a
branch/state compare-and-swap transaction, rather than `commit --amend` against
dynamic HEAD. Disposable-repository tests reproduce concurrent commit, checkout,
lease expiry and interrupted ref-update scenarios against this implementation.
Per-SHA state is retained across commits and shared by worktrees. These checks
address the research prototype's demonstrated races, but do not validate an
automatic installer or detached worker launch.

## Source and documentation findings

1. Git AI attaches attribution as Git Notes in `refs/notes/ai` after commit
   processing, and migrates attribution for amendments. Its docs describe
   eventual consistency, typically 5–100 ms after an operation completes; that
   range is not a guaranteed timeout. [How Git AI works](https://usegitai.com/docs/get-started/how-git-ai-works)
2. The 1.7.5 daemon source treats the root Git process's `atexit` or connection
   closure as its completion boundary; its tests explicitly reject `exit` as a
   sufficient boundary. This supports the concern that blocking `post-commit`
   until attribution exists creates a circular wait. The bounded hook
   experiment now reproduces a timeout; this does not prove that
   every possible hook configuration deadlocks. [Daemon source, v1.7.5](https://github.com/git-ai-project/git-ai/blob/v1.7.5/src/daemon.rs)
3. Git's `post-commit` hook runs after commit creation within `git commit`.
   `pre-push` receives the selected local object IDs and can abort a push. Merely
   waiting for an amendment inside `pre-push` does not establish that Git will
   send the replacement SHA. Hook bypasses and overrides also limit a hook-only
   guarantee. [Git hooks](https://git-scm.com/docs/githooks)
4. The inspected working-status implementation compares HEAD with the working
   directory, rather than providing a staged-only snapshot. Its `--diff-only`
   option must not be assumed to match partial commits. [Status source](https://github.com/git-ai-project/git-ai/blob/main/src/commands/status.rs)
5. The inspected stats implementation exposes `human_additions`,
   `unknown_additions`, `ai_additions`, and `git_diff_added_lines`. It polls for
   notes on recent commits. Successful JSON output alone must not be treated as
   proof that attribution was ready. [Stats source](https://github.com/git-ai-project/git-ai/blob/main/src/authorship/stats.rs)
6. Current docs describe default filtering of generated artifacts, lockfiles,
   and snapshots, plus `.gitattributes`, `.git-ai-ignore`, and explicit ignore
   patterns. Use a consistent numerator and denominator and confirm behavior
   for the supported Git AI version. [CLI reference](https://usegitai.com/docs/get-started/reference)
7. Node.js supports distributing applications as standalone executables to
   machines without Node.js installed. Platform builds and packaging need
   validation before selecting the release toolchain. [Node.js single executable applications](https://nodejs.org/api/single-executable-applications.html)

Source links to `main` describe inspected upstream behavior, not a pinned
compatibility contract. Future fixtures and experiments must identify the exact
Git AI version used.

## Remaining experiments and production design gate

Use disposable repositories and isolated Git AI state; do not change the user's
global agent configuration or annotate this project's history for the test.

- Verify actual JetBrains-embedded agent attribution and installed-release
  compatibility separately from mock checkpoints and the debug test build.
- Extend the tested atomic explicit-branch update and per-SHA shared state to
  automatic registration and detached workers; validate process crashes,
  restart/recovery, concurrent retries and retention in that installed workflow.
  The old research check followed by amend remains demonstrably unsafe.
- Validate detached post-commit worker launch, independent Trace2 observation,
  recursion avoidance, cleanup, and behavior with the editor closed. The harness
  owns its processes and does not install background workers.
- Test coexistence with existing pre-push/post-commit hooks and custom/shared
  `core.hooksPath`; running an existing pre-commit hook does not establish a
  production chaining or installation strategy.
- Deliberate hook bypasses are now explicitly outside the accepted guarantee.
  Failed calculation now permits push with warning and retry; pending operations
  and superseded selected SHAs still block. See [decisions](decisions.md).
- Verify GPG, hardware keys, interactive signing, other platforms and history
  rewrite behavior before declaring support.

## Exit criteria

Commands, versions, fixtures and measured results are now recorded. A supported
complete installed mechanism for commit/push coordination is still missing. Do not
select a plain synchronous post-commit amend as the production architecture
without evidence.
The manual core/evaluator now meets the tested job-state policy; automatic
coverage cannot be promised until commit registration, hooks and detached workers
are implemented and verified.
