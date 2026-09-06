export interface AttemptTimeout {
  /** Combined signal: per-attempt deadline plus optional caller cancellation. */
  readonly signal: AbortSignal;
  /** True only when our per-attempt timer fired — not when the caller aborted. */
  didTimeout(): boolean;
  /** True when the caller's signal caused the abort. */
  didCallerAbort(): boolean;
  /** Clears the pending timer; call in a finally block. */
  dispose(): void;
}

/**
 * Per-attempt AbortController composed with the caller signal via AbortSignal.any.
 * Records which source fired so retries can distinguish timeout from cancellation.
 */
export function createAttemptTimeout(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): AttemptTimeout {
  const timeoutController = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  const signals: AbortSignal[] = [timeoutController.signal];
  if (callerSignal !== undefined) {
    signals.push(callerSignal);
  }

  const signal = AbortSignal.any(signals);

  return {
    signal,
    didTimeout: () => timedOut,
    didCallerAbort: () => !timedOut && (callerSignal?.aborted ?? false),
    dispose: () => {
      clearTimeout(timer);
    },
  };
}
