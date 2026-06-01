import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_COMPANY_POLICY,
  classifyImpact,
  normalizePolicy,
  priorityScore,
} from "../web/js/companyPolicy.js";

test("company policy name and thresholds are normalized", () => {
  const policy = normalizePolicy({
    company_policy_name: "Custom SCM Policy",
    thresholds: {
      attention: { min_inventory_days: "20", affected_supply_ratio_percent: "15" },
    },
  });

  assert.equal(policy.company_policy_name, "Custom SCM Policy");
  assert.equal(policy.thresholds.attention.min_inventory_days, 20);
  assert.equal(policy.thresholds.danger.min_inventory_days, 14);
  assert.equal(policy.early_preparation_trigger.remaining_supply_ratio_percent_below, 30);
});

test("changing thresholds changes the warning label", () => {
  const metrics = { inventory_days_min: 10, affected_supply_ratio_percent: 40 };

  const defaultLevel = classifyImpact(metrics, DEFAULT_COMPANY_POLICY);
  const relaxedLevel = classifyImpact(metrics, {
    ...DEFAULT_COMPANY_POLICY,
    thresholds: {
      attention: { min_inventory_days: 30, affected_supply_ratio_percent: 20 },
      danger: { min_inventory_days: 7, affected_supply_ratio_percent: 55 },
      stop_or_allocation_decision: { min_inventory_days: 3, affected_supply_ratio_percent: 80 },
    },
  });

  assert.equal(defaultLevel.key, "danger");
  assert.equal(relaxedLevel.key, "attention");
});

test("priority weights can flip product priority math", () => {
  const customerHeavy = {
    ...DEFAULT_COMPANY_POLICY,
    priority_weights: {
      customer_priority: 0.7,
      revenue_impact: 0.1,
      inventory_days: 0.1,
      alternative_availability: 0.05,
      single_supplier_dependency: 0.05,
    },
  };
  const revenueHeavy = {
    ...DEFAULT_COMPANY_POLICY,
    priority_weights: {
      customer_priority: 0.1,
      revenue_impact: 0.7,
      inventory_days: 0.1,
      alternative_availability: 0.05,
      single_supplier_dependency: 0.05,
    },
  };

  const highCustomerLowRevenue = {
    customer_priority: 100,
    revenue_impact: 40,
    inventory_days: 50,
    alternative_availability: 50,
    single_supplier_dependency: 80,
  };
  const mediumCustomerHighRevenue = {
    customer_priority: 60,
    revenue_impact: 100,
    inventory_days: 50,
    alternative_availability: 50,
    single_supplier_dependency: 50,
  };

  assert.ok(priorityScore(highCustomerLowRevenue, customerHeavy) > priorityScore(mediumCustomerHighRevenue, customerHeavy));
  assert.ok(priorityScore(mediumCustomerHighRevenue, revenueHeavy) > priorityScore(highCustomerLowRevenue, revenueHeavy));
});
