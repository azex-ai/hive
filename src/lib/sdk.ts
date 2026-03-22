import "server-only";

/**
 * Shared SDK module loader — pre-loads @anthropic-ai/claude-agent-sdk once,
 * reused by supervisor, runtime, and API routes.
 */

let _mod: typeof import("@anthropic-ai/claude-agent-sdk") | null = null;

async function load() {
  if (!_mod) {
    _mod = await import("@anthropic-ai/claude-agent-sdk");
  }
  return _mod;
}

// Eagerly pre-load at import time
load().catch(() => {});

export async function getQueryFn() {
  const mod = await load();
  return mod.query;
}

export async function getSDK() {
  return load();
}

/** List recent Claude sessions for a project directory */
export async function listAgentSessions(dir?: string, limit = 20) {
  const mod = await load();
  return mod.listSessions({ dir, limit });
}

/** Get messages from a specific session */
export async function getAgentSessionMessages(sessionId: string, dir?: string) {
  const mod = await load();
  return mod.getSessionMessages(sessionId, { dir });
}

/** Fork a session for follow-up work */
export async function forkAgentSession(sessionId: string, dir?: string) {
  const mod = await load();
  return mod.forkSession(sessionId, { dir });
}
