const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertApplicationTransition,
  canTransitionApplicationStatus,
  normalizeApplicationStatus
} = require('./applicationWorkflow');

test('application workflow only accepts the defined status timeline', () => {
  assert.equal(canTransitionApplicationStatus('new', 'accepted'), true);
  assert.equal(canTransitionApplicationStatus('accepted', 'in_progress'), true);
  assert.equal(canTransitionApplicationStatus('in_progress', 'waiting_employee_confirmation'), true);
  assert.equal(canTransitionApplicationStatus('waiting_employee_confirmation', 'done'), true);
  assert.equal(canTransitionApplicationStatus('done', 'reopened'), true);
  assert.equal(canTransitionApplicationStatus('new', 'done'), false);
  assert.throws(() => assertApplicationTransition('accepted', 'done'), /Недопустимый/);
  assert.equal(normalizeApplicationStatus('unknown', 'reopened'), 'reopened');
});

test('a completed request can be reopened directly into work', () => {
  assert.equal(canTransitionApplicationStatus('done', 'in_progress'), true);
});
