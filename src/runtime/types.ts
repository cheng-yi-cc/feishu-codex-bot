export type WorkspaceMode = "chat" | "dev";

export type TaskKind = "chat" | "dev" | "control";

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
