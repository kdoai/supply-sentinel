import { runSupplySentinel } from "./supply_sentinel/workflow.mjs";

const result = await runSupplySentinel();

console.log("Supply Sentinel demo run completed.");
console.log(`Output directory: ${result.outputDir}`);
console.log(`Material: ${result.assessment.material}`);
console.log(`Risk score: ${result.assessment.risk_score}/100`);
console.log(`Severity: ${result.assessment.severity}`);
console.log(`Impacted products: ${result.assessment.impacted_products.join(", ")}`);
console.log(`Impacted customers: ${result.assessment.impacted_customers.join(", ")}`);
console.log(`Minimum inventory days: ${result.assessment.inventory_days_min}`);
