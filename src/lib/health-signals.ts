export type HealthCheckResult = {
  success: boolean;
  durationMs: number;
  error?: string;
  code?: string;
  checkedAt?: string;
};

type Signal = {
  success?: HealthCheckResult;
  /** Completion time of the latest success. */
  successAt: number;
  /** Latest start time of any success; only a success that began after a failure clears it. */
  successStartedAt: number;
  failure?: HealthCheckResult;
  failureAt: number;
};

// shortcut: in-memory per process, shared across route bundles via globalThis; every replica and restart
// starts empty and relies on its own traffic and probes. Move to Redis if replicas need a shared view.
const shared = globalThis as typeof globalThis & { ventryHealthSignals?: Map<string, Signal> };

function signals() {
  shared.ventryHealthSignals ??= new Map();
  return shared.ventryHealthSignals;
}

/**
 * Records the outcome of real traffic or a probe. `startedAt` (performance.now()) is when the observed
 * operation began, so a slow success that started before a failure cannot hide it.
 */
export function recordHealthSignal(name: string, result: HealthCheckResult, startedAt = performance.now()) {
  const now = performance.now();
  const recorded = { ...result, checkedAt: new Date().toISOString() };
  const signal = signals().get(name) ?? { successAt: -Infinity, successStartedAt: -Infinity, failureAt: -Infinity };
  if (result.success) {
    signal.success = recorded;
    signal.successAt = now;
    signal.successStartedAt = Math.max(signal.successStartedAt, startedAt);
  } else {
    signal.failure = recorded;
    signal.failureAt = now;
  }
  signals().set(name, signal);
  return recorded;
}

/** The current signal, or undefined when nothing recent enough is known and the caller should probe. */
export function getHealthSignal(name: string, successMaxAgeMs: number, failureMaxAgeMs: number) {
  const signal = signals().get(name);
  if (!signal) return undefined;
  const now = performance.now();
  // Ties go to the failure: only a success that began strictly after it proves recovery.
  if (signal.failure && signal.successStartedAt <= signal.failureAt) {
    return now - signal.failureAt < failureMaxAgeMs ? signal.failure : undefined;
  }
  return signal.success && now - signal.successAt < successMaxAgeMs ? signal.success : undefined;
}
