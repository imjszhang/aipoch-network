import type { MetricObservation, Observation, SourceActivity } from '../spec/types.js';

export const MAX_METRIC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
type Result = MetricObservation['result'];

/** GitHub timestamps are UTC; reject normalized impossible calendar dates. */
export function utcTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return;
  const canonical = new Date(time).toISOString();
  return canonical === value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z') ? canonical : undefined;
}

/** Keep the original observation time on failure, with at most seven days of values. */
export function failedMetric(previous: MetricObservation | undefined, at: string, result: Exclude<Result, 'ok'>): MetricObservation {
  const time = utcTimestamp(previous?.observed_at);
  const age = time ? Date.parse(at) - Date.parse(time) : Infinity;
  const retain = previous?.value !== undefined && Number.isSafeInteger(previous.value) && previous.value >= 0 && age >= 0 && age <= MAX_METRIC_AGE_MS;
  return { ...(retain ? { value: previous!.value, observed_at: time } : {}), last_attempt_at: at, result, visibility: 'public_api' };
}

export function metricObservation(value: unknown, at: string, previous?: MetricObservation): MetricObservation {
  if (value === undefined || value === null) return failedMetric(previous, at, 'unsupported');
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return failedMetric(previous, at, 'invalid_response');
  return { value, observed_at: at, last_attempt_at: at, result: 'ok', visibility: 'public_api' };
}

/** A 304 covers only fields that were present in the validated response. */
export function revalidatedMetric(previous: MetricObservation | undefined, at: string): MetricObservation {
  return (previous?.result === 'ok' || previous?.result === 'unavailable') && previous.value !== undefined
    ? metricObservation(previous.value, at)
    : failedMetric(previous, at, previous?.result === 'invalid_response' ? 'invalid_response' : 'unsupported');
}

export function observation(at: string, result: Result, previous?: Observation): Observation {
  return { last_attempt_at: at, ...(result === 'ok' ? { last_success_at: at } : previous?.last_success_at ? { last_success_at: previous.last_success_at } : {}), result };
}

export function failedActivity(previous: SourceActivity | undefined, at: string, result: Exclude<Result, 'ok'> = 'unavailable'): SourceActivity {
  const head = previous?.default_branch_head;
  const age = head ? Date.parse(at) - Date.parse(head.observed_at) : Infinity;
  return { ...(head && age >= 0 && age <= MAX_METRIC_AGE_MS ? { default_branch_head: { ...head } } : {}), observation: observation(at, result, previous?.observation) };
}

export function copyMetric(metric: MetricObservation): MetricObservation {
  return { ...(metric.value !== undefined ? { value: metric.value } : {}), ...(metric.observed_at ? { observed_at: metric.observed_at } : {}),
    last_attempt_at: metric.last_attempt_at, result: metric.result, visibility: metric.visibility };
}
export function copyObservation(value: Observation): Observation {
  return { last_attempt_at: value.last_attempt_at, ...(value.last_success_at ? { last_success_at: value.last_success_at } : {}), result: value.result };
}
export function copyActivity(value: SourceActivity): SourceActivity {
  const head = value.default_branch_head;
  return { ...(head ? { default_branch_head: { sha: head.sha, ...(head.committed_at ? { committed_at: head.committed_at } : {}), observed_at: head.observed_at, date_status: head.date_status } } : {}),
    ...(value.observation ? { observation: copyObservation(value.observation) } : {}) };
}
