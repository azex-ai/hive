import path from "path";

/** Validate that a task ID matches the expected HIVE-N pattern */
export function isValidTaskId(id: string): boolean {
  return /^HIVE-\d+$/.test(id);
}

/** Validate that a resolved path stays within the expected base directory */
export function isPathWithin(base: string, target: string): boolean {
  const resolvedBase = path.resolve(base) + path.sep;
  const resolvedTarget = path.resolve(target);
  return (
    resolvedTarget.startsWith(resolvedBase) ||
    resolvedTarget === path.resolve(base)
  );
}
