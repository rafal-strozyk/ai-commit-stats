# AI Commit Stats

Add Git AI code attribution statistics to commit messages, with integrations for
JetBrains IDEs and VS Code.

The project has a TypeScript core and development CLI for inspecting attribution,
annotating the current commit, viewing operation state, and evaluating pre-push
records. Editor extensions, repository installation, detached automatic workers,
and standalone distribution are not implemented yet.

A [reproducible commit/push experiment](tests/integration/README.md) now records
Git AI 1.7.5 statistics, verifies the compiled core, and demonstrates unsafe
prototype races. The research hooks are not production automation.

The intended experience is to install an editor plugin and select **Install AI
Commit Stats in this repository**. Setup provisions missing dependencies and
enables automatic annotation for that local repository. Users do not need to
install Node.js manually. Once configured, annotation also works for terminal
commits while the editor is closed.

The CLI declares both `ai-commit-stats` and the short executable name `acs`, with
identical behavior. During development, run `pnpm build`, then
`pnpm acs inspect --repo <path> --commit <sha> --json`.
See [CLI usage and limitations](docs/cli.md).

Background annotation is acceptable, but an immediate push must not publish a
commit awaiting annotation through active ACS hooks. Failed calculation permits
push with a clear warning and a copyable retry command; `--no-verify` deliberately
bypasses protection. Automatic hook installation remains a future step.

- [Architecture and intended layout](docs/architecture.md)
- [Project roadmap: past, present and next stages](docs/roadmap.md)
- [Agreed decisions](docs/decisions.md)
- [Findings and experiments still needed](docs/investigation.md)
- [Development guidance and repository-local skills](docs/development.md)

Licensed under [MIT](LICENSE).
