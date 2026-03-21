import "server-only";
import type { TaskSpec, Role, GateResult as PipelineGateResult } from "./types";

export function compile(spec: TaskSpec, agent: string, role: Role): string {
  switch (agent) {
    case "codex":
      return compileCodex(spec, role);
    default:
      return compileClaude(spec, role);
  }
}

function compileClaude(spec: TaskSpec, role: Role): string {
  if (role === "reviewer") {
    return `# Code Review Task

## Original Task
**ID**: ${spec.id}
**Objective**: ${spec.objective}

## Diff to Review
\`\`\`diff
${spec.metadata?.diff || "(no diff provided)"}
\`\`\`

## Review Instructions
Review the diff above for correctness, style, and adherence to the task objective.

Respond ONLY with a JSON object matching this structure:
{
  "reviewer_agent": "claude",
  "target_attempt_id": "${spec.metadata?.attempt_id || ""}",
  "iteration": 1,
  "findings": [
    {
      "id": "F001",
      "severity": "critical|warning|nit",
      "file": "path/to/file",
      "line": "42",
      "category": "correctness|style|security|performance",
      "description": "what is wrong",
      "suggest_fix": "optional fix"
    }
  ],
  "verdict": "pass|needs_fix|needs_human"
}

If there are no findings, return an empty findings array and verdict "pass".`;
  }

  // Writer prompt
  let prompt = `# Task: ${spec.id}\n\n## Objective\n${spec.objective}\n`;

  if (spec.constraints?.length) {
    prompt += "\n## Constraints\n";
    for (const c of spec.constraints) prompt += `- ${c}\n`;
  }
  if (spec.inputs?.length) {
    prompt += "\n## Input Files\n";
    for (const f of spec.inputs) prompt += `- ${f}\n`;
  }
  if (spec.outputs?.length) {
    prompt += "\n## Expected Outputs\n";
    for (const f of spec.outputs) prompt += `- ${f}\n`;
  }

  prompt += "\n## Instructions\nImplement the objective above. Follow all constraints exactly. Produce the listed output files.\n";
  return prompt;
}

export function compileRepairPrompt(
  spec: TaskSpec,
  failedGate: string,
  gateResult: PipelineGateResult,
  round: number,
): string {
  const findingsList = gateResult.findings
    .map(
      (f) =>
        `- [${f.severity}] ${f.file ? `${f.file}${f.line ? `:${f.line}` : ""}` : ""}: ${f.message}${f.suggestion ? ` (suggestion: ${f.suggestion})` : ""}`,
    )
    .join("\n");

  const evidenceList = gateResult.evidence
    .map((e) => `Command: ${e.command}\nExit code: ${e.exitCode}\n${e.stderr || e.stdout}`)
    .join("\n---\n");

  return `# Repair Task (Round ${round})

## Original Task
**ID**: ${spec.id}
**Objective**: ${spec.objective}

## Failed Quality Gate: ${failedGate}

### Findings
${findingsList || "(no structured findings)"}

### Command Evidence
${evidenceList || "(no command evidence)"}

## Instructions
Fix the issues identified by the ${failedGate} gate above.
- Focus ONLY on fixing the reported issues
- Do NOT refactor unrelated code
- Do NOT add features beyond what's needed to pass the gate
- After fixing, the ${failedGate} gate will be re-run automatically
${round > 1 ? `\nThis is repair round ${round}. Previous repair attempts did not fully resolve the issues. Try a different approach.` : ""}
`;
}

function compileCodex(spec: TaskSpec, role: Role): string {
  if (role === "reviewer") {
    return JSON.stringify(
      {
        task_id: spec.id,
        mode: "review",
        objective: spec.objective,
        diff: spec.metadata?.diff || "",
        instruction:
          "Review the diff and respond with JSON: {reviewer_agent, target_attempt_id, iteration, findings:[{id,severity,file,line,category,description,suggest_fix}], verdict}",
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      task_id: spec.id,
      objective: spec.objective,
      constraints: spec.constraints || [],
      input_files: spec.inputs || [],
      output_files: spec.outputs || [],
      mode: role,
    },
    null,
    2,
  );
}
