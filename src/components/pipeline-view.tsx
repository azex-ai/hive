"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchPipelineStatus, controlPipeline, connectSSE } from "@/lib/api";
import type { PipelineStatus, StageRecord, RepairRecord, GateFinding, GateEvidence, PipelineStageStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Pause,
  Play,
  AlertTriangle,
  Wrench,
  ChevronDown,
  ChevronRight,
  Terminal,
} from "lucide-react";

interface PipelineViewProps {
  taskId: string;
}

const STAGE_ORDER = ["design", "code", "lint", "build", "test", "review", "integrate"] as const;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function StatusIcon({ status }: { status: PipelineStageStatus }) {
  if (status === "passed") return <CheckCircle className="w-3.5 h-3.5 text-green-500" aria-label="passed" />;
  if (status === "failed") return <XCircle className="w-3.5 h-3.5 text-red-400" aria-label="failed" />;
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 text-yellow-400 animate-spin" aria-label="running" />;
  if (status === "skipped") return <ChevronRight className="w-3.5 h-3.5 text-zinc-600" aria-label="skipped" />;
  return <Clock className="w-3.5 h-3.5 text-zinc-600" aria-label="pending" />;
}

function stageBorderColor(status: PipelineStageStatus): string {
  if (status === "passed") return "border-green-700";
  if (status === "failed") return "border-red-700";
  if (status === "running") return "border-yellow-600";
  return "border-zinc-800";
}

function stageBgColor(status: PipelineStageStatus): string {
  if (status === "passed") return "bg-green-950/30";
  if (status === "failed") return "bg-red-950/30";
  if (status === "running") return "bg-yellow-950/20";
  return "bg-zinc-950";
}

