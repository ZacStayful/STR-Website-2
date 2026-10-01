import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

/**
 * Account › More › Browser extension lives inside the members' shell, like
 * every other members-only page, so there is a nav, a footer and a way back.
 * Here at connect/, not extension/: /extension and /extension/privacy are
 * public marketing pages with their own chrome.
 */
export default function ExtensionConnectLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell active="account" redirectTo="/extension/connect">
      {children}
    </AppShell>
  );
}
