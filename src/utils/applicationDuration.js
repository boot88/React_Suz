// Used by API mutations and live cards. work_seconds contains completed segments.
const timestamp = (value) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const raw = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
};
const applicationWorkSeconds = (application, now = Date.now()) => {
  const stored = application.work_seconds != null;
  const cycles = Array.isArray(application.work_cycles) ? application.work_cycles : [];
  const base = stored ? Math.max(0, Number(application.work_seconds) || 0) : cycles.filter((cycle) => cycle.closed_at).reduce((sum, cycle) => sum + Math.max(0, Number(cycle.duration_seconds) || 0), 0);
  const status = application.status || (application.fl ? 'done' : 'new');
  const taken = application.work_started_at || application.accepted_at || (application.accepted_by ? application.start_data : null);
  if (application.fl || status === 'done') {
    const closed = timestamp(application.employee_confirmed_at || application.end_data || application.resolved_at);
    return stored || base ? base : (timestamp(taken) && closed ? Math.max(0, Math.floor((closed - timestamp(taken)) / 1000)) : 0);
  }
  if (!['accepted', 'in_progress', 'waiting_employee_confirmation'].includes(status)) return base;
  const start = status === 'waiting_employee_confirmation' && stored
    ? application.resolved_at || taken : taken;
  const from = timestamp(start), to = timestamp(now instanceof Date ? now : new Date(now));
  return base + (from && to ? Math.max(0, Math.floor((to - from) / 1000)) : 0);
};
module.exports = { applicationWorkSeconds };
