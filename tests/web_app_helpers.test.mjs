import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const PANEL_LOCAL_HELPERS = [
  "asArray",
  "formatDateTime",
  "compactUsdJa",
  "trim1",
];

test("app.js defines every panel-local helper it uses", async () => {
  const source = await readFile(new URL("../web/js/app.js", import.meta.url), "utf8");
  for (const helper of PANEL_LOCAL_HELPERS) {
    if (!source.includes(`${helper}(`)) continue;
    assert.match(
      source,
      new RegExp(`function\\s+${helper}\\s*\\(`),
      `${helper} is used in app.js but is only local to panels.js unless redefined`,
    );
  }
});
