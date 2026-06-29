import Stripe from "stripe";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { hasAccess } from "@/lib/access";
import { checkoutUrlFor } from "@/lib/billing";
import { siteUrl } from "@/lib/url";

// Creates a Stripe Checkout Session for the Pro subscription and redirects the
// user to Stripe's hosted checkout. Applies the discount code the user entered
// at signup (validated live against Stripe's promotion codes); if no valid code
// is stored, the user can still enter one on Stripe's page.
//
// Falls back to the static Payment Link when Stripe isn't fully configured
// (no secret key / no price id) so the Subscribe button keeps working while
// checkout is still in placeholder mode.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve a human-entered code (e.g. "WELCOME25") to its Stripe promotion-code
// id (e.g. "promo_..."). Returns null if the code doesn't exist, is inactive,
// or the lookup fails — in every case we just fall back to letting the user
// enter a code on Stripe's checkout page.
async function resolvePromotionCode(
  stripe: Stripe,
  code: string | null,
): Promise<string | null> {
  if (!code) return null;
  try {
    const { data } = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
    });
    return data[0]?.id ?? null;
  } catch (err) {
    console.error("[stripe/checkout] promo code lookup failed:", err);
    return null;
  }
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?redirect=/upgrade");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("plan, reports_run, stripe_customer_id, stripe_subscription_id, promo_code")
    .eq("id", user.id)
    .single();

  // Already entitled — nothing to buy.
  if (profile && hasAccess(profile)) {
    redirect("/estimate");
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRO_PRICE_ID;

  // Stripe API checkout not configured yet — fall back to the static Payment
  // Link. (The code can't be auto-applied this way, but the Payment Link can
  // have "Allow promotion codes" enabled in the dashboard so users can still
  // redeem one.)
  if (!secretKey || !priceId) {
    redirect(checkoutUrlFor(user.id, user.email ?? null));
  }

  const stripe = new Stripe(secretKey);
  const promotionCodeId = await resolvePromotionCode(
    stripe,
    profile?.promo_code ?? null,
  );

  let checkoutUrl: string | null = null;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      // Tie the payment back to this account (the webhook reads this).
      client_reference_id: user.id,
      ...(profile?.stripe_customer_id
        ? { customer: profile.stripe_customer_id }
        : user.email
          ? { customer_email: user.email }
          : {}),
      // A resolved signup code is applied automatically. Stripe forbids
      // combining `discounts` with `allow_promotion_codes`, so we only offer
      // the manual entry field when there's no code to pre-apply.
      ...(promotionCodeId
        ? { discounts: [{ promotion_code: promotionCodeId }] }
        : { allow_promotion_codes: true }),
      success_url: siteUrl("/estimate?subscribed=1"),
      cancel_url: siteUrl("/upgrade"),
    });
    checkoutUrl = session.url;
  } catch (err) {
    console.error("[stripe/checkout] session create failed:", err);
  }

  // If session creation failed, fall back to the static Payment Link rather
  // than dead-ending the Subscribe button.
  redirect(checkoutUrl ?? checkoutUrlFor(user.id, user.email ?? null));
}
