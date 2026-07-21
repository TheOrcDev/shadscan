import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("database role contract", () => {
  it("never falls back to the runtime credential for migrations", async () => {
    const drizzleConfig = await readFile("drizzle.config.ts", "utf8");

    expect(drizzleConfig).toContain("process.env.DATABASE_MIGRATION_URL");
    expect(drizzleConfig).not.toContain("process.env.DATABASE_URL");
  });

  it("limits the runtime role to the hardened rate-limit function", async () => {
    const migration = await readFile("drizzle/0003_runtime_role.sql", "utf8");

    expect(migration).toContain('CREATE ROLE "shadscan_runtime"');
    expect(migration).toContain("NOLOGIN");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain(
      "SET search_path = pg_catalog, public, pg_temp"
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public."consume_shadscan_rate_limits"(jsonb) TO "shadscan_runtime"'
    );
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "shadscan_runtime"'
    );
  });
});
