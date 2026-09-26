import { SMS_NOTIFICATION_TYPES, type NotificationState } from "@/lib/notifications/registry";
import type { SmsContact } from "@/lib/sms/store";
import { maskPhone } from "@/lib/sms/phone";
import { setNotificationAction } from "./actions";
import { setSmsEnabledAction } from "./sms-actions";
import { ChangeNumber, VerifyNumber } from "./VerifyNumber";

const ON = "rounded-full bg-[#5d8156] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[#4c6b46]";
const OFF = "rounded-full border border-[#e4e7dc] bg-white px-4 py-1.5 text-sm font-semibold text-[#7a8274] transition hover:bg-[#f1f3ec]";

/**
 * Texts (Batch 8): the member's number, whether it is verified, a way to add
 * or change it, their own on/off, and one switch per kind of text (registry
 * entries, channel 'sms'). Off for everyone until they verify a number.
 */
export function SmsSection({
  contact,
  state,
  available,
  askedAtSignup,
  suggestedPhone,
  monthlyCap,
}: {
  contact: SmsContact | null;
  state: NotificationState;
  /** Twilio configured (or a dry run): codes can be sent. */
  available: boolean;
  /** They ticked "Text me…" when they signed up. */
  askedAtSignup: boolean;
  /** Their signup mobile, when it is a UK mobile: pre-filled, never used unverified. */
  suggestedPhone: string | null;
  monthlyCap: number;
}) {
  const verified = Boolean(contact?.verified_at && contact.phone_e164);
  const rules = `At most one text a day, between 8am and 8pm, and no more than ${monthlyCap} a month. Texts are free. Reply STOP to any text to stop them all.`;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">Texts</h2>
      <p className="mt-1 text-sm text-[#7a8274]">A text within the hour when something changes on a deal you track, so you can act before someone else does. Your daily and weekly updates stay on email.</p>

      <div className="mt-4 rounded-2xl border border-[#e4e7dc] bg-white p-5">
        {!verified && (
          <>
            {askedAtSignup && available && (
              <p className="mb-4 rounded-lg bg-[#eef3ea] px-3 py-2 text-sm text-[#3f5c3a]">You asked for texts when you signed up. Verify your number to start them.</p>
            )}
            {available ? (
              <VerifyNumber defaultPhone={suggestedPhone ?? ""} />
            ) : (
              <p className="text-sm text-[#7a8274]">Texts are not available just yet. Check back soon.</p>
            )}
            <p className="mt-4 text-xs text-[#7a8274]">{rules}</p>
          </>
        )}

        {verified && contact && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-semibold">
                  {maskPhone(contact.phone_e164)} <span className="ml-1 rounded-full bg-[#eef3ea] px-2 py-0.5 text-xs font-semibold text-[#3f5c3a]">Verified</span>
                </p>
                <p className="mt-0.5 text-sm text-[#7a8274]">{contact.stopped_at ? "You replied STOP, so we will not text you." : contact.enabled ? "Texts are on." : "Texts are off."}</p>
              </div>
              {!contact.stopped_at && (
                <form action={setSmsEnabledAction} className="shrink-0">
                  <input type="hidden" name="on" value={contact.enabled ? "0" : "1"} />
                  <button type="submit" role="switch" aria-checked={contact.enabled} aria-label={`Texts: turn ${contact.enabled ? "off" : "on"}`} className={contact.enabled ? ON : OFF}>
                    {contact.enabled ? "On" : "Off"}
                  </button>
                </form>
              )}
            </div>

            {contact.stopped_at && (
              <p className="mt-3 rounded-lg bg-[#fbf6e9] px-3 py-2 text-sm text-[#6b5a2e]">To get texts again, reply START to any text from us. Or verify a different number below.</p>
            )}

            {contact.enabled && !contact.stopped_at && (
              <ul className="mt-4 divide-y divide-[#e4e7dc] border-t border-[#e4e7dc]">
                {SMS_NOTIFICATION_TYPES.map((t) => {
                  const on = state[t.key];
                  return (
                    <li key={t.key} className="flex items-start justify-between gap-4 py-4 last:pb-0">
                      <div>
                        <p className="font-semibold">{t.label}</p>
                        <p className="mt-0.5 text-sm text-[#7a8274]">{t.description}</p>
                      </div>
                      <form action={setNotificationAction} className="shrink-0">
                        <input type="hidden" name="key" value={t.key} />
                        <input type="hidden" name="on" value={on ? "0" : "1"} />
                        <button type="submit" role="switch" aria-checked={on} aria-label={`${t.label} texts: turn ${on ? "off" : "on"}`} className={on ? ON : OFF}>
                          {on ? "On" : "Off"}
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}

            {available && (
              <div className="mt-4 border-t border-[#e4e7dc] pt-4">
                <ChangeNumber />
              </div>
            )}
            <p className="mt-4 text-xs text-[#7a8274]">{rules}</p>
          </>
        )}
      </div>
    </section>
  );
}
