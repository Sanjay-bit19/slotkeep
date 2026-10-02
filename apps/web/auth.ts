import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import type { EmailConfig } from "next-auth/providers/email";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@slotkeep/db";
import { env, logger, magicLinkEmail, sendEmail } from "@slotkeep/infra";

declare module "next-auth" {
  interface Session {
    user: { id: string } & DefaultSession["user"];
  }
}

/** Magic-link provider that sends through our own mailer (Resend in prod, EmailLog in dev). */
const emailProvider: EmailConfig = {
  id: "email",
  type: "email",
  name: "Email",
  from: process.env.EMAIL_FROM ?? "SlotKeep <bookings@slotkeep.local>",
  maxAge: 24 * 60 * 60,
  options: {},
  async sendVerificationRequest({ identifier, url }) {
    const { host } = new URL(url);
    await sendEmail({ ...magicLinkEmail(url, host), to: identifier, template: "magic-link" });
    logger.info({ to: identifier }, "magic link sent");
  },
};

const providers: NextAuthConfig["providers"] = [emailProvider];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  // allowDangerousEmailAccountLinking: Google verifies email ownership, so linking a Google
  // login to an existing magic-link account with the same address is safe.
  providers.push(Google({ allowDangerousEmailAccountLinking: true }));
}

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // Database sessions: revocable server-side (delete the row) and nothing sensitive in the cookie.
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 },
  providers,
  pages: { signIn: "/login", verifyRequest: "/login/check-email", error: "/login" },
  trustHost: true,
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  logger: {
    error(error) {
      logger.error({ err: error }, "auth error");
    },
    warn(code) {
      logger.warn({ code }, "auth warning");
    },
  },
});

void env;
