export type WorkspaceMode = "chat" | "dev";

export type TaskKind = "chat" | "dev" | "control";

export type WorkspaceCommandName = "run" | "test" | "diff" | "files" | "logs" | "branch" | "apply" | "abort";

export type UserIntent =
  | { kind: "task.start"; taskKind: TaskKind; prompt: string }
  | { kind: "workspace.mode"; action: "show" | "reset" | "set" | "invalid"; mode?: WorkspaceMode; invalidArg?: string }
  | { kind: "workspace.resume" }
  | { kind: "workspace.cwd"; path?: string }
  | { kind: "workspace.command"; command: WorkspaceCommandName; value?: string }
  | { kind: "reply.status" }
  | { kind: "reply.usage" }
  | { kind: "reply.model"; action: "show" | "reset" | "set" | "invalid"; model?: string; invalidArg?: string }
  | {
      kind: "reply.think";
      action: "show" | "reset" | "set" | "invalid";
      level?: "low" | "medium" | "high";
      invalidArg?: string;
    }
  | { kind: "session.reset" }
  | { kind: "noop" };

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting_for_input"
  | "interrupted"
  | "failed"
  | "completed"
  | "resumable";

export type TaskEventPhase = "queued" | "progress" | "result" | "error";

export type TaskArtifactKind = "diff" | "log" | "file" | "command_output";

export type WorkspaceState = {
  sessionKey: string;
  mode: WorkspaceMode;
  cwd: string;
  branch: string | undefined;
  lastTaskId: string | undefined;
  lastErrorSummary: string | undefined;
  updatedAt: number;
};

export type TaskRecord = {
  id: string;
  sessionKey: string;
  kind: TaskKind;
  title: string;
  inputText: string;
  status: TaskStatus;
  createdAt: number;
  startedAt: number | undefined;
  finishedAt: number | undefined;
  summary: string | undefined;
  errorSummary: string | undefined;
};

export type TaskEventRecord = {
  taskId: string;
  seq: number;
  phase: TaskEventPhase;
  message: string;
  createdAt: number;
};

export type TaskArtifactRecord = {
  taskId: string;
  kind: TaskArtifactKind;
  label: string;
  value: string;
  createdAt: number;
};

export interface RuntimeStore {
  saveWorkspaceState(state: WorkspaceState): void;
  getWorkspaceState(sessionKey: string): WorkspaceState | undefined;
  createTask(task: TaskRecord): void;
  getTask(taskId: string): TaskRecord | undefined;
  listRecentTasks(sessionKey: string, limit: number): TaskRecord[];
  updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    updates?: Partial<Pick<TaskRecord, "startedAt" | "finishedAt" | "summary" | "errorSummary">>,
  ): void;
  appendTaskEvent(event: TaskEventRecord): void;
  loadTaskEvents(taskId: string, limit: number): TaskEventRecord[];
  replaceTaskArtifacts(taskId: string, artifacts: TaskArtifactRecord[]): void;
  listTaskArtifacts(taskId: string): TaskArtifactRecord[];
}
