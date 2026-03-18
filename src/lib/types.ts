// Task lifecycle
export type TaskStatus = "pending" | "claimed" | "running" | "done" | "reviewing" | "evaluated" | "failed";
export type Role = "writer" | "reviewer" | "tester" | "fixer";
export type ArtifactType = "diff" | "test_result" | "review" | "coverage" | "log";
export type Severity = "critical" | "warning" | "nit";
export type Verdict = "pass" | "needs_fix" | "needs_human";
export type SupervisorIntent = "create_tasks" | "reply" | "query_status" | "approve" | "reject" | "run_task";

export interface TaskSpec {
  id: string;
  title?: string;
  objective: string;
  constraints?: string[];
  inputs?: string[];
  outputs?: string[];
  depends_on?: string[];
  priority?: number;
  tags?: string[];
  metadata?: Record<string, string>;
}

export interface Task {
  spec: TaskSpec;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

export interface Attempt {
  id: string;
  task_id: string;
  agent: string;
  role: Role;
  branch: string;
  status: string;
  worker_id: string;
  started_at: string;
  completed_at?: string;
}

export interface Lease {
  attempt_id: string;
  worker_id: string;
  expires_at: string;
  ttl_ms: number;
}

export interface Artifact {
  id: string;
  attempt_id: string;
  type: ArtifactType;
  path: string;
  created_at: string;
}

export interface ReviewReport {
  reviewer_agent: string;
  target_attempt_id: string;
  iteration: number;
  findings: Finding[];
  verdict: Verdict;
}

export interface Finding {
  id: string;
  severity: Severity;
  file?: string;
  line?: string;
  category: string;
  description: string;
  suggest_fix?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface ParseResult {
  tasks: TaskSpec[];
  summary: string;
}

export interface SupervisorEnvelope {
  intent: SupervisorIntent;
  response: string;
  tasks?: TaskSpec[];
  task_id?: string;
  agent?: string;
  reason?: string;
}

// Config types (from hive.yaml)
export interface AgentCfg {
  command: string;
  args?: string[];
  max_concurrent: number;
}

export interface HiveConfig {
  repo: string;
  output_dir?: string;
  agents: Record<string, AgentCfg>;
  supervisor?: { agent: string; model?: string };
  scheduler?: { lease_ttl?: string; heartbeat_interval?: string; max_attempts?: number };
  evaluation?: {
    auto_gate?: string[];
    cross_review?: boolean;
    max_review_rounds?: number;
    auto_merge_threshold?: number;
  };
  worktree?: { base_dir?: string; cleanup_on_merge?: boolean };
  context?: { skills_dir?: string; rules_dir?: string; templates_dir?: string };
  api?: { backend_addr?: string; frontend_addr?: string };
}

export interface AgentHealth {
  name: string;
  available: boolean;
  version?: string;
  error?: string;
}

export interface SSEEvent {
  type: string;
  task_id?: string;
  data: any;
  timestamp?: string;
}

export interface TaskFile {
  name: string;
  size: number;
  modified: string;
}

export interface ServerStatus {
  uptime: string;
  tasks_total: number;
  tasks_running: number;
  agents_active: Record<string, number>;
}

// API response types (used by frontend api client)
export interface ApiResponse<T> {
  data: T;
}

export interface TaskDetailResponse {
  task: Task;
  attempts?: Attempt[];
}

export interface AgentInfo {
  name: string;
  command: string;
  max_concurrent: number;
  active: number;
}

export interface ChatResponse {
  reply: string;
  tasks?: TaskSpec[];
}

export interface SupervisorResponse {
  intent: SupervisorIntent;
  response: string;
  tasks?: TaskSpec[];
  task_id?: string;
}

export interface WorkspaceConfig {
  repo_path: string;
  output_dir?: string;
}

export interface HealthResponse {
  agents: AgentHealth[];
  output_dir: string;
}

export interface TaskFilesResponse {
  files: TaskFile[];
}

export interface Skill {
  name: string;
  description?: string;
  enabled: boolean;
}

export interface SkillsResponse {
  skills_dir: string;
  skills: Skill[];
}
