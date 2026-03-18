import type {
  Task,
  TaskSpec,
  TaskDetailResponse,
  ReviewReport,
  AgentInfo,
  SupervisorResponse,
  ChatMessage,
  SSEEvent,
  ApiResponse,
  WorkspaceConfig,
  ServerStatus,
  HealthResponse,
  TaskFilesResponse,
  SkillsResponse,
} from "./types";

const BASE = "/api";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path}: ${res.status} ${text}`);
  }
  const json: ApiResponse<T> = await res.json();
  return json.data;
}

// --- Tasks ---

export async function fetchTasks(): Promise<Task[]> {
  return apiFetch<Task[]>("/tasks");
}

export async function fetchTask(id: string): Promise<TaskDetailResponse> {
  return apiFetch<TaskDetailResponse>(`/tasks/${id}`);
}

export async function fetchTaskDiff(id: string): Promise<string> {
  const data = await apiFetch<{ diff: string }>(`/tasks/${id}/diff`);
  return data.diff;
}

export async function fetchTaskReview(id: string): Promise<ReviewReport> {
  return apiFetch<ReviewReport>(`/tasks/${id}/review`);
}

export async function approveTask(id: string): Promise<void> {
  await apiFetch(`/tasks/${id}/approve`, { method: "POST" });
}

export async function rejectTask(id: string, reason: string): Promise<void> {
  await apiFetch(`/tasks/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function submitTasks(specs: TaskSpec[]): Promise<Task[]> {
  return apiFetch<Task[]>("/tasks", {
    method: "POST",
    body: JSON.stringify(specs),
  });
}

// --- Chat ---

export async function sendChatMessage(message: string): Promise<SupervisorResponse> {
  return apiFetch<SupervisorResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function fetchChatHistory(): Promise<ChatMessage[]> {
  return apiFetch<ChatMessage[]>("/chat/history");
}

// --- Agents ---

export async function fetchAgents(): Promise<AgentInfo[]> {
  return apiFetch<AgentInfo[]>("/agents");
}

// --- Workspace ---

export async function fetchWorkspace(): Promise<WorkspaceConfig> {
  return apiFetch<WorkspaceConfig>("/workspace");
}

export async function setWorkspace(repoPath: string): Promise<WorkspaceConfig> {
  return apiFetch<WorkspaceConfig>("/workspace", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath }),
  });
}

export async function initWorkspace(repoPath: string): Promise<{ repo_path: string; is_git_repo: boolean; status: string }> {
  return apiFetch("/workspace/init", {
    method: "POST",
    body: JSON.stringify({ repo_path: repoPath }),
  });
}

// --- Health ---

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

// --- Status / Shutdown ---

export async function fetchStatus(): Promise<ServerStatus> {
  return apiFetch<ServerStatus>("/status");
}

export async function shutdownServer(): Promise<void> {
  await apiFetch("/shutdown", { method: "POST" });
}

// --- Task execution ---

export async function runTask(id: string, agent: string, role: string = "writer"): Promise<{ status: string; task_id: string }> {
  const res = await fetch(`${BASE}/tasks/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent, role }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API /tasks/${id}/run: ${res.status} ${text}`);
  }
  const json = await res.json();
  return json.data;
}

// --- Task messages (follow-up) ---

export async function sendTaskMessage(
  id: string,
  message: string,
  agent: string = "claude"
): Promise<{ task_id: string; output: string; exit_code: number }> {
  return apiFetch(`/tasks/${id}/message`, {
    method: "POST",
    body: JSON.stringify({ message, agent }),
  });
}

// --- Task files ---

export async function fetchTaskFiles(id: string): Promise<TaskFilesResponse> {
  return apiFetch<TaskFilesResponse>(`/tasks/${id}/files`);
}

export async function fetchTaskFileContent(id: string, filename: string): Promise<string> {
  const res = await fetch(`${BASE}/tasks/${id}/files/${encodeURIComponent(filename)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API /tasks/${id}/files/${filename}: ${res.status} ${text}`);
  }
  return res.text();
}

// --- Skills ---

export async function fetchSkills(): Promise<SkillsResponse> {
  return apiFetch<SkillsResponse>("/skills");
}

// --- SSE ---

export function connectSSE(onEvent: (event: SSEEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const es = new EventSource("/api/events");

  es.onmessage = (e) => {
    try {
      const event: SSEEvent = JSON.parse(e.data);
      onEvent(event);
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    // SSE will auto-reconnect; nothing to do
  };

  return () => es.close();
}
