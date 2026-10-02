"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

export function DashboardNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((item) => {
        const active =
          pathname === item.href ||
          (item.href.split("/").length > 3 && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium",
              active ? "bg-brand text-white" : "text-slate-700 hover:bg-slate-100",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
