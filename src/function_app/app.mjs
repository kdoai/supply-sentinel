import { app } from "@azure/functions";
import { runTimer } from "./timerTrigger.mjs";
import { latestDashboardHandler } from "./httpLatestDashboard.mjs";
import { agentAdviceHandler } from "./httpAgentAdvice.mjs";
import { runAgentHandler } from "./httpRunAgent.mjs";

app.timer("supply-sentinel-timer", {
  schedule: process.env.SUPPLY_SENTINEL_TIMER_SCHEDULE || "0 0 */6 * * *",
  handler: runTimer,
});

app.http("latest-dashboard", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "latest-dashboard",
  handler: latestDashboardHandler,
});

app.http("agent-advice", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "agent-advice",
  handler: agentAdviceHandler,
});

app.http("run-agent", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "run-agent",
  handler: runAgentHandler,
});
