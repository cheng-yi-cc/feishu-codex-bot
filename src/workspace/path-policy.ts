import fs from "node:fs";
import path from "node:path";

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function resolveRealpathAware(value: string): string {
  const absolutePath = path.resolve(value);
  const pendingSegments: string[] = [];
  let currentPath = absolutePath;

  while (!fs.existsSync(currentPath)) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return absolutePath;
    }
    pendingSegments.unshift(path.basename(currentPath));
    currentPath = parentPath;
  }

  let resolvedPath = fs.realpathSync.native(currentPath);
  for (const segment of pendingSegments) {
    resolvedPath = path.join(resolvedPath, segment);
  }
  return path.normalize(resolvedPath);
}

export function isWithinWorkspaceRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(resolveRealpathAware(root));
  const normalizedCandidate = normalizeForComparison(resolveRealpathAware(candidate));
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

export function resolveWorkspacePath(root: string, candidate?: string): string {
  const nextPath = candidate ? path.resolve(root, candidate) : path.resolve(root);
  if (!isWithinWorkspaceRoot(root, nextPath)) {
    throw new Error(`Path ${nextPath} is outside the configured workspace root`);
  }
  return resolveRealpathAware(nextPath);
}