function FindingsList({ findings }: { findings: GateFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">findings</div>
      <div className="flex flex-col gap-1">
        {findings.map((f, i) => (
          <div key={i} className="flex items-start gap-2">
            <span
              className={cn(
                "text-[10px] font-mono shrink-0 mt-0.5",
                f.severity === "critical" ? "text-red-400" : f.severity === "warning" ? "text-yellow-400" : "text-zinc-500"
              )}
            >
              [{f.severity}]
            </span>
            <div className="flex-1">
              <span className="text-zinc-300 text-[11px]">{f.message}</span>
              {f.file && (
                <span className="text-zinc-600 text-[10px] ml-1.5">
                  {f.file}{f.line ? `:${f.line}` : ""}
                </span>
              )}
              {f.suggestion && (
                <div className="text-zinc-500 text-[10px] mt-0.5 pl-2 border-l border-zinc-800">
                  {f.suggestion}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EvidenceBlock({ evidence }: { evidence: GateEvidence[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (evidence.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">evidence</div>
      <div className="flex flex-col gap-1">
        {evidence.map((e, i) => (
          <div key={i} className="border border-zinc-800 rounded">
            <button
              onClick={() => setExpanded(expanded === i ? null : i)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-900/50 transition-colors"
              aria-expanded={expanded === i}
            >
              <Terminal className="w-3 h-3 text-zinc-600 shrink-0" />
              <span className="flex-1 font-mono text-[11px] text-zinc-400 truncate">{e.command}</span>
              <span
                className={cn(
                  "text-[10px] font-mono shrink-0",
                  e.exitCode === 0 ? "text-green-500" : "text-red-400"
                )}
              >
                exit:{e.exitCode}
              </span>
              {expanded === i ? (
                <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
              )}
            </button>
            {expanded === i && (
              <div className="border-t border-zinc-800">
                {e.stdout && (
                  <pre className="px-3 py-2 text-[10px] leading-relaxed text-green-400 bg-zinc-950 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                    {e.stdout}
                    {e.truncated && <span className="text-zinc-600">\n...(truncated)</span>}
                  </pre>
                )}
                {e.stderr && (
                  <pre className="px-3 py-2 text-[10px] leading-relaxed text-red-400 bg-zinc-950 border-t border-zinc-800 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-all">
                    {e.stderr}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RepairsList({ repairs }: { repairs: RepairRecord[] }) {
  if (repairs.length === 0) return null;
  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Wrench className="w-3 h-3 text-orange-400" />
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">repair rounds</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {repairs.map((r) => (
          <div key={r.id} className="border border-zinc-800 rounded px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono text-orange-400">R{r.round}</span>
              <span className="text-[11px] text-zinc-400">{r.agent}</span>
              {r.model && <span className="text-[10px] text-zinc-600">{r.model}</span>}
              <span
                className={cn(
                  "text-[10px] font-mono ml-auto",
                  r.outcome === "fixed" ? "text-green-500" : r.outcome === "escalated" ? "text-red-400" : "text-yellow-400"
                )}
              >
                [{r.outcome}]
              </span>
            </div>
            {r.fixSummary && (
              <p className="text-zinc-500 text-[11px]">{r.fixSummary}</p>
            )}
            {r.durationMs && (
              <p className="text-zinc-600 text-[10px] mt-0.5">{formatDuration(r.durationMs)}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StageCard({
  stage,
  repairs,
  isExpanded,
  onToggle,
}: {
  stage: StageRecord;
  repairs: RepairRecord[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const repairCount = repairs.length;
  const gate = stage.gateReport;

  return (
    <div
      className={cn(
        "border rounded",
        stageBorderColor(stage.status),
        stage.status === "running" && "shadow-[0_0_8px_rgba(234,179,8,0.15)]"
      )}
    >
      {/* Stage header — clickable */}
      <button
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 text-left transition-colors rounded",
          stageBgColor(stage.status),
          "hover:brightness-110"
        )}
        aria-expanded={isExpanded}
        aria-label={`${stage.stage} stage — ${stage.status}`}
      >
        <StatusIcon status={stage.status} />

        <span className="font-mono text-[11px] text-zinc-300 min-w-[4rem]">{stage.stage}</span>

        {stage.durationMs !== undefined && stage.durationMs !== null && (
          <span className="font-mono text-[10px] text-zinc-600">{formatDuration(stage.durationMs)}</span>
        )}

        {stage.status === "running" && !stage.durationMs && (
          <span className="font-mono text-[10px] text-yellow-600 animate-pulse">...</span>
        )}

        {repairCount > 0 && (
          <span className="text-[10px] font-mono bg-orange-900/50 text-orange-300 border border-orange-800 px-1 rounded">
            R{repairCount}
          </span>
        )}

        {gate && gate.verdict === "warn" && (
          <AlertTriangle className="w-3 h-3 text-yellow-400" aria-label="warnings" />
        )}

        <div className="flex-1" />

        {stage.agent && (
          <span className="text-[10px] text-zinc-600 font-mono hidden sm:inline">{stage.agent}</span>
        )}

        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
        )}
      </button>

      {/* Expanded gate details */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-2 border-t border-zinc-800 bg-zinc-950/50">
          {stage.model && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-zinc-600">model:</span>
              <span className="text-[10px] font-mono text-zinc-400">{stage.model}</span>
            </div>
          )}

          {stage.startedAt && (
            <div className="flex items-center gap-4 mb-2 text-[10px] text-zinc-600 font-mono">
              <span>started: {new Date(stage.startedAt).toLocaleTimeString()}</span>
              {stage.finishedAt && (
                <span>finished: {new Date(stage.finishedAt).toLocaleTimeString()}</span>
              )}
            </div>
          )}

          {gate ? (
            <>
              <div
                className={cn(
                  "flex items-center gap-1.5 text-[11px] font-mono mb-2",
                  gate.verdict === "pass" ? "text-green-400" : gate.verdict === "fail" ? "text-red-400" : "text-yellow-400"
                )}
              >
                {gate.verdict === "pass" ? (
                  <CheckCircle className="w-3 h-3" />
                ) : gate.verdict === "fail" ? (
                  <XCircle className="w-3 h-3" />
                ) : (
                  <AlertTriangle className="w-3 h-3" />
                )}
                gate: {gate.verdict}
                <span className="text-zinc-600 ml-1">({formatDuration(gate.durationMs)})</span>
              </div>
              <FindingsList findings={gate.findings} />
              <EvidenceBlock evidence={gate.evidence} />
            </>
          ) : (
            <p className="text-zinc-600 text-[11px]">no gate report</p>
          )}

          <RepairsList repairs={repairs} />
        </div>
      )}
    </div>
  );
}

export function PipelineView({ taskId }: PipelineViewProps) {
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [expandedStage, setExpandedStage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [controlError, setControlError] = useState<string | null>(null);
  const [controlling, setControlling] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchPipelineStatus(taskId);
      setPipeline(data);
    } catch {
      // pipeline may not exist yet — silently handle
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  // Initial load
  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh via SSE
  useEffect(() => {
    const disconnect = connectSSE((event) => {
      if (event.task_id === taskId || event.type === "pipeline_update") {
        load();
      }
    });
    return disconnect;
  }, [load, taskId]);

  const handleControl = useCallback(
    async (action: "pause" | "resume") => {
      setControlError(null);
      setControlling(true);
      try {
        await controlPipeline(taskId, action);
        await load();
      } catch (err) {
        setControlError(err instanceof Error ? err.message : "control failed");
      } finally {
        setControlling(false);
      }
    },
    [taskId, load]
  );

  if (loading) {
    return (
      <div className="min-h-[200px] flex items-center justify-center">
        <p className="text-xs font-mono text-zinc-600 animate-pulse">loading pipeline...</p>
      </div>
    );
  }

  if (!pipeline || pipeline.stages.length === 0) {
    return (
      <div className="min-h-[200px] flex items-center justify-center border border-dashed border-zinc-800 rounded">
        <div className="text-center">
          <p className="text-zinc-600 text-xs font-mono">no pipeline data</p>
          <p className="text-zinc-700 text-[11px] mt-1">pipeline stages will appear when the task runs</p>
        </div>
      </div>
    );
  }

  // Build a map from stage name → StageRecord (use last record if multiple)
  const stageMap = new Map<string, StageRecord>();
  for (const s of pipeline.stages) {
    stageMap.set(s.stage, s);
  }

  // Map repairs to their stageId
  const repairsByStageId = new Map<number, RepairRecord[]>();
  for (const r of pipeline.repairs) {
    const existing = repairsByStageId.get(r.stageId) ?? [];
    repairsByStageId.set(r.stageId, [...existing, r]);
  }

  const hasRunningStage = pipeline.stages.some((s) => s.status === "running");

  return (
    <div className="font-mono text-xs min-h-[200px] flex flex-col gap-3">
      {/* Escalated banner */}
      {pipeline.escalated && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-950/30 border border-red-800 rounded">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-red-300 text-[11px]">
            pipeline escalated — human intervention required
          </span>
        </div>
      )}

      {/* Paused banner */}
      {pipeline.paused && !pipeline.escalated && (
        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-950/30 border border-yellow-800 rounded">
          <Pause className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
          <span className="text-yellow-300 text-[11px]">pipeline paused</span>
        </div>
      )}

      {/* Pipeline header with controls */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
          pipeline stages
          {pipeline.currentStage && (
            <span className="ml-2 text-yellow-500 normal-case">
              current: {pipeline.currentStage}
            </span>
          )}
        </div>

        {(hasRunningStage || pipeline.paused) && (
          <div className="flex items-center gap-2">
            {controlError && (
              <span className="text-[10px] text-red-400">{controlError}</span>
            )}
            <button
              onClick={() => handleControl(pipeline.paused ? "resume" : "pause")}
              disabled={controlling}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 text-[11px] border transition-colors",
                pipeline.paused
                  ? "border-green-700 text-green-400 hover:bg-green-900/20"
                  : "border-yellow-700 text-yellow-400 hover:bg-yellow-900/20",
                controlling && "opacity-50 cursor-not-allowed"
              )}
              aria-label={pipeline.paused ? "Resume pipeline" : "Pause pipeline"}
            >
              {pipeline.paused ? (
                <>
                  <Play className="w-3 h-3" />
                  resume
                </>
              ) : (
                <>
                  <Pause className="w-3 h-3" />
                  pause
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Horizontal pipeline overview */}
      <div className="flex items-center gap-1 flex-wrap">
        {STAGE_ORDER.map((stageName, idx) => {
          const record = stageMap.get(stageName);
          const status: PipelineStageStatus = record?.status ?? "pending";
          const repairs = record ? (repairsByStageId.get(record.id) ?? []) : [];
          const isLast = idx === STAGE_ORDER.length - 1;

          return (
            <div key={stageName} className="flex items-center gap-1">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded border cursor-pointer transition-colors",
                  stageBorderColor(status),
                  stageBgColor(status),
                  "hover:brightness-110",
                  status === "running" && "animate-pulse"
                )}
                onClick={() => {
                  if (!record) return;
                  setExpandedStage(expandedStage === record.id ? null : record.id);
                }}
                role="button"
                aria-label={`${stageName}: ${status}`}
                title={`${stageName}: ${status}`}
              >
                <StatusIcon status={status} />
                <span
                  className={cn(
                    "text-[10px] font-mono",
                    status === "passed" ? "text-green-400" :
                    status === "failed" ? "text-red-400" :
                    status === "running" ? "text-yellow-400" :
                    "text-zinc-600"
                  )}
                >
                  {stageName}
                </span>
                {record?.durationMs !== undefined && record.durationMs !== null && (
                  <span className="text-[10px] text-zinc-600">{formatDuration(record.durationMs)}</span>
                )}
                {repairs.length > 0 && (
                  <span className="text-[9px] font-mono bg-orange-900/60 text-orange-300 border border-orange-800/60 px-0.5 rounded leading-tight">
                    R{repairs.length}
                  </span>
                )}
              </div>

              {!isLast && (
                <span className="text-zinc-700 text-[11px] select-none">→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded stage detail cards */}
      {pipeline.stages.length > 0 && (
        <div className="flex flex-col gap-2 mt-1">
          {pipeline.stages.map((stage) => {
            const repairs = repairsByStageId.get(stage.id) ?? [];
            return (
              <StageCard
                key={stage.id}
                stage={stage}
                repairs={repairs}
                isExpanded={expandedStage === stage.id}
                onToggle={() => setExpandedStage(expandedStage === stage.id ? null : stage.id)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
