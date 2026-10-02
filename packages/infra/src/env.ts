import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** URL the server uses to call itself (fake payments posting webhooks). Defaults to APP_URL. */
  INTERNAL_APP_URL: z.string().url().optional(),
  MANAGE_TOKEN_SECRET: z.string().min(16).default("dev-manage-token-secret-change-me"),
  PAYMENTS_MODE: z.enum(["stripe", "fake"]).default("fake"),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).default("whsec_dev_fake_secret_for_local_webhooks"),
  STRIPE_PRO_PRICE_ID: z.string().optional().default(""),
  RESEND_API_KEY: z.string().optional().default(""),
  EMAIL_FROM: z.string().default("SlotKeep <bookings@slotkeep.local>"),
  LOG_LEVEL: z.string().default("info"),
  RATE_LIMIT_DISABLED: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  SENTRY_DSN: z.string().optional().default(""),
  SENTRY_RELEASE: z.string().optional().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/**
 * Validated environment, parsed on first use (not at import) so build steps that import server
 * modules don't need every secret. Fails loudly with every problem listed.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.MANAGE_TOKEN_SECRET.startsWith("dev-"))
      throw new Error("MANAGE_TOKEN_SECRET must be set in production");
    if (parsed.data.PAYMENTS_MODE === "stripe" && !parsed.data.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is required when PAYMENTS_MODE=stripe");
    }
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached env after mutating process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
