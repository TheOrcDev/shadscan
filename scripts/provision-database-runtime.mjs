import assert from "node:assert/strict";
import { neon } from "@neondatabase/serverless";

const PERMISSION_ROLE = "shadscan_runtime";
const DEFAULT_LOGIN_ROLE = "shadscan_app";
const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

const migrationUrl = process.env.DATABASE_MIGRATION_URL?.trim();
const loginRole =
  process.env.DATABASE_RUNTIME_ROLE?.trim() || DEFAULT_LOGIN_ROLE;
const runtimePassword = process.env.DATABASE_RUNTIME_PASSWORD ?? "";

if (!migrationUrl) {
  throw new Error(
    "DATABASE_MIGRATION_URL is required to provision the runtime role."
  );
}
if (!ROLE_NAME_PATTERN.test(loginRole) || loginRole === PERMISSION_ROLE) {
  throw new Error(
    "DATABASE_RUNTIME_ROLE must be a distinct lowercase Postgres identifier."
  );
}
const hasValidPassword =
  runtimePassword.length >= 32 &&
  !runtimePassword.includes(String.fromCharCode(0));
if (!hasValidPassword) {
  throw new Error(
    "DATABASE_RUNTIME_PASSWORD must contain at least 32 characters and no null bytes."
  );
}

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const quoteLiteral = (value) => `'${value.replaceAll("'", "''")}'`;
const loginRoleIdentifier = quoteIdentifier(loginRole);
const runtimePasswordLiteral = quoteLiteral(runtimePassword);
const ownerSql = neon(migrationUrl);

const permissionRoles = await ownerSql.query(
  "select rolname from pg_catalog.pg_roles where rolname = $1",
  [PERMISSION_ROLE]
);
assert.equal(
  permissionRoles.length,
  1,
  "Run pnpm db:migrate before provisioning the runtime login."
);

const loginRoles = await ownerSql.query(
  "select rolname from pg_catalog.pg_roles where rolname = $1",
  [loginRole]
);
if (loginRoles.length === 0) {
  await ownerSql.query(`
    CREATE ROLE ${loginRoleIdentifier}
      LOGIN
      PASSWORD ${runtimePasswordLiteral}
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      INHERIT
  `);
} else {
  await ownerSql.query(`
    ALTER ROLE ${loginRoleIdentifier}
      PASSWORD ${runtimePasswordLiteral}
  `);
}

await ownerSql.query(
  `GRANT ${quoteIdentifier(PERMISSION_ROLE)} TO ${loginRoleIdentifier}`
);
await ownerSql.query(
  `REVOKE CREATE ON SCHEMA public FROM ${loginRoleIdentifier}`
);
await ownerSql.query(
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${loginRoleIdentifier}`
);
await ownerSql.query(
  `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${loginRoleIdentifier}`
);
await ownerSql.query(
  `REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM ${loginRoleIdentifier}`
);
await ownerSql.query(
  `ALTER ROLE ${loginRoleIdentifier} SET search_path = pg_catalog, public`
);

const runtimeUrl = new URL(migrationUrl);
runtimeUrl.username = loginRole;
runtimeUrl.password = runtimePassword;
process.stdout.write(`${runtimeUrl.toString()}\n`);
