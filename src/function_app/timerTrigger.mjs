import { runSupplySentinel } from "../supply_sentinel/workflow.mjs";

export async function timerTrigger(context, myTimer) {
  context.log("Supply Sentinel timer trigger started.", myTimer);
  const result = await runSupplySentinel();
  context.log(`Supply Sentinel generated ${result.assessment.alert_id} with score ${result.assessment.risk_score}.`);
}
