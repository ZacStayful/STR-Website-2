import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// The profile page (Batch 12): every quiz answer and where to change it.
// Members-only, inside the same shell as Today and Account; it announces
// itself as `profile`, which lights up Account (src/lib/nav.ts).
export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell active="profile" redirectTo="/profile">
      {children}
    </AppShell>
  );
}
