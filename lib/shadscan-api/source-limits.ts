import { z } from "zod";

const SourceLimitKindSchema = z.enum([
  "compressed_bytes",
  "expanded_bytes",
  "archive_entries",
  "retained_file_bytes",
  "relevant_files",
  "relevant_source_bytes",
]);

const SourceLimitDetailSchema = z
  .object({
    kind: SourceLimitKindSchema,
    limit: z.number().int().nonnegative(),
    observed: z.number().int().nonnegative(),
    path: z.string().min(1).max(512).optional(),
    unit: z.enum(["bytes", "entries"]),
  })
  .strict();

type SourceLimitDetail = z.infer<typeof SourceLimitDetailSchema>;

export type { SourceLimitDetail };
export { SourceLimitDetailSchema, SourceLimitKindSchema };
