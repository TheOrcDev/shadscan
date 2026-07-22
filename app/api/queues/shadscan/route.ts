import { processQueuedScan } from "@/lib/shadscan-web/process-queued-scan";
import { handleQueueCallback } from "@/lib/shadscan-web/vercel-queue";

export const maxDuration = 300;

export const POST = handleQueueCallback(
  async (message) => {
    await processQueuedScan(message);
  },
  {
    retry: (_error, metadata) => ({
      afterSeconds: Math.min(60, 2 ** Math.min(metadata.deliveryCount, 6)),
    }),
    visibilityTimeoutSeconds: 300,
  }
);
