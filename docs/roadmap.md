# Project roadmap

Updated: 2026-10-07. This roadmap records completed work, the current development
baseline and the proposed order of future work. It is not a release schedule.
Accepted requirements live in [decisions](decisions.md); verified findings and
unresolved hypotheses live in [investigation](investigation.md).

## Past: foundations and feasibility

| Period | Completed milestone | Outcome and evidence |
| --- | --- | --- |
| 2026-10-05 | Product and architecture decisions | TypeScript core and CLI, Git AI attribution, local repository activation, JetBrains and VS Code integrations, terminal operation with the editor closed, and distribution without a manual Node.js install. See [decisions](decisions.md). |
| 2026-10-06 | Repository development workflows | Local skills, repository conventions and pnpm linting established. Sources and adaptations are recorded in [development](development.md). |
| 2026-10-07 | Commit/push feasibility experiment | Versioned Git AI 1.7.5 fixtures, reproducible isolated experiment and archived results. Demonstrated stale selected push SHAs, unsafe amendment races, lost pending state and worktree coverage gaps. See [experiment](../tests/integration/README.md). |
| 2026-10-07 | Push policy agreed | Pending operations block normal pushes; a superseded selected SHA requires a retry; terminal statistics failures allow push with a warning and retry command. Deliberate hook bypasses are allowed. |
| 2026-10-07 | Shared core and development CLI | Explicit-SHA annotation, atomic branch/job updates, shared per-commit state and push evaluation implemented with observable failure and concurrency tests. See [CLI](cli.md). |

The experimental hooks and unsafe amendment code are research controls, not the
implementation to extend. Their failures explain why the core prepares a commit
and publishes it with an explicit-branch compare-and-swap transaction.

## Present: implemented development baseline

The repository contains [core](../packages/core/src/index.ts),
[CLI](../packages/cli/src/main.ts), deterministic unit and disposable-repository
tests, and a separate experiment using real Git AI. The available commands are
`inspect`, `annotate`, `status` and `check-push`; development usage is documented
in [CLI usage](cli.md).

Implemented behavior includes:

- Annotation requires an expected full HEAD SHA and captures its local branch.
  It preserves the tree, ordered parents, author, index and working files, copies
  attribution to the replacement and checks engine counts before publication.
- Branch and ready job state are published together with compare-and-swap.
  Concurrent commits cannot redirect annotation to another commit. A checkout
  may leave the originally captured branch eligible for annotation; the newly
  selected branch is not updated.
- Per-original-SHA jobs are shared across linked worktrees. Pending, ready and
  failed states support push evaluation; expired pending jobs prevent late
  workers from publishing and allow push with a warning.
- Missing attribution is a failure, never an inferred human or zero-AI result.
  Version 1 trailers preserve unrelated message content and are idempotent.
- Subprocesses use structured arguments, bounded output and deadlines, with
  interruption cleanup and durable ref-update outcome reconciliation.

The recorded validation at this milestone comprised 24 passing unit/CLI tests
and 36 passing checks in the real Git AI experiment, plus compiler and lint
checks. These are historical results, not a claim that checks have just run.
The [archived experiment report](../tests/integration/reports/git-ai-1.7.5-darwin-arm64.json)
records macOS arm64, Git 2.50.1 and an isolated Git AI 1.7.5 debug test-support
build. It does not establish installed-release or embedded-agent compatibility.
Use [development commands](development.md) to verify the current checkout.

Automatic commit registration, detached workers, hook installation, standalone
distribution and editor integrations are absent. `check-push` protects recorded
jobs only; it cannot provide repository-wide automatic coverage yet. Declared
`acs` and `ai-commit-stats` package entry points are not globally installed by a
build. Local job refs contain paths and must not be mirrored or exported.

## Future: proposed implementation order

The stages below are planning guidance. Choose mechanisms through disposable
experiments before treating them as supported architecture. Packaging and real
agent compatibility can be investigated alongside automation, but editor setup
must consume a verified installed CLI workflow.

