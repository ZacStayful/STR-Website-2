import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// Account pages (plan, billing & usage) sit inside the same members shell as the
// analyser, so the credit badge, banner and out-of-credit modal are present.
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell active="account" redirectTo="/account">
      {children}
    </AppShell>
  );
}
