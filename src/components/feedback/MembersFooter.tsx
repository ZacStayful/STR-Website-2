import { FeedbackTrigger } from "./FeedbackTrigger";
import { CookieSettingsLink } from "@/components/tracking/CookieSettingsLink";

/**
 * The foot of every members-only page (Batch 18; rendered by AppShell after
 * the page). Just the way to tell us something: the marketing footer, with
 * hello@stayful.co.uk, stays on the public pages.
 */
export function MembersFooter() {
  return (
    <footer className="border-t border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
      Something not working, or got an idea? <FeedbackTrigger variant="footer" />
      {/* Batch 19: change or withdraw a cookie choice from any members' page. */}
      <CookieSettingsLink variant="members" separator />
    </footer>
  );
}
