import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(projectRoot, "src");

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(fullPath);
  }
  return files;
}

function read(relativePath) {
  return fs.readFileSync(path.join(srcRoot, relativePath), "utf8");
}

test("bridge application depends on ports, not infrastructure adapters", () => {
  for (const file of walk(path.join(srcRoot, "application"))) {
    const content = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      content,
      /from "\.\.\/(?:infrastructure|presentation|config|security)\//u,
      `${path.relative(projectRoot, file)} must not import outer layers`,
    );
  }
});

test("bridge composition root wires infrastructure into application", () => {
  const indexSource = read("index.mjs");
  const serverSource = read(path.join("presentation", "server.mjs"));
  const botSource = read(path.join("application", "bot.mjs"));

  assert.match(indexSource, /from "\.\/infrastructure\/question-api\.mjs"/u);
  assert.match(indexSource, /questionPoster: postQuestion/u);
  assert.match(serverSource, /createBot\(\{ config, store, questionPoster \}\)/u);
  assert.match(botSource, /questionPoster = disabledQuestionPoster/u);
});
