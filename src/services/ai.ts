import OpenAI from "openai";
import type { ParsedRule } from "./rules";
import type { EvidenceMessage } from "./evidence";

export interface LawyerOutput {
  defense_summary: string;
  mitigating_factors: string[];
  alternative_actions: string[];
  apology_or_repair_suggestion: string;
}

export interface JudgeOutput {
  summary: string;
  alleged_violations: Array<{
    rule_id: string;
    rule_quote: string;
    evidence_refs: string[];
    explanation: string;
    confidence_0_1: number;
  }>;
  recommended_action: "no_action" | "warning" | "timeout" | "kick" | "ban";
  recommended_duration_minutes?: number;
  fairness_notes: string[];
}

export function createOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

function buildEvidenceSummary(evidence: EvidenceMessage[]): string {
  if (evidence.length === 0) {
    return "No evidence available.";
  }

  return evidence
    .map(
      (msg, index) =>
        `[#${index + 1}] ${msg.timestamp} in #${msg.channelName}: ${msg.content}`
    )
    .join("\n");
}

export async function runLawyer(options: {
  client: OpenAI;
  model: string;
  rules: ParsedRule[];
  evidence: EvidenceMessage[];
  suspectTag: string;
}): Promise<LawyerOutput> {
  const { client, model, rules, evidence, suspectTag } = options;
  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an AI Lawyer defending a Discord user in a courtroom moderation process. Reply ONLY with valid JSON.",
      },
      {
        role: "user",
        content: JSON.stringify({
          suspect: suspectTag,
          rules,
          evidence_summary: buildEvidenceSummary(evidence),
          output_schema: {
            defense_summary: "string",
            mitigating_factors: ["string"],
            alternative_actions: ["string"],
            apology_or_repair_suggestion: "string",
          },
        }),
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  return JSON.parse(content) as LawyerOutput;
}

export async function runJudge(options: {
  client: OpenAI;
  model: string;
  rules: ParsedRule[];
  evidence: EvidenceMessage[];
  suspectTag: string;
  lawyerOutput: LawyerOutput | null;
}): Promise<JudgeOutput> {
  const { client, model, rules, evidence, suspectTag, lawyerOutput } = options;
  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are an AI Judge analyzing Discord rule violations. Reply ONLY with valid JSON.",
      },
      {
        role: "user",
        content: JSON.stringify({
          suspect: suspectTag,
          rules,
          evidence_summary: buildEvidenceSummary(evidence),
          lawyer_output: lawyerOutput,
          instructions:
            "If confidence is low, prefer lighter actions like warning or timeout.",
          output_schema: {
            summary: "string",
            alleged_violations: [
              {
                rule_id: "string",
                rule_quote: "string",
                evidence_refs: ["string"],
                explanation: "string",
                confidence_0_1: 0.5,
              },
            ],
            recommended_action: "no_action | warning | timeout | kick | ban",
            recommended_duration_minutes: "number (optional)",
            fairness_notes: ["string"],
          },
        }),
      },
    ],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  return JSON.parse(content) as JudgeOutput;
}
