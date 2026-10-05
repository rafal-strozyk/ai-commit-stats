# AI Commit Stats

Add Git AI code attribution statistics to commit messages, with integrations for
JetBrains IDEs and VS Code.

The project is in the design and investigation stage. No CLI, editor extension,
repository installer, or automatic annotation is implemented yet.

The intended experience is to install an editor plugin and select **Install AI
Commit Stats in this repository**. Setup provisions missing dependencies and
enables automatic annotation for that local repository. Users do not need to
install Node.js manually. Once configured, annotation also works for terminal
commits while the editor is closed.

The planned CLI provides both `ai-commit-stats` and the short command `acs`, with
identical behavior.

Background annotation is acceptable, but an immediate push must not publish a
commit awaiting annotation. Failed annotation preserves the commit and provides
a clear explanation and a copyable retry command.

- [Architecture and intended layout](docs/architecture.md)
- [Agreed decisions](docs/decisions.md)
- [Findings and experiments still needed](docs/investigation.md)
- [Development guidance and repository-local skills](docs/development.md)

Licensed under [MIT](LICENSE).
