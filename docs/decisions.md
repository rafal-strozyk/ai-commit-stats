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
| 2026-10-05 | Permit a short background annotation delay, with push protection. | A pending or failed annotation must not race with publication of the affected commit. |
| 2026-10-05 | Keep commits when annotation fails and provide clear recovery. | Report that statistics were not added and print a shell-appropriate, copyable retry command. |
| 2026-10-05 | Use MIT licensing. | The repository already contains the MIT license. |

Not yet decided: automatic commit/push mechanism, supported operating systems,
exact trailers, runtime packaging toolchain, hook coexistence implementation,
historical retry, and behavior during history rewrites. These need investigation
or further product decisions before implementation promises are made.
