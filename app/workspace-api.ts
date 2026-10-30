export function workspaceHeaders(): Record<string, string> {
  if (typeof window !== "undefined" && window.location.pathname === "/demo") return {};
  const id =
    typeof window === "undefined"
      ? ""
      : sessionStorage.getItem("integrationos.workspace");
  return id ? { "X-Workspace-Id": id } : {};
}
export function apiUrl(path: string): string {
  return (typeof window !== "undefined" && window.location.pathname === "/demo" ? "/api/demo/" : "/api/") + path;
}
