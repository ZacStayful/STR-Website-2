import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { QUIZ_IMAGES, quizImage, quizPhotoFiles, QUIZ_IMAGE_DIR } from './images.ts';

test('every photo the quiz refers to is in public/profile-quiz', () => {
  const dir = join(process.cwd(), 'public', QUIZ_IMAGE_DIR);
  for (const file of quizPhotoFiles()) assert.ok(existsSync(join(dir, file)), `missing ${file}`);
  assert.equal(quizPhotoFiles().length, 19, 'the whole image set is used');
});

test('photos resolve to a public path; graphics to a name', () => {
  assert.deepEqual(quizImage('start'), { kind: 'photo', src: '/profile-quiz/04-apartment-living-floor-to-ceiling-windows.webp', name: '04-apartment-living-floor-to-ceiling-windows' });
  assert.deepEqual(quizImage('where'), { kind: 'graphic', name: 'map' });
  assert.deepEqual(quizImage('finance'), { kind: 'graphic', name: 'icon' });
  assert.deepEqual(quizImage('condition_project'), { kind: 'graphic', name: 'project' });
  assert.equal(QUIZ_IMAGES.done, '10-bold-maximalist-unicorn');
});
