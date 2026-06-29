// Stripe payment link for the Pro subscription. Tagged per-user so the
// webhook can match the payment back to the right account.
export const STRIPE_PAYMENT_LINK =
  process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK ||
  "https://buy.stripe.com/6oUcN4bBif6Y0ln0C74sE01";

// Internal route that creates a Stripe Checkout Session and redirects to it.
// Used by every "Subscribe" button. The route applies the user's signup
// discount code (if any) and falls back to the static Payment Link when
// Stripe isn't fully configured. See src/app/api/stripe/checkout/route.ts.
export const CHECKOUT_PATH = "/api/stripe/checkout";

// Build the static Payment Link URL for a specific user. Used as the fallback
// when the Stripe API checkout isn't configured. client_reference_id is echoed
// back on the completed Checkout Session so the webhook knows who paid;
// prefilled_email saves them re-typing it.
export function checkoutUrlFor(userId: string, email: string | null): string {
  const url = new URL(STRIPE_PAYMENT_LINK);
  url.searchParams.set("client_reference_id", userId);
  if (email) url.searchParams.set("prefilled_email", email);
  return url.toString();
}
