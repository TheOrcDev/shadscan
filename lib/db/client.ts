import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { rateLimitWindows, scanCache, scanJobAccess, scanJobs } from "./schema";

const schema = { rateLimitWindows, scanCache, scanJobAccess, scanJobs };

class DatabaseConfigurationError extends Error {
  constructor() {
    super("DATABASE_URL is not configured.");
    this.name = "DatabaseConfigurationError";
  }
}

type Database = NeonHttpDatabase<typeof schema> & {
  $client: NeonQueryFunction<false, false>;
};

let cachedDatabase: Database | null = null;
let cachedDatabaseSignature: string | null = null;

const getDatabase = (): Database => {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new DatabaseConfigurationError();
  }

  const signature = createHash("sha256").update(databaseUrl).digest("hex");
  if (cachedDatabase && cachedDatabaseSignature === signature) {
    return cachedDatabase;
  }

  cachedDatabase = drizzle(databaseUrl, { schema });
  cachedDatabaseSignature = signature;
  return cachedDatabase;
};

export { DatabaseConfigurationError, getDatabase };
