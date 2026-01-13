import assert from "node:assert/strict";
import { parseRules } from "../src/services/rules";

function validateJudgeOutput(payload: unknown): void {
  assert.ok(payload && typeof payload === "object");
  const verdict = payload as Record<string, unknown>;
  assert.equal(typeof verdict.summary, "string");
  assert.ok(Array.isArray(verdict.alleged_violations));
  assert.ok(["no_action", "warning", "timeout", "kick", "ban"].includes(String(verdict.recommended_action)));
  assert.ok(Array.isArray(verdict.fairness_notes));
}

const sampleRules = `1. Be respectful\n2. No spam\n- No hate speech`;
const parsed = parseRules(sampleRules);
assert.equal(parsed.length, 3);
assert.equal(parsed[0].id, "1");
assert.equal(parsed[2].id, "3");

validateJudgeOutput({
  summary: "Test",
  alleged_violations: [],
  recommended_action: "warning",
  fairness_notes: [],
});

console.log("rules.test.ts passed");
