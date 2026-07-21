import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { type Headers, pack } from "tar-stream";
import { afterEach, describe, expect, it } from "vitest";
import { extractTarGzip } from "../../lib/shadscan-api/archive";

interface TestArchiveEntry {
  contents?: Buffer | string;
  header: Headers;
}

interface TestArchive {
  gzip: Buffer;
  tar: Buffer;
}

const cleanupPaths: string[] = [];

const collectTarStream = async (
  archive: ReturnType<typeof pack>
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of archive) {
    chunks.push(chunk);
    totalBytes += chunk.byteLength;
  }

  return Buffer.concat(chunks, totalBytes);
};

const createTarGzip = async (
  entries: TestArchiveEntry[]
): Promise<TestArchive> => {
  const archive = pack();
  const tarPromise = collectTarStream(archive);

  for (const entry of entries) {
    const contents = Buffer.from(entry.contents ?? "");
    await new Promise<void>((resolve, reject) => {
      archive.entry(
        { ...entry.header, size: contents.byteLength },
        contents,
        (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );
    });
  }

  archive.finalize();
  const tar = await tarPromise;
  return { gzip: gzipSync(tar), tar };
};

const createDestination = async (): Promise<string> => {
  const destination = await mkdtemp(
    path.join(tmpdir(), "shadscan-archive-test-")
  );
  cleanupPaths.push(destination);
  return destination;
};

const expectArchiveError = async (
  promise: Promise<void>,
  code: string,
  status = 422
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ code, status });
};

afterEach(async () => {
  for (const cleanupPath of cleanupPaths.splice(0)) {
    await rm(cleanupPath, { force: true, recursive: true });
  }
});

