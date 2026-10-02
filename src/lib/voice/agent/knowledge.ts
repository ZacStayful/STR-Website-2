/**
 * Batch 23: what the phone agent may answer from — the site's FAQs
 * (src/lib/faqs-data.ts, with the live prices) and the service guide.
 * Rendered into the agent's prompt with an id per entry, so the agent can
 * report which one it used (log_question's knowledge_ref) for Batch 24.
 *
 * Pure.
 */
import type { FAQItem } from '../../faqs-data.ts';
import type { GuideEntry } from './service-guide.ts';

export function renderKnowledge(faqs: readonly FAQItem[], trustFaqs: readonly FAQItem[], guide: readonly GuideEntry[]): string {
  const lines: string[] = [];
  guide.forEach((g) => lines.push(`[${g.id}] ${g.topic}: ${g.text}`));
  faqs.forEach((f, i) => lines.push(`[faq.${i + 1}] ${f.q} ${f.a}`));
  trustFaqs.forEach((f, i) => lines.push(`[trust.${i + 1}] ${f.q} ${f.a}`));
  return lines.join('\n');
}
