"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The sub-nav within Leads.
 *
 * It lives here rather than in AppSwitcher on purpose: the top strip already
 * carries seven items and wraps on mobile, and three more would push it to
 * two rows for everyone whether or not they use funnels. This is also what
 * keeps Leads visibly one section rather than three loosely related pages.
 */

const ITEMS = [
  { href: "/leads", label: "Leads" },
  { href: "/leads/funnels", label: "Funnels" },
  { href: "/leads/integrations", label: "Integrations" },
  { href: "/leads/api", label: "API & MCP" },
];

export function LeadsNav() {
  const pathname = usePathname() ?? "/leads";

  return (
    <nav className="mb-6 flex gap-1 border-b border-border text-sm" aria-label="Leads sections">
      {ITEMS.map((item) => {
        // "/leads" must not light up on "/leads/funnels", but "/leads/funnels"
        // does need to stay lit on "/leads/funnels/<id>".
        // A single lead (/leads/<uuid>) belongs to the Leads tab too.
        const active =
          item.href === "/leads"
            ? pathname === "/leads" || /^\/leads\/[0-9a-f-]{36}$/i.test(pathname)
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 font-medium transition-colors ${
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
