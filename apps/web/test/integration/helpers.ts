import {
  closeQueues,
  getQueue,
  QUEUE_NAMES,
  redis,
  signWebhookPayload,
  type QueueName,
} from "@slotkeep/infra";

export async function flushRedis(): Promise<void> {
  await redis().flushdb();
}

export async function jobIds(queue: QueueName): Promise<string[]> {
  const jobs = await getQueue(queue).getJobs([
    "waiting",
    "delayed",
    "active",
    "completed",
    "failed",
    "prioritized",
  ]);
  return jobs.map((j) => j.id!).sort();
}

export { closeQueues, QUEUE_NAMES };

export function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  id = `evt_${Math.random().toString(36).slice(2)}`,
  created = Math.floor(Date.now() / 1000),
) {
  const payload = JSON.stringify({
    id,
    object: "event",
    type,
    created,
    livemode: false,
    data: { object },
  });
  return { id, payload, signature: signWebhookPayload(payload) };
}

export function webhookRequest(payload: string, signature: string | null) {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "stripe-signature": signature } : {}),
      "x-request-id": "req-test-123",
    },
    body: payload,
  });
}
