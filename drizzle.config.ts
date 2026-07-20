import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

const databaseUrl =
  process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  ...(databaseUrl ? { dbCredentials: { url: databaseUrl } } : {}),
  dialect: "postgresql",
  out: "./drizzle",
  schema: "./lib/db/schema.ts",
});
