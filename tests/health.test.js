const test = require("node:test");
const assert = require("node:assert/strict");

test("health endpoint route is defined in server", async () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require("node:path").join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /app\.get\(["']\/api\/health["']/);
  assert.match(source, /service: "collaborative-editor"/);
});
