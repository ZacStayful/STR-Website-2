/**
 * The same body rules sendSms enforces (src/lib/sms/send.ts bodyProblem),
 * without its server imports, for the templates' tests and the cron's dry run.
 * Pure.
 */
import { MAX_SMS_LENGTH, OPT_OUT_LINE, gsmLength } from '../sms/gsm.ts';

export function bodyProblemFor(body: string): 'not_gsm' | 'too_long' | 'no_opt_out' | null {
  const n = gsmLength(body);
  if (n === null) return 'not_gsm';
  if (n === 0 || n > MAX_SMS_LENGTH) return 'too_long';
  if (!body.endsWith(OPT_OUT_LINE)) return 'no_opt_out';
  return null;
}
