/**
 * Facebook's and Instagram's in-app browsers, from the user agent.
 *
 * Google refuses OAuth inside them ("disallowed_useragent"), and a sign-up
 * confirmation link opened from the mail app lands in the phone's real
 * browser, where the sign-up's session is not. The sign-up and login pages
 * use this to swap the Google button for "open this page in your browser"
 * and to say so before the member types anything. Pure, tested; the same
 * patterns the feedback report's device line uses (src/lib/feedback/rules.ts).
 */
const IN_APP = /\bFBAN\/|\bFBAV\/|\bFB_IAB\/|\bInstagram\b/

export function isInAppBrowser(userAgent: string | null | undefined): boolean {
  return typeof userAgent === 'string' && IN_APP.test(userAgent)
}
