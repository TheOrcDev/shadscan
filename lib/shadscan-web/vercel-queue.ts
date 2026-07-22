import { QueueClient, type VercelRegion } from "@vercel/queue";

const getQueueRegion = (): VercelRegion =>
  process.env.VERCEL_REGION?.trim() || "iad1";

const queueClient = new QueueClient({ region: getQueueRegion() });
const handleQueueCallback = queueClient.handleCallback;
const sendQueueMessage = queueClient.send;

export { handleQueueCallback, sendQueueMessage };
