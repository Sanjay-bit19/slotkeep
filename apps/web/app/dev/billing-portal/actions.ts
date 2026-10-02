"use server";

import { redirect } from "next/navigation";
import { prisma } from "@slotkeep/db";
import { cancelFakeSubscription } from "@slotkeep/infra";
import { fakePaymentsEnabled } from "@/lib/dev";
import { requireUser } from "@/lib/authz";

export async function cancelFakeSub(customerId: string, returnUrl: string) {
  if (!fakePaymentsEnabled()) throw new Error("Fake payments disabled");
  const user = await requireUser();
  const tenant = await prisma.tenant.findFirst({
    where: {
      stripeCustomerId: customerId,
      memberships: { some: { userId: user.id, role: "OWNER" } },
    },
  });
  if (!tenant?.stripeSubscriptionId) throw new Error("No subscription");
  await cancelFakeSubscription({
    tenantId: tenant.id,
    customerId,
    subscriptionId: tenant.stripeSubscriptionId,
  });
  redirect(returnUrl);
}
