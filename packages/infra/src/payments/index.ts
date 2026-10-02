import { env } from "../env";
import { FakeGateway } from "./fake";
import { StripeGateway } from "./stripe";
import type { PaymentGateway } from "./types";

let gateway: PaymentGateway | undefined;

export function paymentGateway(): PaymentGateway {
  gateway ??= env().PAYMENTS_MODE === "stripe" ? new StripeGateway() : new FakeGateway();
  return gateway;
}

/** Test hook. */
export function setPaymentGateway(g: PaymentGateway | undefined): void {
  gateway = g;
}

export * from "./types";
export { constructWebhookEvent, signWebhookPayload, stripeClient } from "./stripe";
export {
  cancelFakeSubscription,
  completeFakeSession,
  getFakeSession,
  postSignedEvent,
  type FakeSession,
} from "./fake";
