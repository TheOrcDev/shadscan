# Security Policy

## Supported Versions

Before the first public release, only the current `main` branch receives
security fixes. After publication, the newest stable minor line receives
security fixes; prereleases are supported only until their corresponding stable
release.

## Reporting A Vulnerability

Report vulnerabilities privately through the repository's GitHub Security
Advisories page. Do not open a public issue containing exploit details, private
source, credentials, API keys, or npm authentication material.

Include the affected version, operating system and Node.js version, a minimal
reproduction, impact, and any known mitigation. Reports will be acknowledged as
soon as an owner reviews them. Confirmed issues will be fixed in a new immutable
package version; affected versions may be deprecated with upgrade guidance.

shadscan's local CLI is designed to read source from the selected project and
write reports to stdout or errors to stderr. Any unexpected network request,
project-file mutation, install-time execution, or machine-local path disclosure
is considered a security bug.

Hosted source is treated as untrusted data and is never executed. Archive
validation and size limits run before analysis; parsing and rule evaluation run
in a disposable worker with a bounded V8 heap, a bounded stack, and no deployed
secrets in its environment. The worker is terminated on request abort. This is
failure and resource isolation, not a security sandbox: the worker remains part
of the server process and uses the same operating-system identity.
