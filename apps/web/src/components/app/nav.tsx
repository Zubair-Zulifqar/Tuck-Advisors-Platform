"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Building2, CheckSquare, FlaskConical, Gauge, KanbanSquare, Mail, MessageSquare, Newspaper, Radar, Settings, Sigma, Users } from "lucide-react";
import { cn } from "@/lib/cn";

const items = [
  ["/app", "Dashboard", Gauge],
  ["/app/companies", "Companies", Building2],
  ["/app/contacts", "Contacts", Users],
  ["/app/deals", "Pipeline", KanbanSquare],
  ["/app/tasks", "Tasks", CheckSquare],
  ["/app/research", "Research", FlaskConical],
  ["/app/matrix", "M&A Matrix", Sigma],
  ["/app/reddit", "Deal sourcing", Radar],
  ["/app/communications", "Communications", MessageSquare],
  ["/app/outreach", "Outreach", Mail],
  ["/app/newsletters", "Newsletters", Newspaper],
  ["/app/automations", "Automations", Bot],
  ["/app/settings", "Settings", Settings],
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:pb-20" aria-label="App">
      {items.map(([href, label, Icon]) => {
        const active = href === "/app" ? path === "/app" : path.startsWith(href);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition", active ? "bg-navy text-ivory dark:bg-ivory dark:text-navy" : "muted hover:bg-black/5 hover:text-[var(--text)] dark:hover:bg-white/5")}>
            <Icon size={16} /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
