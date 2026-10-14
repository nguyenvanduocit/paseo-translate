/** Remembers per workspace id whether `check` found it on this host. A failed check answers false and is asked again next time. */
export function createOwnership(check: (workspaceId: string) => Promise<boolean>): (workspaceId: string) => Promise<boolean> {
  const answers = new Map<string, Promise<boolean>>();
  return workspaceId => {
    const known = answers.get(workspaceId);
    if (known) return known;
    const asked = check(workspaceId).catch(() => {
      answers.delete(workspaceId);
      return false;
    });
    answers.set(workspaceId, asked);
    return asked;
  };
}
