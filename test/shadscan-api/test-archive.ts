import { gzipSync } from "node:zlib";
import { pack, type Headers as TarHeaders } from "tar-stream";

interface TestArchiveEntry {
  contents?: Buffer | string;
  header: TarHeaders;
}

const collectTarStream = async (
  archive: ReturnType<typeof pack>
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of archive) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    totalBytes += buffer.byteLength;
  }

  return Buffer.concat(chunks, totalBytes);
};

const createTarGzip = async (entries: TestArchiveEntry[]): Promise<Buffer> => {
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
  return gzipSync(await tarPromise);
};

export type { TestArchiveEntry };
export { createTarGzip };
