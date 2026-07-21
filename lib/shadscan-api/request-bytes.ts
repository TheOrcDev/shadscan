import { HostedScanError } from "./errors";

interface ReadBytesOptions {
  emptyCode?: string;
  emptyMessage?: string;
  emptyRetryable?: boolean;
  emptyStatus?: number;
  maxBytes: number;
  signal?: AbortSignal;
  tooLargeCode: string;
  tooLargeMessage: string;
  tooLargeRetryable?: boolean;
  tooLargeStatus?: number;
}

const createEmptyBodyError = (options: ReadBytesOptions): HostedScanError =>
  new HostedScanError(options.emptyMessage ?? "A request body is required.", {
    code: options.emptyCode ?? "EMPTY_BODY",
    retryable: options.emptyRetryable,
    status: options.emptyStatus ?? 400,
  });

const createTooLargeError = (options: ReadBytesOptions): HostedScanError =>
  new HostedScanError(options.tooLargeMessage, {
    code: options.tooLargeCode,
    retryable: options.tooLargeRetryable,
    status: options.tooLargeStatus ?? 413,
  });

const readStreamBytes = async (
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  options: ReadBytesOptions
): Promise<Buffer> => {
  if (contentLength) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > options.maxBytes) {
      throw createTooLargeError(options);
    }
  }

  if (!body) {
    throw createEmptyBodyError(options);
  }

  const reader = body.getReader();
  const cancelOnAbort = (): void => {
    reader.cancel(options.signal?.reason).catch(() => undefined);
  };
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  options.signal?.throwIfAborted();
  options.signal?.addEventListener("abort", cancelOnAbort, { once: true });
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const result = await reader.read();
      options.signal?.throwIfAborted();
      if (result.done) {
        break;
      }

      totalBytes += result.value.byteLength;
      if (totalBytes > options.maxBytes) {
        await reader.cancel();
        throw createTooLargeError(options);
      }

      chunks.push(result.value);
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancelOnAbort);
    reader.releaseLock();
  }

  if (totalBytes === 0) {
    throw createEmptyBodyError(options);
  }

  return Buffer.concat(chunks, totalBytes);
};

const readRequestBytes = (
  request: Request,
  options: ReadBytesOptions
): Promise<Buffer> =>
  readStreamBytes(request.body, request.headers.get("content-length"), options);

const readResponseBytes = (
  response: Response,
  options: ReadBytesOptions
): Promise<Buffer> =>
  readStreamBytes(
    response.body,
    response.headers.get("content-length"),
    options
  );

export type { ReadBytesOptions };
export { readRequestBytes, readResponseBytes };
