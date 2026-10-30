export function workspaceHeaders(): Record<string, string> {
  const id =
    typeof window === "undefined"
      ? ""
      : sessionStorage.getItem("integrationos.workspace");
  return id ? { "X-Workspace-Id": id } : {};
}