### 1. Automatic commit registration and worker lifecycle

Design the commit notification and registration mechanism so every affected
commit has durable shared state before a protected push can publish it. Reuse the
core's per-SHA state and explicit-branch transaction rather than introducing a
second annotation implementation. Investigate detached post-commit launch;
waiting synchronously inside `post-commit` is not a validated solution.

Cover readiness after the outer Git process ends, independent worker observation,
recursion avoidance, process ownership, deadlines, crashes, restart/recovery,
concurrent retries and rapid consecutive commits across worktrees. Account for
the branch moving before a worker can annotate: current annotation is HEAD-only,
so historical rewriting must not be silently introduced.

Completion gate: disposable-repository tests show immediate normal pushes cannot
escape pending registration, workers target the captured commit safely, failure
allows push with a useful retry, and operation continues with the editor closed.
Document any unsupported Git operations or environments explicitly.

### 2. Repository installation, repair and uninstallation

Implement lifecycle commands around the validated worker mechanism. Define local
activation, managed executable paths, hook ownership and coexistence with existing
hooks and custom/shared `core.hooksPath`. Installation must preserve user hooks
and configuration; repair must detect broken setup. Define job retention and
cleanup without removing an active worker's coordination state.

Completion gate: repeated installation and repair are safe, worktree coverage is
verified, uninstall preserves unrelated hooks and shared Git AI dependencies,
and pending, superseded and failed push cases work through the installed hooks.
Deliberate `--no-verify` remains outside the guarantee.

### 3. Compatibility and standalone distribution

Select a supported operating-system and signing matrix from evidence. Validate
an ordinary installed Git AI release and actual agent attribution separately
from the test-support binary and mock checkpoints. Investigate GPG, interactive
signing and hardware keys before claiming support.

Choose and test runtime packaging and stable user-level executable storage.
Provide identical `acs` and `ai-commit-stats` entry points, detect command-name
collisions, and preserve managed absolute paths for hooks and editors. Validate
dependency reuse/provisioning, configuration effects and required restarts.

Completion gate: a clean environment can install and use the complete workflow
without manually installing Node.js, supported configurations pass end-to-end
checks, and unsupported versions/platforms produce clear diagnostics.

### 4. Editor integrations

Build the JetBrains Kotlin plugin and VS Code extension around the same CLI JSON
interface. Expose repository install, status, repair and uninstall; surface
failures and required restarts. Keep attribution, Git operations and lifecycle
logic in the shared implementation.

Completion gate: both integrations manage local activation correctly, preserve
shared dependencies, and report the same state as the terminal. Actual
JetBrains-embedded agent attribution is verified. Closing an editor does not
disable annotation or push coordination.

### 5. Release readiness and maintenance

Establish CI for the selected support matrix, reproducible packaging and upgrade
checks, versioned engine compatibility evidence, and user installation/recovery
documentation. Exercise the supported workflow from dependency setup through
annotation, push, failure recovery and uninstall.

Completion gate: documented support matches reproducible checks, release
artifacts work in clean environments, and updates preserve activation and user
configuration. No production release is implied by the current CLI milestone.

## Decisions still required

The automatic registration/worker mechanism, hook coexistence strategy, support
matrix, packaging toolchain and state retention policy remain open. Historical
retry, published-commit recovery and history rewrite behavior require explicit
design; no automatic force-push is authorized or implemented. Track resulting
decisions in [decisions](decisions.md), with supporting evidence in
[investigation](investigation.md).

## Starting a new agent session

Read [repository guidance](../AGENTS.md), this roadmap,
[architecture](architecture.md), [decisions](decisions.md),
[CLI limitations](cli.md), [investigation](investigation.md) and
[development](development.md). Inspect the working-tree diff as well as commits:
uncommitted and untracked implementation files are not available in a new clone.

The next task is stage 1: design and validate automatic registration and worker
lifecycle against the existing core. Review its tests and the research negative
controls first. Update this roadmap when a stage's completion gate is met; record
what was actually verified rather than promoting a proposal to a guarantee.
