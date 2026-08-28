import test from 'node:test';
import assert from 'node:assert/strict';

import { BudgetGate } from '../src/budget.js';
import { loadConfig } from '../src/config.js';

test('the first call proceeds under a positive cap — the reserve starts at zero', () => {
  const gate = new BudgetGate(0.01);
  assert.equal(gate.check().allowed, true);
  assert.equal(gate.reserveUsd, 0);
});

test('the reserve is the most expensive recorded call', () => {
  const gate = new BudgetGate(10);
  gate.record(0.002);
  gate.record(0.007);
  gate.record(0.001);
  assert.equal(gate.reserveUsd, 0.007);
  assert.ok(Math.abs(gate.spentUsd - 0.01) < 1e-12);
});

test('stops when spent plus reserve reaches the cap', () => {
  const gate = new BudgetGate(0.01);
  gate.record(0.004);
  assert.equal(gate.check().allowed, true, '0.004 + 0.004 is under 0.01');

  gate.record(0.004);
  const blocked = gate.check(); // 0.008 + 0.004 >= 0.01
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /budget cap reached/);
  assert.match(blocked.reason, /could cost up to/);
});

test('a cap below one call cost blocks every call after the first', () => {
  const gate = new BudgetGate(0.0001);
  assert.equal(gate.check().allowed, true);
  gate.record(0.05);
  assert.equal(gate.check().allowed, false);
});

test('a zero cap blocks the first call', () => {
  assert.equal(new BudgetGate(0).check().allowed, false);
});

test('a call with no reported cost is counted, not guessed at', () => {
  const gate = new BudgetGate(1);
  gate.record(null);
  gate.record(undefined);
  assert.equal(gate.spentUsd, 0);
  assert.equal(gate.callsWithUnknownCost, 2);
  assert.equal(gate.check().allowed, true);
});

test('an invalid cap is refused at construction', () => {
  assert.throws(() => new BudgetGate(-1));
  assert.throws(() => new BudgetGate(Number.NaN));
  assert.throws(() => new BudgetGate('5.00'));
});

test('the cap comes from RUN_BUDGET_USD, defaulting to 5.00', () => {
  assert.equal(loadConfig({ RUN_BUDGET_USD: '0.25' }).budgetUsd, 0.25);
  assert.equal(loadConfig({}).budgetUsd, 5.0);
  assert.equal(loadConfig({ RUN_BUDGET_USD: '' }).budgetUsd, 5.0);
  assert.throws(() => loadConfig({ RUN_BUDGET_USD: 'free' }));
  assert.throws(() => loadConfig({ RUN_BUDGET_USD: '-1' }));
});
