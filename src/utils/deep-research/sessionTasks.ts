/**
 * Get completed tasks from session (last N levels). Used to gather all work
 * done across autonomous continuations for the reply phase.
 */
export function getSessionCompletedTasks<T extends { level?: number; output?: string }>(
  plan: T[],
  sessionStartLevel: number,
  currentLevel: number,
  maxLevels: number = 2
): T[] {
  const minLevel = Math.max(sessionStartLevel, currentLevel - (maxLevels - 1));
  return plan.filter((t) => (t.level ?? 0) >= minLevel && t.output && t.output.length > 0);
}
