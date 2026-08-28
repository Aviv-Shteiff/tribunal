// The budget gate (spec.md §6, decisions.md D-006). Checked in code before
// every model call. When the cap is reached the run stops; it does not warn
// and continue.

export class BudgetGate {
  #capUsd;
  #spentUsd = 0;
  #reserveUsd = 0; // most expensive single call recorded so far
  #callsWithUnknownCost = 0;

  constructor(capUsd) {
    if (!Number.isFinite(capUsd) || capUsd < 0) {
      throw new Error(`budget cap must be a non-negative number, got ${capUsd}`);
    }
    this.#capUsd = capUsd;
  }

  /**
   * Answers "may the next call be made?".
   *
   * The cost of a call is only known after it, so "could exceed the cap"
   * (spec.md §6) is read against a reserve: the most expensive call recorded
   * so far this run. Before the first call the reserve is 0, so the first call
   * always proceeds under a positive cap. The reserve is a recorded value, not
   * an estimate.
   */
  check() {
    const projected = this.#spentUsd + this.#reserveUsd;
    if (projected >= this.#capUsd) {
      return {
        allowed: false,
        reason:
          `budget cap reached: $${this.#spentUsd.toFixed(6)} spent, ` +
          `next call could cost up to $${this.#reserveUsd.toFixed(6)}, ` +
          `cap is $${this.#capUsd.toFixed(6)}`,
      };
    }
    return { allowed: true };
  }

  /**
   * Record what a call actually cost. A null cost (the API reported none) adds
   * nothing to the total and is counted separately rather than guessed at.
   */
  record(cost) {
    if (typeof cost === 'number' && Number.isFinite(cost)) {
      this.#spentUsd += cost;
      if (cost > this.#reserveUsd) this.#reserveUsd = cost;
    } else {
      this.#callsWithUnknownCost += 1;
    }
  }

  get capUsd() {
    return this.#capUsd;
  }

  get spentUsd() {
    return this.#spentUsd;
  }

  get reserveUsd() {
    return this.#reserveUsd;
  }

  get callsWithUnknownCost() {
    return this.#callsWithUnknownCost;
  }
}
