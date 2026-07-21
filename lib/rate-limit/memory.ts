interface MemoryRateLimitRule<Name extends string = string> {
  key: string;
  limit: number;
  name: Name;
  windowMs: number;
}

interface MemoryRateLimitDecision<Name extends string = string> {
  allowed: boolean;
  limit: number;
  name: Name;
  remaining: number;
  resetAt: number;
}

interface MemoryRateLimitState {
  currentCount: number;
  currentStartedAt: number;
  previousCount: number;
  windowMs: number;
}

interface EvaluatedMemoryRule<Name extends string> {
  allowed: boolean;
  resetAt: number;
  rule: MemoryRateLimitRule<Name>;
  state: MemoryRateLimitState;
  usedRequests: number;
}

type MemoryRateLimitStore = Map<string, MemoryRateLimitState>;

const getWindowStartedAt = (now: number, windowMs: number): number =>
  Math.floor(now / windowMs) * windowMs;

const getCurrentState = <Name extends string>(
  store: MemoryRateLimitStore,
  rule: MemoryRateLimitRule<Name>,
  now: number
): MemoryRateLimitState => {
  const currentStartedAt = getWindowStartedAt(now, rule.windowMs);
  const existing = store.get(rule.key);

  if (
    existing?.windowMs === rule.windowMs &&
    existing.currentStartedAt === currentStartedAt
  ) {
    return existing;
  }

  const previousStartedAt = currentStartedAt - rule.windowMs;
  const state: MemoryRateLimitState = {
    currentCount: 0,
    currentStartedAt,
    previousCount:
      existing?.windowMs === rule.windowMs &&
      existing.currentStartedAt === previousStartedAt
        ? existing.currentCount
        : 0,
    windowMs: rule.windowMs,
  };
  store.set(rule.key, state);
  return state;
};

const getDeniedResetAt = ({
  limit,
  state,
}: {
  limit: number;
  state: MemoryRateLimitState;
}): number => {
  if (state.currentCount < limit && state.previousCount > 0) {
    return (
      state.currentStartedAt +
      Math.floor(
        state.windowMs -
          ((limit - state.currentCount) * state.windowMs) / state.previousCount
      ) +
      1
    );
  }

  return (
    state.currentStartedAt +
    state.windowMs +
    Math.floor(state.windowMs - (limit * state.windowMs) / state.currentCount) +
    1
  );
};

const evaluateMemoryRule = <Name extends string>(
  store: MemoryRateLimitStore,
  rule: MemoryRateLimitRule<Name>,
  now: number
): EvaluatedMemoryRule<Name> => {
  const state = getCurrentState(store, rule, now);
  const elapsedMs = now - state.currentStartedAt;
  const weightedPrevious = Math.floor(
    (state.previousCount * (state.windowMs - elapsedMs)) / state.windowMs
  );
  const usedRequests = state.currentCount + weightedPrevious;
  const allowed = usedRequests < rule.limit;

  return {
    allowed,
    resetAt: allowed
      ? state.currentStartedAt + state.windowMs
      : getDeniedResetAt({ limit: rule.limit, state }),
    rule,
    state,
    usedRequests,
  };
};

const consumeMemoryRateLimits = <Name extends string>(
  store: MemoryRateLimitStore,
  rules: readonly MemoryRateLimitRule<Name>[],
  now: number
): MemoryRateLimitDecision<Name>[] => {
  const evaluatedRules = rules.map((rule) =>
    evaluateMemoryRule(store, rule, now)
  );
  const allRulesAllowed = evaluatedRules.every(({ allowed }) => allowed);

  if (allRulesAllowed) {
    for (const { state } of evaluatedRules) {
      state.currentCount += 1;
    }
  }

  return evaluatedRules.map(
    ({
      allowed,
      resetAt,
      rule,
      usedRequests,
    }): MemoryRateLimitDecision<Name> => ({
      allowed,
      limit: rule.limit,
      name: rule.name,
      remaining: Math.max(
        0,
        rule.limit - usedRequests - (allRulesAllowed ? 1 : 0)
      ),
      resetAt,
    })
  );
};

export type {
  MemoryRateLimitDecision,
  MemoryRateLimitRule,
  MemoryRateLimitStore,
};
export { consumeMemoryRateLimits };
