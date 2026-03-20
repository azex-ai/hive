import "server-only";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import type { Task, TaskSpec, TaskStatus, Attempt, Artifact, Lease } from "./types";

interface TaskRow {
  seq: number;
  id: string;
  title: string;
  spec_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface AttemptRow {
  id: string;
  task_id: string;
  agent: string;
  role: string;
  branch: string;
  status: string;
  worker_id: string;
  started_at: string;
  completed_at: string | null;
}

interface ArtifactRow {
  id: string;
  type: string;
  path: string;
  created_at: string;
  agent: string;
}

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;

  const dbDir = path.resolve("data");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "hive.db");

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      id          TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL DEFAULT '',
      spec_json   TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_deps (
      task_id     TEXT NOT NULL,
      depends_on  TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on)
    );
    CREATE TABLE IF NOT EXISTS attempts (
      id              TEXT PRIMARY KEY,
      task_id         TEXT NOT NULL,
      agent           TEXT NOT NULL,
      role            TEXT NOT NULL,
      branch          TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL DEFAULT 'running',
      worker_id       TEXT NOT NULL,
      lease_expires_at TEXT,
      started_at      TEXT NOT NULL,
      completed_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id          TEXT PRIMARY KEY,
      attempt_id  TEXT NOT NULL,
      type        TEXT NOT NULL,
      path        TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `);
}

export function submitTasks(specs: TaskSpec[]): Task[] {
  const db = getDb();
  const now = new Date().toISOString();
  const created: Task[] = [];

  const insertTask = db.prepare(
    "INSERT INTO tasks (id, title, spec_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const updateTask = db.prepare("UPDATE tasks SET id = ?, spec_json = ? WHERE seq = ?");
  const insertDep = db.prepare("INSERT OR IGNORE INTO task_deps (task_id, depends_on) VALUES (?, ?)");

  const transaction = db.transaction(() => {
    for (const spec of specs) {
      const title = spec.title || spec.id || "";
      const cleanSpec = { ...spec, id: "" };

      const result = insertTask.run("", title, JSON.stringify(cleanSpec), "pending", now, now);
      const seq = result.lastInsertRowid;
      const hiveId = `HIVE-${seq}`;

      const finalSpec = { ...cleanSpec, id: hiveId };
      updateTask.run(hiveId, JSON.stringify(finalSpec), seq);

      if (spec.depends_on) {
        for (const dep of spec.depends_on) {
          insertDep.run(hiveId, dep);
        }
      }

      created.push({
        spec: finalSpec,
        status: "pending",
        created_at: now,
        updated_at: now,
      });
    }
  });

  transaction();
  return created;
}

export function listTasks(): Task[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, title, spec_json, status, created_at, updated_at FROM tasks ORDER BY seq ASC")
    .all() as TaskRow[];

  return rows.map(rowToTask);
}

export function getTask(id: string): Task | null {
  const db = getDb();
  const row = db
    .prepare("SELECT id, title, spec_json, status, created_at, updated_at FROM tasks WHERE id = ?")
    .get(id) as TaskRow | undefined;

  return row ? rowToTask(row) : null;
}

export function updateTaskStatus(taskId: string, status: TaskStatus): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(status, now, taskId);
}

export function getAttempts(taskId: string): Attempt[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, task_id, agent, role, branch, status, worker_id, started_at, completed_at FROM attempts WHERE task_id = ? ORDER BY started_at ASC",
    )
    .all(taskId) as AttemptRow[];

  return rows.map((r: AttemptRow) => ({
    id: r.id,
    task_id: r.task_id,
    agent: r.agent,
    role: r.role as Attempt["role"],
    branch: r.branch,
    status: r.status,
    worker_id: r.worker_id,
    started_at: r.started_at,
    completed_at: r.completed_at || undefined,
  }));
}

export function claimTask(workerId: string): { task: Task; lease: Lease } | null {
  const db = getDb();
  const leaseTTL = 30 * 60 * 1000; // 30 min

  const claim = db.transaction(() => {
    const row = db
      .prepare(
        `
      SELECT t.id, t.title, t.spec_json, t.status, t.created_at, t.updated_at
      FROM tasks t
      WHERE t.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM task_deps d
          JOIN tasks dep ON dep.id = d.depends_on
          WHERE d.task_id = t.id AND dep.status != 'done'
        )
      ORDER BY t.seq ASC
      LIMIT 1
    `,
      )
      .get() as TaskRow | undefined;

    if (!row) return null;

    const now = new Date();
    const expires = new Date(now.getTime() + leaseTTL);
    const attemptId = uuidv4();
    const task = rowToTask(row);

    db.prepare("UPDATE tasks SET status = 'claimed', updated_at = ? WHERE id = ?").run(
      now.toISOString(),
      task.spec.id,
    );

    db.prepare(
      "INSERT INTO attempts (id, task_id, agent, role, branch, status, worker_id, lease_expires_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      attemptId,
      task.spec.id,
      workerId,
      "writer",
      "",
      "running",
      workerId,
      expires.toISOString(),
      now.toISOString(),
    );

    task.status = "claimed";
    task.updated_at = now.toISOString();

    return {
      task,
      lease: {
        attempt_id: attemptId,
        worker_id: workerId,
        expires_at: expires.toISOString(),
        ttl_ms: leaseTTL,
      },
    };
  });

  return claim();
}

/** Create an attempt record when runTask starts (not via claimTask) */
export function createAttempt(taskId: string, agent: string, role: string): string {
  const db = getDb();
  const attemptId = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO attempts (id, task_id, agent, role, branch, status, worker_id, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(attemptId, taskId, agent, role, "", "running", agent, now);

  return attemptId;
}

/** Save branch info to an attempt */
export function saveAttemptBranch(attemptId: string, branch: string): void {
  const db = getDb();
  db.prepare("UPDATE attempts SET branch = ? WHERE id = ?").run(branch, attemptId);
}

/** Mark an attempt as completed or failed */
export function completeAttempt(attemptId: string, status: "done" | "failed"): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("UPDATE attempts SET status = ?, completed_at = ? WHERE id = ?").run(status, now, attemptId);
}

/** Get the latest attempt's branch for a task */
export function getTaskBranch(taskId: string): { branch: string; agent: string; attemptId: string } | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, branch, agent FROM attempts WHERE task_id = ? AND branch != '' ORDER BY started_at DESC LIMIT 1",
    )
    .get(taskId) as Pick<AttemptRow, "id" | "branch" | "agent"> | undefined;

  return row ? { branch: row.branch, agent: row.agent, attemptId: row.id } : null;
}

/** Record an artifact in the DB */
export function saveArtifact(attemptId: string, type: string, filePath: string): string {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO artifacts (id, attempt_id, type, path, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, attemptId, type, filePath, now);

  return id;
}

/** Get all artifacts for a task (across all attempts) */
export function getTaskArtifacts(taskId: string): Array<{ id: string; type: string; path: string; agent: string; created_at: string }> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.type, a.path, a.created_at, att.agent
       FROM artifacts a
       JOIN attempts att ON att.id = a.attempt_id
       WHERE att.task_id = ?
       ORDER BY a.created_at ASC`,
    )
    .all(taskId) as ArtifactRow[];

  return rows.map((r: ArtifactRow) => ({
    id: r.id,
    type: r.type,
    path: r.path,
    agent: r.agent,
    created_at: r.created_at,
  }));
}

function rowToTask(row: TaskRow): Task {
  const spec = JSON.parse(row.spec_json) as TaskSpec;
  if (!spec.title && row.title) spec.title = row.title;
  return {
    spec,
    status: row.status as TaskStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
