# Decisions

Record accepted product choices here. Keep unverified implementation ideas in
[the investigation](investigation.md). Update these documents as decisions and
evidence change, including affected assumptions and limitations.

| Date | Decision | Reason or consequence |
| --- | --- | --- |
| 2026-10-05 | Use TypeScript for the shared core and CLI. | Both editor integrations consume one implementation; replaces the earlier Rust proposal. |
| 2026-10-05 | Provide `acs` as a short executable command alongside `ai-commit-stats`. | Identical behavior; prefer the short name in user-facing examples and retry instructions. |
| 2026-10-05 | Target JetBrains and VS Code; keep the JetBrains plugin in Kotlin. | Editor integrations provide setup and status around the shared CLI. |
| 2026-10-05 | Use Git AI as the attribution engine. | Consume recorded attribution rather than estimating authorship from code. |
| 2026-10-05 | Provide an install button for each local repository. | Activation is explicit and local; a new clone needs its own setup. |
| 2026-10-05 | Cover terminal and IDE commits with the editor closed. | Automatic behavior must operate outside the editor lifecycle. |
| 2026-10-05 | Restrict message updates to enabled repositories; allow shared Git AI tracking. | Git AI's agent configuration may affect other repositories without enabling message annotation there. |
| 2026-10-05 | Do not require users to install Node.js manually. | Distribute the TypeScript CLI with its runtime in a standalone executable. |
| 2026-10-05 | Let setup install missing dependencies and inform the user. | Reuse compatible existing Git AI installations and report setup effects and restarts. |
| 2026-10-05 | Permit a short background annotation delay, with push protection. | Pending annotation must not race with publication; the failure policy was revised on 2026-10-07. |
| 2026-10-05 | Keep commits when annotation fails and provide clear recovery. | Report that statistics were not added and print a shell-appropriate, copyable retry command. |
| 2026-10-05 | Use MIT licensing. | The repository already contains the MIT license. |
| 2026-10-07 | Protect standard pushes while ACS hooks are active; deliberate bypasses are allowed. | `--no-verify` and disabled hooks are outside the guarantee; no server enforcement is required. |
| 2026-10-07 | Abort a push that selected the original SHA before annotation changed it. | Waiting does not make Git replace its already-selected object; the user retries the push. |
| 2026-10-07 | Allow push after statistics calculation fails. | Warn that statistics were not calculated and provide a quoted retry command targeting the repository and original SHA; no confirmation prompt. |

Not yet decided: automatic commit/push mechanism, supported operating systems,
runtime packaging toolchain, hook coexistence implementation,
historical retry, and behavior during history rewrites. These need investigation
or further product decisions before implementation promises are made.

## Verified evidence informing the next decision

The [2026-10-07 experiment](../tests/integration/README.md) demonstrates that a
local pre-push hook can be bypassed and that waiting for amendment does not
replace Git's selected push object. It also exposes concurrency and state
coverage gaps in the research prototype. The accepted scope and revised failure
behavior above resolve the product choices; automatic hook/worker installation
remains unimplemented.

## Implemented development choices

The shared core uses prepared commit objects, copied and validated local Git AI
notes, and a branch/state compare-and-swap ref transaction. Per-commit state uses
local Git refs shared by worktrees. This replaces the unsafe research prototype
mechanisms for the manual CLI; it does not establish detached automation.

Trailer format version 1 uses `AI-Stats-Version`, `AI-Lines-Added`,
`Human-Lines-Added`, `Unknown-Lines-Added`, and `AI-Share-Added`. Counts use the
versioned Git AI 1.7.5 filtered-statistics fixtures; zero additions produce `N/A`.
Existing body content and unrelated trailers are retained; repeated annotation
does not duplicate the footer. Different trailer versions are rejected.

The development toolchain is strict TypeScript compiled with `tsc` to NodeNext
ESM, using pnpm, Node's test runner and ESLint. Standalone runtime packaging is
still a separate unverified release decision.
