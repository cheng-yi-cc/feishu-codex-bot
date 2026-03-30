import type { TaskEventRecord, TaskRecord, WorkspaceState } from "../runtime/types.js";

export function renderUsageReply(): string {
  return "用法: /ask 你的问题";
}

export function renderStatusReply(input: {
  workspace?: WorkspaceState;
  latestTask?: TaskRecord;
  queueLength: number;
  sandboxMode: string;
  timeoutMs: number;
}): string {
  const lines = [
    "机器人状态",
    `- 模式: ${input.workspace?.mode ?? "chat"}`,
    `- 工作目录: ${input.workspace?.cwd ?? "(未设置)"}`,
    `- 分支: ${input.workspace?.branch ?? "(未知)"}`,
    `- 队列长度: ${input.queueLength}`,
    `- 沙箱策略: ${input.sandboxMode}`,
    `- 超时: ${input.timeoutMs}ms`,
  ];

  if (input.latestTask) {
    lines.push(`- 最近任务: ${input.latestTask.title}`);
    lines.push(`- 任务状态: ${input.latestTask.status}`);
    if (input.latestTask.errorSummary) {
      lines.push(`- 最近错误: ${input.latestTask.errorSummary}`);
    }
  }

  return lines.join("\n");
}

export function renderProgressReply(event: TaskEventRecord): string {
  return `进行中 · ${event.message}`;
}

export function renderResumeReply(task: TaskRecord | undefined, events: TaskEventRecord[]): string {
  if (!task) {
    return "没有可恢复的最近任务。";
  }

  const progressEvents = events.filter((event) => event.phase === "progress");

  const lines = [
    "最近中断任务",
    `- 标题: ${task.title}`,
    `- 状态: ${task.status}`,
    `- 原因: ${task.errorSummary ?? "未知"}`,
  ];

  for (const event of progressEvents.slice(-3)) {
    lines.push(`- 进度: ${event.message}`);
  }

  return lines.join("\n");
}
