# Security

Waymark is a local CLI. It does not provide a network server, cloud sync, or
remote execution service. It rejects absolute and escaping paths, does not run
arbitrary shell commands, and keeps resume packets bounded and free of raw
spans.

If you find a security issue, do not publish exploit details before a fix is
available. Use the private security-reporting channel of the hosting platform
once the public repository is established, or contact the project lead through
the private project workspace.

Supported versions are the latest released version and the current `main`
branch. Local `.waymark` data may contain repository paths and should be treated
as private workspace state.
