import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const REPOSITORY_COLUMN_PATTERN = /repository(?:_name)?\s+text/i;
const SOURCE_COLUMN_PATTERN = /source_(?:archive|contents?)\s+/i;

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

  it("exposes scan caching only through hardened functions", async () => {
    const migration = await readFile("drizzle/0004_scan_cache.sql", "utf8");

    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain(
      "SET search_path = pg_catalog, public, pg_temp"
    );
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.scan_cache FROM "shadscan_runtime"'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public."get_shadscan_scan_cache"(text) TO "shadscan_runtime"'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public."put_shadscan_scan_cache"(text, text, text, text, text, text, text, jsonb, integer) TO "shadscan_runtime"'
    );
  });

  it("exposes queued jobs only through lease and bearer-token functions", async () => {
    const migration = await readFile("drizzle/0005_scan_jobs.sql", "utf8");

    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain(
      "SET search_path = pg_catalog, public, pg_temp"
    );
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.scan_jobs FROM "shadscan_runtime"'
    );
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE public.scan_job_access FROM "shadscan_runtime"'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public."create_shadscan_scan_job"(uuid, text, text, text, text, text, text, integer) TO "shadscan_runtime"'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public."claim_shadscan_scan_job"(uuid, integer, integer, integer) TO "shadscan_runtime"'
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public."get_shadscan_scan_job"(uuid, text) TO "shadscan_runtime"'
    );
    expect(migration).not.toMatch(REPOSITORY_COLUMN_PATTERN);
    expect(migration).not.toMatch(SOURCE_COLUMN_PATTERN);
  });
});
