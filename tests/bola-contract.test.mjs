import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/orders/[id]/route.ts", import.meta.url), "utf8");
const data = await readFile(new URL("../app/lib/data.ts", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("orders route exports GET and accepts a plain numeric id", () => {
  assert.match(route, /export\s+async\s+function\s+GET/);
  assert.match(route, /\/\^\\d\+\$\//);
  assert.match(readme, /\/api\/orders\/4021/);
});

test("orders response exposes top-level ownerId", () => {
  assert.match(route, /ownerId:\s*order\.ownerId/);
  assert.match(data, /ownerId:\s*"usr_101"/);
});

test("route is intentionally authenticated but not owner scoped", () => {
  assert.match(route, /requireUserResponse/);
  assert.doesNotMatch(route, /order\.ownerId\s*!==\s*auth\.user\.id/);
  assert.doesNotMatch(route, /order\.ownerId\s*===\s*auth\.user\.id/);
  assert.match(route, /Intentional BOLA/);
});
