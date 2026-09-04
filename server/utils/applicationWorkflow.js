const APPLICATION_STATUSES = new Set([
  'new',
  'accepted',
  'in_progress',
  'waiting_employee_confirmation',
  'done',
  'reopened'
]);

const ALLOWED_APPLICATION_TRANSITIONS = {
  new: new Set(['accepted', 'in_progress']),
  reopened: new Set(['accepted', 'in_progress']),
  accepted: new Set(['in_progress']),
  in_progress: new Set(['waiting_employee_confirmation', 'done', 'reopened']),
  waiting_employee_confirmation: new Set(['done', 'reopened']),
  done: new Set(['reopened', 'in_progress'])
};

const normalizeApplicationStatus = (value, fallback = 'new') => (
  APPLICATION_STATUSES.has(String(value || '').trim())
    ? String(value).trim()
    : fallback
);

const canTransitionApplicationStatus = (from, to) => {
  const source = normalizeApplicationStatus(from);
  const target = normalizeApplicationStatus(to, '');
  return source === target || Boolean(ALLOWED_APPLICATION_TRANSITIONS[source]?.has(target));
};

const assertApplicationTransition = (from, to) => {
  if (canTransitionApplicationStatus(from, to)) return;
  const error = new Error('Недопустимый переход статуса заявки');
  error.status = 409;
  error.code = 'APPLICATION_INVALID_TRANSITION';
  throw error;
};

module.exports = {
  APPLICATION_STATUSES,
  ALLOWED_APPLICATION_TRANSITIONS,
  assertApplicationTransition,
  canTransitionApplicationStatus,
  normalizeApplicationStatus
};
