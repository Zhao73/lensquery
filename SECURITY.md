# Security policy

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories. Do not include captured customer material, API keys, access tokens, or private file contents in an issue.

## Sensitive-data boundaries

- A capture must be previewed before transmission.
- Provider secrets belong in the operating-system credential store, never source files, frontend state, logs, screenshots, or issue reports.
- New logging must be reviewed for authorization headers, file contents, image data URLs, and key-like strings.
- Local CLI integrations remain read-only by default and must not silently grant shell or file-write tools.

## Supported versions

Until 1.0, security fixes target the latest tagged release and `main`.

