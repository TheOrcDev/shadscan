# Database roles

Production uses two different Neon credentials:

- `DATABASE_MIGRATION_URL` belongs to the database owner. Keep it in the
  release secret store and use it only for migrations, runtime-role
  provisioning, and database verification. Do not deploy it to Vercel.
- `DATABASE_URL` belongs to a restricted login such as `shadscan_app`. This is
  the only database credential available to the running application.

The `shadscan_runtime` no-login role owns the permission contract. It can use
the `public` schema and execute the bounded rate-limit and optional scan-cache
functions, but it cannot directly read or modify `rate_limit_windows` or
`scan_cache`, create schema objects, own database objects, or inherit Neon's
`neon_superuser` role. Each function runs as its migration-owner definer with a
fixed search path.

Runtime limiter calls are bounded at three layers: a 1-second PostgreSQL lock
timeout, a 3-second statement timeout, and a 5-second Neon HTTP transport
deadline. A timeout fails closed as an unavailable limiter and remains inside
the hosted scan deadline.

## Provision or rotate the runtime login

Apply migrations with the owner credential first:

```bash
DATABASE_MIGRATION_URL="..." pnpm db:migrate
```

Generate a new password and provision the login. The command writes the new
runtime connection URL to standard output, so direct it into your secret
manager or a protected temporary file rather than source control:

```bash
export DATABASE_RUNTIME_PASSWORD="$(openssl rand -base64 48)"
DATABASE_MIGRATION_URL="..." pnpm db:provision-runtime > runtime-url.txt
```

`DATABASE_RUNTIME_ROLE` can override the default login name `shadscan_app`.
Set the emitted URL as the deployed `DATABASE_URL`, remove the temporary file,
and do not deploy `DATABASE_MIGRATION_URL`. If a hosting integration injected
owner aliases such as `POSTGRES_URL`, `POSTGRES_PASSWORD`, `PGPASSWORD`, or
`DATABASE_URL_UNPOOLED`, remove those variables from the application
environment as well. The runtime must not receive an alternate owner
credential under a name the current code happens not to read.

## Verify least privilege

Run the verifier with both credentials available only to the release process:

```bash
DATABASE_MIGRATION_URL="..." DATABASE_URL="..." pnpm db:verify
```

The verifier fails unless the credentials resolve to different roles, the
runtime login is a non-privileged member of `shadscan_runtime`, direct table and
schema creation privileges are absent, the bounded functions remain executable,
and the concurrent rate-limit, atomic rate-limit, and scan-cache behavior pass.
