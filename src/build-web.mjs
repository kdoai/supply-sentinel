import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runSupplySentinel } from "./supply_sentinel/workflow.mjs";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "outputs", "latest");
const webDir = path.join(rootDir, "web");

const result = await runSupplySentinel({ rootDir, outputDir });

await mkdir(webDir, { recursive: true });
await copyFile(
  path.join(outputDir, "dashboard_data.json"),
  path.join(webDir, "dashboard_data.json"),
);

console.log("GitHub Pages assets prepared.");
console.log(`Risk score: ${result.assessment.risk_score}/100`);
console.log(`Web entry: ${path.join(webDir, "index.html")}`);
console.log(`Dashboard data: ${path.join(webDir, "dashboard_data.json")}`);
