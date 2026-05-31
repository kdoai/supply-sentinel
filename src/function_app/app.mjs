import { app } from "@azure/functions";
import { runTimer } from "./timerTrigger.mjs";
import { latestDashboardHandler } from "./httpLatestDashboard.mjs";

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
