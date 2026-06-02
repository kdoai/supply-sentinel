import { runSupplySentinel } from "../supply_sentinel/workflow.mjs";

export async function runTimer(myTimer, context = console) {
  context.log("Supply Sentinel timer trigger started.", myTimer);
  const result = await runSupplySentinel({
    trigger: {
      type: "scheduled",
      schedule: process.env.SUPPLY_SENTINEL_TIMER_CRON || process.env.SUPPLY_SENTINEL_TIMER_SCHEDULE || "0 */6 * * *",
      requested_at: new Date().toISOString(),
    },
  });
  context.log(`Supply Sentinel generated ${result.assessment.alert_id} with score ${result.assessment.risk_score}.`);
}

export async function timerTrigger(context, myTimer) {
  return runTimer(myTimer, context);
}
