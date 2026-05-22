import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonStore } from "../src/infrastructure/store.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kakao-openchat-store-"));
}

test("JsonStore restores state from backup when primary JSON is corrupt", () => {
  const dir = tempDir();
  const first = new JsonStore(dir);
  first.setNotice("공지");
  first.addGuide("가이드", "https://example.com");
  first.setNotice("새 공지");

  fs.writeFileSync(path.join(dir, "state.json"), "{broken");
  const restored = new JsonStore(dir);

  assert.equal(restored.state.notice, "공지");
  assert.deepEqual(restored.state.guides, [{ label: "가이드", url: "https://example.com" }]);
});

test("JsonStore rotates event log by size", () => {
  const dir = tempDir();
  const store = new JsonStore(dir, { eventLogMaxBytes: 120 });

  store.appendEvent({ type: "first", pad: "x".repeat(80) });
  store.appendEvent({ type: "second", pad: "y".repeat(80) });

  assert.equal(fs.existsSync(path.join(dir, "events.jsonl.1")), true);
  const current = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8");
  assert.match(current, /second/u);
});