describe("hosted scan archive extraction", () => {
  it("extracts regular files and directories with private file modes", async () => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      { header: { name: "app/", type: "directory" } },
      {
        contents: "export default function Page() {}\n",
        header: { name: "app/page.tsx", type: "file" },
      },
      {
        contents: '{"name":"fixture"}\n',
        header: { name: "package.json", type: "file" },
      },
    ]);

    await extractTarGzip(gzip, destination, {
      forbiddenPathBehavior: "reject",
    });

    expect(await readFile(path.join(destination, "app/page.tsx"), "utf8")).toBe(
      "export default function Page() {}\n"
    );
    expect(await readFile(path.join(destination, "package.json"), "utf8")).toBe(
      '{"name":"fixture"}\n'
    );
    const fileMode = (await stat(path.join(destination, "app/page.tsx"))).mode;
    expect(fileMode.toString(8).slice(-3)).toBe("600");
  });

  it.each([
    "../outside.ts",
    "app/../../outside.ts",
    "app\\page.tsx",
    "/absolute.ts",
    "C:/absolute.ts",
  ])("rejects an unsafe archive path: %s", async (name) => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      { contents: "unsafe", header: { name, type: "file" } },
    ]);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "reject",
      }),
      "UNSAFE_ARCHIVE_PATH"
    );
  });

  it.each([
    { linkname: "target.ts", type: "symlink" as const },
    { linkname: "target.ts", type: "link" as const },
    { type: "fifo" as const },
  ])("rejects links and special entries: $type", async (specialEntry) => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      {
        header: {
          ...specialEntry,
          name: "app/unsupported",
        },
      },
    ]);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "reject",
      }),
      "UNSUPPORTED_ARCHIVE_ENTRY"
    );
  });

  it("rejects duplicate normalized paths", async () => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      {
        contents: '{"name":"first"}',
        header: { name: "package.json", type: "file" },
      },
      {
        contents: '{"name":"second"}',
        header: { name: "package.json", type: "file" },
      },
    ]);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "reject",
      }),
      "ARCHIVE_DUPLICATE_PATH"
    );
  });

  it.each([
    {
      entries: [
        {
          contents: "ancestor",
          header: { name: "app", type: "file" as const },
        },
        {
          contents: "descendant",
          header: { name: "app/page.tsx", type: "file" as const },
        },
      ],
      order: "ancestor file first",
    },
    {
      entries: [
        {
          contents: "descendant",
          header: { name: "app/page.tsx", type: "file" as const },
        },
        {
          contents: "ancestor",
          header: { name: "app", type: "file" as const },
        },
      ],
      order: "descendant file first",
    },
  ])("rejects conflicting archive paths with the $order", async ({
    entries,
  }) => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip(entries);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "reject",
      }),
      "ARCHIVE_PATH_CONFLICT"
    );
  });

  it("accepts explicit directory metadata after its descendants", async () => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      {
        contents: "export default function Page() {}\n",
        header: { name: "app/page.tsx", type: "file" },
      },
      { header: { name: "app/", type: "directory" } },
    ]);

    await extractTarGzip(gzip, destination, {
      forbiddenPathBehavior: "reject",
    });

    expect(await readFile(path.join(destination, "app/page.tsx"), "utf8")).toBe(
      "export default function Page() {}\n"
    );
  });

  it("rejects a file whose declared contents exceed the per-entry limit", async () => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      {
        contents: "12345",
        header: { name: "app/page.tsx", type: "file" },
      },
    ]);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "reject",
        limits: { maxFileBytes: 4 },
      }),
      "ARCHIVE_FILE_TOO_LARGE"
    );
  });

  it("currently rejects an oversized asset even when the scanner does not read it", async () => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      {
        contents: "image-bytes",
        header: { name: "public/demo.png", type: "file" },
      },
      {
        contents: "export default function Page() {}\n",
        header: { name: "app/page.tsx", type: "file" },
      },
    ]);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "skip",
        limits: { maxFileBytes: 8 },
      }),
      "ARCHIVE_FILE_TOO_LARGE"
    );
  });

  it("currently counts irrelevant entries against the complete archive budget", async () => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      ...Array.from({ length: 5 }, (_, index) => ({
        contents: `doc ${index}`,
        header: {
          name: `docs/generated-${index}.md`,
          type: "file" as const,
        },
      })),
      {
        contents: "export default function Page() {}\n",
        header: { name: "app/page.tsx", type: "file" },
      },
    ]);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "skip",
        limits: { maxEntries: 5 },
      }),
      "ARCHIVE_TOO_MANY_ENTRIES"
    );
  });

  it("enforces compressed and expanded memory limits at the byte boundary", async () => {
    const { gzip, tar } = await createTarGzip([
      {
        contents: "boundary",
        header: { name: "package.json", type: "file" },
      },
    ]);
    const exactDestination = await createDestination();
    const compressedOverflowDestination = await createDestination();
    const expandedOverflowDestination = await createDestination();

    await extractTarGzip(gzip, exactDestination, {
      forbiddenPathBehavior: "reject",
      limits: {
        maxCompressedBytes: gzip.byteLength,
        maxExpandedBytes: tar.byteLength,
      },
    });
    expect(
      await readFile(path.join(exactDestination, "package.json"), "utf8")
    ).toBe("boundary");

    await expectArchiveError(
      extractTarGzip(gzip, compressedOverflowDestination, {
        forbiddenPathBehavior: "reject",
        limits: { maxCompressedBytes: gzip.byteLength - 1 },
      }),
      "ARCHIVE_COMPRESSED_TOO_LARGE",
      413
    );
    await expectArchiveError(
      extractTarGzip(gzip, expandedOverflowDestination, {
        forbiddenPathBehavior: "reject",
        limits: { maxExpandedBytes: tar.byteLength - 1 },
      }),
      "ARCHIVE_EXPANDED_TOO_LARGE"
    );
  });

  it("classifies a truncated tar payload as a malformed archive", async () => {
    const destination = await createDestination();
    const { tar } = await createTarGzip([
      {
        contents: "x".repeat(1024),
        header: { name: "app/page.tsx", type: "file" },
      },
    ]);
    const truncatedArchive = gzipSync(tar.subarray(0, 768));

    await expectArchiveError(
      extractTarGzip(truncatedArchive, destination, {
        forbiddenPathBehavior: "reject",
      }),
      "MALFORMED_ARCHIVE"
    );
  });

  it.each([
    ".env",
    ".env.production",
    ".git/config",
    "app/node_modules/package/index.js",
    "dist/bundle.js",
    "keys/server.pem",
  ])("rejects a forbidden snapshot path: %s", async (name) => {
    const destination = await createDestination();
    const { gzip } = await createTarGzip([
      { contents: "secret", header: { name, type: "file" } },
    ]);

    await expectArchiveError(
      extractTarGzip(gzip, destination, {
        forbiddenPathBehavior: "reject",
      }),
      "FORBIDDEN_SNAPSHOT_PATH"
    );
  });

  it("strips the GitHub archive root and skips forbidden repository paths", async () => {
    const destination = await createDestination();
    const archiveRoot = "owner-repository-0123456";
    const { gzip } = await createTarGzip([
      { header: { name: `${archiveRoot}/`, type: "directory" } },
      {
        contents: '{"name":"fixture"}\n',
        header: { name: `${archiveRoot}/package.json`, type: "file" },
      },
      {
        contents: "export default function Page() {}\n",
        header: { name: `${archiveRoot}/app/page.tsx`, type: "file" },
      },
      {
        contents: "generated",
        header: {
          name: `${archiveRoot}/node_modules/package/index.js`,
          type: "file",
        },
      },
    ]);

    await extractTarGzip(gzip, destination, {
      forbiddenPathBehavior: "skip",
      stripComponents: 1,
    });

    expect(await readFile(path.join(destination, "package.json"), "utf8")).toBe(
      '{"name":"fixture"}\n'
    );
    expect(await readFile(path.join(destination, "app/page.tsx"), "utf8")).toBe(
      "export default function Page() {}\n"
    );
    await expect(
      stat(path.join(destination, "node_modules/package/index.js"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      stat(path.join(destination, archiveRoot))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
