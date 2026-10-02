import { notFound } from "next/navigation";
import { prisma } from "@slotkeep/db";
import { devMailboxEnabled } from "@/lib/dev";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev mailbox", robots: { index: false } };

export default async function Mailbox() {
  if (!devMailboxEnabled()) notFound();
  const emails = await prisma.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <main id="main" className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="text-2xl font-bold">Dev mailbox</h1>
      <p className="text-sm text-slate-600">
        Emails recorded by the dev transport (latest 30). Disabled in production.
      </p>
      <ul className="mt-6 flex flex-col gap-4">
        {emails.map((e) => {
          const text = e.body?.split("<!--html-->")[0] ?? "";
          const links = [...text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
          return (
            <li key={e.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <p className="text-xs text-slate-600">
                {e.createdAt.toISOString()} · {e.template} · {e.status}
              </p>
              <p className="font-medium">{e.subject}</p>
              <p className="text-sm text-slate-700">To: {e.to}</p>
              {links.map((l) => (
                <a
                  key={l}
                  href={l}
                  className="mt-1 block break-all text-sm text-indigo-700 underline"
                >
                  {l}
                </a>
              ))}
              <details className="mt-2">
                <summary className="cursor-pointer text-sm">Text</summary>
                <pre className="whitespace-pre-wrap text-xs">{text}</pre>
              </details>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
