import { AppShell } from "@/components/AppShell";

export const dynamic = "force-dynamic";

// Saved profiles (Batch 13): list, new, rename, pause, delete. Inside the
// members' shell like the profile page, and lights up Account as it does.
export default function ProfilesLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell active="profile" redirectTo="/profiles">
      {children}
    </AppShell>
  );
}
