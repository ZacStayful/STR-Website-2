import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe webhook: grants Pro (unlimited) access when a user pays, and
// revokes it if their subscription later lapses/cancels. Runs on Node
// (needs the raw request body for signature verification).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Admin = ReturnType<typeof createAdminClient>;

// Columns the webhook owns on a profile row.
type ProfilePatch = {
  plan?: "free" | "pro";
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  stripe_subscription_status?: string;
};

// A way of finding the profile a Stripe event belongs to, tried in order.
type Matcher = { column: string; value: string };

/**
 * Apply a patch to the first profile matched by `matchers`, tried in order.
 *
 * Deliberately does NOT use .single() — on zero rows that returns an error
 * object which the old code discarded, making "nobody matched" look exactly
 * like success. Here we inspect the returned rows so the caller can tell the
 * difference and fail the webhook (letting Stripe retry) instead of lying
 * with a 200.
 */
async function applyToProfile(
  admin: Admin,
  matchers: Matcher[],
  patch: ProfilePatch,
): Promise<{ matched: boolean; email: string | null }> {
  for (const { column, value } of matchers) {
    if (!value) continue;
    const { data, error } = await admin
      .from("profiles")
      .update(patch)
      .eq(column, value)
      .select("email");

    if (error) {
      console.error(`[stripe/webhook] update by ${column} failed:`, error.message);
      continue;
    }
    if (data && data.length > 0) {
      if (data.length > 1) {
        console.warn(
          `[stripe/webhook] ${column}=${value} matched ${data.length} profiles`,
        );
      }
      return { matched: true, email: data[0]?.email ?? null };
    }
  }
  return { matched: false, email: null };
}

/** Email candidates to match a profile on — exact first, then lowercased. */
function emailMatchers(email: string | null | undefined): Matcher[] {
  if (!email) return [];
  const lower = email.toLowerCase();
  const values = email === lower ? [email] : [email, lower];
  return values.map((value) => ({ column: "email", value }));
}

/** Best-effort lookup of the billing email behind a subscription. */
async function customerEmail(
  stripe: Stripe,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<string | null> {
  const id = typeof customer === "string" ? customer : customer?.id;
  if (!id) return null;
  try {
    const found = await stripe.customers.retrieve(id);
    if (found.deleted) return null;
    return found.email ?? null;
  } catch (err) {
    console.error("[stripe/webhook] customer lookup failed:", err);
    return null;
  }
}

export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error("[stripe/webhook] STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET not set");
    return new Response("Stripe is not configured.", { status: 500 });
  }

  const stripe = new Stripe(secretKey);
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature ?? "", webhookSecret);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      // Fired when a Payment Link / Checkout completes successfully. This is
      // the event that first links a Stripe customer+subscription to a profile,
      // so every other handler depends on it having run.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const email =
          session.customer_details?.email ?? session.customer_email ?? null;

        // Only ever write ids we actually have — a Checkout Session in a
        // non-subscription mode has no subscription, and blanking a stored id
        // would orphan the profile from later subscription events.
        const patch: ProfilePatch = {
          plan: "pro",
          stripe_subscription_status: "active",
        };
        if (typeof session.customer === "string") {
          patch.stripe_customer_id = session.customer;
        }
        if (typeof session.subscription === "string") {
          patch.stripe_subscription_id = session.subscription;
        }

        // Prefer the exact user id we tagged the checkout link with; fall back
        // to the billing email for payments started outside the app.
        const { matched, email: rowEmail } = await applyToProfile(
          admin,
          [
            ...(userId ? [{ column: "id", value: userId }] : []),
            ...emailMatchers(email),
          ],
          patch,
        );

        if (!matched) {
          // Someone has paid and we cannot tell who. Fail loudly so Stripe
          // retries and the endpoint shows red in the dashboard, rather than
          // silently leaving a paying customer on the paywall.
          console.error(
            `[stripe/webhook] PAID BUT UNMATCHED — session=${session.id} ` +
              `client_reference_id=${userId ?? "none"} email=${email ?? "none"}`,
          );
          return new Response("No matching profile for completed checkout.", {
            status: 500,
          });
        }

        // Log the "Sign up started" (paid) date on the Monday enquiry.
        const paidEmail = email ?? rowEmail;
        if (paidEmail) {
          const { setSubscriptionStarted } = await import("@/lib/apis/monday");
          await setSubscriptionStarted(paidEmail);
        }
        break;
      }

      // Keep access in sync as the subscription starts, changes or is
      // cancelled. `created` matters when checkout.session.completed is not
      // enabled on the endpoint — without it a new subscriber is never
      // granted access at all.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const active = sub.status === "active" || sub.status === "trialing";

        const patch: ProfilePatch = {
          plan: active ? "pro" : "free",
          stripe_subscription_id: sub.id,
          stripe_subscription_status: sub.status,
        };
        if (typeof sub.customer === "string") {
          patch.stripe_customer_id = sub.customer;
        }

        // Match on the subscription first, then the customer, then the billing
        // email. The last two matter because stripe_subscription_id is only
        // populated once — if that first write never landed, matching on it
        // alone can never recover.
        const matchers: Matcher[] = [
          { column: "stripe_subscription_id", value: sub.id },
        ];
        if (typeof sub.customer === "string") {
          matchers.push({ column: "stripe_customer_id", value: sub.customer });
        }
        matchers.push(...emailMatchers(await customerEmail(stripe, sub.customer)));

        const { matched, email } = await applyToProfile(admin, matchers, patch);

        if (!matched) {
          // Logged, but still a 200. Unlike checkout, subscription events
          // recur for the life of every customer, so if this Stripe account
          // also bills another product a 500 here would retry-storm on every
          // foreign renewal. A genuinely missed payment alarms via the
          // checkout branch above.
          console.error(
            `[stripe/webhook] UNMATCHED subscription ${sub.id} (${event.type}, ` +
              `status=${sub.status}) — no profile to update`,
          );
        }

        // On cancellation/lapse, log the "Cancel date" on the Monday enquiry.
        if (!active && email) {
          const { setSubscriptionCancelled } = await import("@/lib/apis/monday");
          await setSubscriptionCancelled(email);
        }
        break;
      }

      default:
        // Ignore other event types.
        console.log(`[stripe/webhook] ignoring ${event.type}`);
        break;
    }
  } catch (err) {
    console.error("[stripe/webhook] handler error:", err);
    return new Response("Webhook handler error.", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
