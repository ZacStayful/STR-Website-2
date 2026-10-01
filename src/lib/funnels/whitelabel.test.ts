import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripStayfulPitch } from './whitelabel.ts';

test('Batch 21 (C1): the Stayful pitch leaves a white-label disclaimer, the rest stays', () => {
  assert.equal(
    stripStayfulPitch('Limited data available for this area. This property may be in a unique or rural location, which can be advantageous for short-term letting. Book a web meeting with Stayful for a more detailed, personalised assessment.'),
    'Limited data available for this area. This property may be in a unique or rural location, which can be advantageous for short-term letting.',
  );
  assert.equal(
    stripStayfulPitch('No comparable properties accommodating ~4 guests were found. Market-level estimates have been used. Book a web meeting with Stayful for accurate, personalised revenue projections.'),
    'No comparable properties accommodating ~4 guests were found. Market-level estimates have been used.',
  );
  assert.equal(stripStayfulPitch('Unable to fetch short-term rental data. Book a web meeting with Stayful for a personalised assessment.'), 'Unable to fetch short-term rental data.');
  // A disclaimer that never mentioned us is untouched.
  assert.equal(stripStayfulPitch('Only 3 comparable properties were found within 5km.'), 'Only 3 comparable properties were found within 5km.');
  assert.equal(stripStayfulPitch(null), '');
});
