import { CookieSettingsLink } from "@/components/tracking/CookieSettingsLink"

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        {children}
        {/* Batch 19: the cookie choice can be changed from the sign-in pages too. */}
        <CookieSettingsLink variant="quiet" />
      </div>
    </main>
  )
}
