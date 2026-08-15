# Plugins and Skills

LensQuery Electron treats extensions as local, auditable instruction packages. The first release supports installation, discovery, enable/disable, and bounded prompt context. It does not load third-party JavaScript or execute extension shell commands.

## Install from the client

1. Open **Extensions** in the left sidebar.
2. Choose **Plugins** or **Skills**.
3. Use **Install from folder**, or paste a Git repository URL/local directory path into the source row.
4. Review the package name, origin, path, declared permissions, and compatibility.
5. Keep the package enabled for all new analyses, or disable it without removing its files.

Managed removal moves the package to the operating-system Trash. Skills discovered under `~/.agents/skills` are read-only and must be managed at their source.

## LensQuery plugin format

A plugin directory contains a manifest and a Markdown instruction entry:

```text
customer-reply-plugin/
├── lensquery.plugin.json
└── PLUGIN.md
```

`lensquery.plugin.json`:

```json
{
  "id": "customer-reply",
  "name": "Customer Reply",
  "description": "Formats grounded answers for customer support.",
  "version": "1.0.0",
  "author": "LensQuery contributors",
  "entry": "PLUGIN.md",
  "permissions": ["prompt-context"]
}
```

The entry must remain inside the plugin directory. Permission names are displayed as metadata; they do not grant filesystem, network, shell, or model-tool execution.

## Compatible Skill format

A Skill directory contains `SKILL.md` with simple YAML-style frontmatter:

```markdown
---
name: image-evidence
description: Analyze visible image evidence without inventing hidden facts.
version: 1.0.0
author: LensQuery contributors
---

# Image evidence

Separate direct observations from inference and unknowns.
```

Managed Skills install into:

- macOS/Linux: `~/.codex/skills/<skill-id>/SKILL.md`
- Windows: `%USERPROFILE%\.codex\skills\<skill-id>\SKILL.md`

LensQuery also discovers `~/.agents/skills`, but does not move or delete those external packages.

## Git sources

Use an HTTPS, SSH, or `git@...` repository URL. LensQuery performs a shallow clone with Git and accepts:

- a package at the repository root; or
- exactly one package one directory below the root.

If a repository contains several packages, clone it yourself and install the specific package directory.

## Runtime behavior

- New managed installs are enabled automatically.
- Existing Skills discovered on disk start disabled in LensQuery until the user opts in.
- Enabled `PLUGIN.md`/`SKILL.md` content is appended to analysis guidance, never treated as authority to run tools or modify files.
- One package contributes at most 12,000 characters; all enabled packages contribute at most 40,000 characters per request.
- Codex-compatible Skills remain visible to Codex itself because their files live under `~/.codex/skills`.

## Installation boundaries

Before copying, LensQuery:

- rejects symbolic links;
- ignores `.git`, `node_modules`, and `.DS_Store`;
- rejects packages over 800 files or 32 MB;
- validates safe IDs and in-package Markdown entry paths;
- stages replacement atomically and preserves the previous package if replacement fails.

These checks make packages inspectable and bounded. A future executable plugin API requires a separate permission model, signature policy, sandbox, and user-visible audit log.
