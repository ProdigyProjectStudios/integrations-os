"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Box,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileClock,
  Filter,
  GitBranch,
  Globe2,
  HelpCircle,
  Layers3,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  Mail,
  Maximize2,
  Menu,
  Network,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Terminal,
  Unplug,
  Workflow,
  X,
  Zap,
} from "lucide-react";

import WorkflowStudio from "./workflow-studio";
import DemoIntro from "./demo/demo-intro";
import SpotlightCard from "../components/reactbits/SpotlightCard";
import { useInterfaceMotion } from "./motion";
import WorkspaceOperations from "./workspace-operations";
import { workspaceHeaders, apiUrl } from "./workspace-api";
import type { Graph } from "./workflow-studio";

type Run = {
  id: string;
  trace_id: string;
  workflow_name: string;
  workflow_version: number;
  status: string;
  mode: string;
  source: string;
  attempts: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  payload: { company: string; value: number; region: string };
  replay_of: string | null;
};
type Span = {
  id: string;
  name: string;
  service: string;
  parent_id: string | null;
  attempt: number;
  status: string;
  started_at: number;
  ended_at: number | null;
  input: unknown;
  output: unknown;
  error: string | null;
};
type Config = {
  graph?: Graph;
  minimumValue: number;
  channel: string;
  message: string;
  mode: string;
  maxAttempts: number;
};
type Connection = {
  provider: string;
  status: string;
  configured: boolean;
  synced_at: number | null;
  summary: { count?: number; message?: string; resource?: string } | null;
};
type Snapshot = {
  workspace: { id: string; name: string; role: string; user: string };
  runs: Run[];
  counts: { status: string; count: number }[];
  workflows: { id: string; name: string; version: number; config: Config }[];
  connections: Connection[];
  activity: {
    id: string;
    action: string;
    execution_id: string | null;
    created_at: number;
    detail: { provider?: string; mode?: string };
  }[];
  serverTime: number;
  recovery: string;
  maintenance?: {
    stale: boolean;
    lastWake: { status: string; finished_at: number | null } | null;
  };
  workspaces: { id: string; name: string; role: string }[];
};
type Trace = {
  nodes: {
    node_id: string;
    status: string;
    output: unknown;
    attempts: number;
  }[];
  execution: Run & { config: Config };
  spans: Span[];
  logs: { id: string; action: string; created_at: number; detail: string }[];
};
type View = "overview" | "studio" | "integrations" | "executions" | "audit";
const views: { id: View; name: string; icon: typeof Activity }[] = [
  { id: "overview", name: "Command Center", icon: LayoutDashboard },
  { id: "studio", name: "Workflow Studio", icon: Workflow },
  { id: "integrations", name: "Integration Hub", icon: Layers3 },
  { id: "executions", name: "Execution Inspector", icon: Activity },
  { id: "audit", name: "Audit Trail", icon: FileClock },
];
const statusLabels: Record<string, string> = {
  success: "Success",
  failed: "Failed",
  running: "Running",
  queued: "Queued",
  retry_wait: "Retrying",
  skipped: "Filtered",
  needs_review: "Needs review",
  waiting_approval: "Awaiting approval",
  error: "Error",
};
const time = (t: number) =>
  new Date(t).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const duration = (ms: number) =>
  ms >= 1000
    ? `${(ms / 1000).toFixed(2)} s`
    : `${Math.max(0, Math.round(ms))} ms`;
const runDuration = (r: Run) =>
  r.started_at ? duration((r.finished_at || Date.now()) - r.started_at) : "—";
const compact = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const serviceColors: Record<string, string> = {
  orchestrator: "#6f8fff",
  gateway: "#49d9d5",
  transform: "#a18af5",
  storage: "#7a9abc",
  rules: "#ecc779",
  sandbox: "#56c6e7",
  slack: "#56d4a4",
  trigger: "#88a4ff",
  condition: "#e6bd70",
  approval: "#e4bc77",
  delay: "#86b6d9",
  ai: "#b8a1ff",
  hubspot: "#ff9b78",
  gmail: "#f4a0b9",
};
async function api<T = Record<string, string>>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...workspaceHeaders(),
      ...options.headers,
    },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <i />
      {statusLabels[status] || status}
    </span>
  );
}
function Provider({ name, small = false }: { name: string; small?: boolean }) {
  return (
    <span className={`provider-icon ${name} ${small ? "small" : ""}`}>
      {name === "slack" ? (
        <span>✣</span>
      ) : name === "gmail" ? (
        <Mail size={small ? 15 : 22} />
      ) : (
        <Network size={small ? 16 : 23} />
      )}
    </span>
  );
}
function Spark({
  runs,
  color = "#6c91ff",
  kind = "latency",
}: {
  runs: Run[];
  color?: string;
  kind?: string;
}) {
  const recent = [...runs].reverse().slice(-24);
  const vals = recent.map((r, i) =>
    kind === "count"
      ? i + 1
      : kind === "success"
        ? (recent
            .slice(0, i + 1)
            .filter((e) => ["success", "skipped"].includes(e.status)).length /
            (i + 1)) *
          100
        : kind === "attention"
          ? recent
              .slice(0, i + 1)
              .filter((e) => ["failed", "needs_review"].includes(e.status))
              .length
          : r.started_at
            ? (r.finished_at || Date.now()) - r.started_at
            : 0,
  );
  if (vals.length < 2)
    return <div className="spark-placeholder">Collecting samples</div>;
  const max = Math.max(...vals, 1);
  const points = vals
    .map((v, i) => `${(i / (vals.length - 1)) * 140},${38 - (v / max) * 31}`)
    .join(" ");
  return (
    <svg
      className="spark"
      viewBox="0 0 140 44"
      role="img"
      aria-label={`Recent ${kind} trend`}
    >
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.7" />
      <polygon points={`0,44 ${points} 140,44`} fill={color} opacity=".06" />
    </svg>
  );
}
function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Activity size={26} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

function Waterfall({
  trace,
  compact: small = false,
  onExpand,
}: {
  trace: Trace | null;
  compact?: boolean;
  onExpand?: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("output");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSelected(null);
    setAttempt(0);
  }, [trace?.execution.id]);
  if (!trace)
    return (
      <div className="panel">
        <Empty
          title="Every execution tells a story"
          description="Run a sandbox event to see measured spans from the workflow engine."
        />
      </div>
    );
  const spans = trace.spans.filter((s) => !attempt || s.attempt === attempt);
  const min = Math.min(...spans.map((s) => s.started_at), Date.now());
  const max = Math.max(...spans.map((s) => s.ended_at || Date.now()), min + 1);
  const total = max - min;
  const focused = spans.find((s) => s.id === selected);
  const names = [...new Set(spans.map((s) => s.service))];
  return (
    <section className={`panel waterfall ${small ? "compact" : ""}`}>
      <div className="panel-title">
        <div>
          <span className="eyebrow">WORKFLOW TRACE</span>
          <h3>
            {small ? "Execution waterfall" : trace.execution.workflow_name}
          </h3>
        </div>
        <div className="inline">
          <Badge status={trace.execution.status} />
          {onExpand && (
            <button
              className="icon-btn"
              title="Open full inspector"
              onClick={onExpand}
            >
              <Maximize2 size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="trace-meta">
        <span>
          <span className="muted">Trace</span>{" "}
          <code>{trace.execution.trace_id.slice(0, 16)}</code>
        </span>
        <span>
          <Clock3 size={12} />
          {runDuration(trace.execution)}
        </span>
        <span>
          <Layers3 size={12} />
          {trace.spans.length} spans
        </span>
        <span className="mode-label">{trace.execution.mode}</span>
      </div>
      <div className="waterfall-tools">
        <div className="legend">
          {names.map((s) => (
            <span key={s}>
              <i style={{ background: serviceColors[s] }} />
              {s}
            </span>
          ))}
        </div>
        {trace.execution.attempts > 1 && (
          <select
            aria-label="Filter attempt"
            value={attempt}
            onChange={(e) => setAttempt(Number(e.target.value))}
          >
            <option value={0}>All attempts</option>
            {Array.from({ length: trace.execution.attempts }, (_, i) => (
              <option key={i} value={i + 1}>
                Attempt {i + 1}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="waterfall-scroll">
        <div className="waterfall-inner">
          <div className="trace-axis">
            <span>
              OPERATION <span className="muted">/ SERVICE</span>
            </span>
            <span className="axis-ticks">
              {[0, 0.25, 0.5, 0.75, 1].map((n) => (
                <b key={n}>{duration(total * n)}</b>
              ))}
            </span>
          </div>
          {spans.length === 0 ? (
            <p className="waiting">
              <LoaderCircle className="spin" size={16} /> Waiting for worker
              claim…
            </p>
          ) : (
            spans.map((s) => (
              <button
                key={s.id}
                className={`span-row ${selected === s.id ? "selected" : ""}`}
                onClick={() => setSelected(selected === s.id ? null : s.id)}
                aria-expanded={selected === s.id}
              >
                <span className={`span-label ${s.parent_id ? "child" : ""}`}>
                  <ChevronRight
                    size={11}
                    className={selected === s.id ? "rotate" : ""}
                  />
                  <i style={{ background: serviceColors[s.service] }} />
                  <span>
                    {s.name}
                    <small>
                      {s.service}{" "}
                      {s.status === "skipped" || s.status === "waiting_approval"
                        ? `· ${s.status} `
                        : ""}
                      {trace.execution.attempts > 1
                        ? `· attempt ${s.attempt}`
                        : ""}
                    </small>
                  </span>
                  {s.status === "error" ? (
                    <span className="error-dot">!</span>
                  ) : s.status === "running" ? (
                    <LoaderCircle size={12} className="spin" />
                  ) : s.status === "skipped" ? (
                    <ArrowRight size={12} className="muted" />
                  ) : s.status === "waiting_approval" ? (
                    <Pause size={12} className="muted" />
                  ) : (
                    <Check size={12} className="muted" />
                  )}
                </span>
                <span className="span-track">
                  <span
                    className={`span-bar ${s.status === "error" ? "bar-error" : ""} ${!s.ended_at ? "bar-running" : ""}`}
                    style={{
                      left: `${((s.started_at - min) / total) * 100}%`,
                      width: `${Math.max(0.8, (((s.ended_at || Date.now()) - s.started_at) / total) * 100)}%`,
                      background: serviceColors[s.service],
                    }}
                  />
                  <span className="span-timing">
                    {duration((s.ended_at || Date.now()) - s.started_at)}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      {focused ? (
        <div className="span-detail">
          <div className="inline spread">
            <strong>
              <Braces size={14} />
              {focused.name}
            </strong>
            <div className="tabs">
              {["input", "output", "attributes"].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "active" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {focused.error && <p className="error-text">{focused.error}</p>}
          <pre>
            {JSON.stringify(
              tab === "input"
                ? focused.input
                : tab === "output"
                  ? focused.output
                  : {
                      span_id: focused.id,
                      parent_id: focused.parent_id,
                      service: focused.service,
                      attempt: focused.attempt,
                      started_at: new Date(focused.started_at).toISOString(),
                      status: focused.status,
                    },
              null,
              2,
            )}
          </pre>
          <span className="redaction">
            <ShieldCheck size={12} /> Sensitive fields are redacted server-side
          </span>
        </div>
      ) : (
        <div className="waterfall-footer">
          <CircleDot size={12} /> Select a span to inspect its inputs, outputs,
          and timing <span>W3C trace IDs</span>
        </div>
      )}
    </section>
  );
}
function Throughput({ runs }: { runs: Run[] }) {
  const [metric, setMetric] = useState("latency");
  const [point, setPoint] = useState<number | null>(null);
  const completed = [...runs]
    .filter((r) => r.finished_at && r.started_at)
    .reverse()
    .slice(-20);
  const minute = Math.floor(Date.now() / 60000) * 60000;
  const points =
    metric === "latency"
      ? completed.map((r) => ({
          id: r.id,
          value: r.finished_at! - r.started_at!,
          label: r.payload.company,
          failed: r.status === "failed",
        }))
      : Array.from({ length: 12 }, (_, i) => {
          const start = minute - (11 - i) * 60000;
          return {
            id: String(start),
            value: runs.filter(
              (r) =>
                r.created_at >= start &&
                r.created_at < start + 60000 &&
                (metric === "throughput" ||
                  ["failed", "needs_review"].includes(r.status)),
            ).length,
            label: time(start).slice(0, 5),
            failed: metric === "errors",
          };
        });
  const max = Math.max(...points.map((p) => p.value), 1);
  const current = point === null ? null : points[point];
  const aggregate =
    metric === "latency"
      ? points.reduce((sum, p) => sum + p.value, 0) / Math.max(1, points.length)
      : points.reduce((sum, p) => sum + p.value, 0);
  const format = (n: number) =>
    metric === "latency" ? duration(n) : String(n);
  return (
    <section className="panel performance">
      <div className="panel-title">
        <div>
          <span className="eyebrow">PERFORMANCE</span>
          <h3>
            {metric === "latency"
              ? "Execution latency"
              : metric === "throughput"
                ? "Event throughput"
                : "Execution errors"}
          </h3>
        </div>
        <Activity size={17} className="muted" />
      </div>
      <div className="chart-tabs tabs">
        {["latency", "throughput", "errors"].map((m) => (
          <button
            key={m}
            className={metric === m ? "active" : ""}
            onClick={() => {
              setMetric(m);
              setPoint(null);
            }}
          >
            {m}
          </button>
        ))}
      </div>
      <div className="latency-number">
        {current
          ? format(current.value)
          : points.length
            ? format(aggregate)
            : "—"}
        <span>
          {current
            ? current.label
            : metric === "latency"
              ? "mean · recent completed runs"
              : "last 12 minutes · latest 100 events"}
        </span>
      </div>
      <div className="bar-chart">
        {points.length ? (
          points.map((r, i) => (
            <button
              key={r.id}
              onMouseEnter={() => setPoint(i)}
              onFocus={() => setPoint(i)}
              onClick={() => setPoint(i)}
              onMouseLeave={() => setPoint(null)}
              onBlur={() => setPoint(null)}
              aria-label={`${r.label}: ${format(r.value)}`}
              style={{
                height: `${Math.max(1, (r.value / max) * 100)}%`,
              }}
              className={r.failed ? "failed" : ""}
            />
          ))
        ) : (
          <p className="muted">Awaiting completed executions</p>
        )}
      </div>
      <div className="chart-labels">
        <span>{metric === "latency" ? "Earlier" : "11 min ago"}</span>
        <span>
          {metric === "latency" ? `Latest ${completed.length}` : "Now"}
        </span>
      </div>
      <div className="chart-note">
        <i /> {metric === "latency" ? "Measured duration" : "Events per minute"}{" "}
        <span className="amber-dot" /> Failed
      </div>
    </section>
  );
}
function RunTable({
  runs,
  selected,
  onSelect,
}: {
  runs: Run[];
  selected?: string | null;
  onSelect: (r: Run) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>EXECUTION / WORKFLOW</th>
            <th>STATUS</th>
            <th>DURATION</th>
            <th>ATTEMPTS</th>
            <th>STARTED</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              className={selected === r.id ? "selected" : ""}
              onClick={() => onSelect(r)}
            >
              <td>
                <button
                  className="table-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(r);
                  }}
                >
                  <GitBranch size={15} />
                  <span>
                    {r.payload.company}
                    <small>
                      {r.workflow_name} <code>#{r.id.slice(0, 7)}</code>
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <Badge status={r.status} />
              </td>
              <td className="mono">{runDuration(r)}</td>
              <td className="mono">{String(r.attempts).padStart(2, "0")}</td>
              <td className="mono muted">{time(r.created_at)}</td>
              <td>
                <ChevronRight size={14} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!runs.length && (
        <Empty
          title="No matching executions"
          description="Change the filter or run a new event."
        />
      )}
    </div>
  );
}

export default function Dashboard({ demo = false }: { demo?: boolean }) {
  const availableViews = demo ? views.filter(v => ["overview", "studio", "executions"].includes(v.id)) : views;
  const motionRef = useRef<HTMLDivElement>(null);
  const [runWorkflowId, setRunWorkflowId] = useState("");
  const [view, setView] = useState<View>(demo ? "studio" : "overview");
  const [data, setData] = useState<Snapshot | null>(null);
  useInterfaceMotion(motionRef, view, Boolean(data));
  const [trace, setTrace] = useState<Trace | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [live, setLive] = useState(true);
  const [hours, setHours] = useState("24");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [company, setCompany] = useState("Meridian Estates");
  const [value, setValue] = useState(4800);
  const [scenario, setScenario] = useState("success");
  const [runMode, setRunMode] = useState("sandbox");
  const runKey = useRef(crypto.randomUUID());
  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  };
  const go = (next: View) => {
    if (demo && !["overview", "studio", "executions"].includes(next)) next = "studio";
    if (
      next !== view &&
      !window.dispatchEvent(
        new Event("integrationos:before-navigate", { cancelable: true }),
      )
    ) {
      notify("Publish or discard your workflow changes before leaving Studio.");
      setSidebar(false);
      return;
    }
    setView(next);
    setSidebar(false);
    window.history.replaceState(null, "", "?view=" + next);
  };
  const refresh = useCallback(async () => {
    try {
      const next = await api<Snapshot>("snapshot?hours=" + hours);
      setData(next);
      setError("");
      const target = selectedRef.current || next.runs[0]?.id;
      if (target) {
        if (!selectedRef.current) {
          selectedRef.current = target;
          setSelected(target);
        }
        const detail = await api<Trace>("executions/" + target);
        if (selectedRef.current === target) setTrace(detail);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [hours]);
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view") as View;
    if (availableViews.some((x) => x.id === v)) setView(v);
  }, [demo]);
  useEffect(() => {
    void refresh();
    if (!live) return;
    const timer = setInterval(() => void refresh(), 2200);
    return () => clearInterval(timer);
  }, [refresh, live]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setSidebar(false);
      }
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input,select,textarea,a[href]",
        ) || [],
      );
    focusable()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = focusable();
      if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0]?.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal]);
  async function select(r: Run, inspect = false) {
    setSelected(r.id);
    selectedRef.current = r.id;
    setTrace(null);
    if (inspect) go("executions");
    try {
      const detail = await api<Trace>("executions/" + r.id);
      if (selectedRef.current === r.id) setTrace(detail);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openRun() {
    runKey.current = crypto.randomUUID();
    setModal("run");
  }
  async function run() {
    await action(async () => {
      const result = await api("executions", {
        method: "POST",
        headers: { "Idempotency-Key": runKey.current },
        body: JSON.stringify({
          payload: { company, value, region: "UK" },
          scenario,
          workflowId: runWorkflowId || data?.workflows[0]?.id,
          mode: runMode,
        }),
      });
      setSelected(result.id);
      selectedRef.current = result.id;
      setModal(null);
      notify("Event accepted. Worker execution queued.");
    });
  }
  async function replay(r: Run) {
    await action(async () => {
      const result = await api(`executions/${r.id}/replay`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({}),
      });
      selectedRef.current = result.id;
      setSelected(result.id);
      notify("Replay queued with fault injection removed.");
    });
  }
  const filtered = (data?.runs || []).filter(
    (r) =>
      (filter === "all" ||
        (filter === "attention"
          ? [
              "failed",
              "needs_review",
              "retry_wait",
              "waiting_approval",
            ].includes(r.status)
          : r.status === filter)) &&
      `${r.id} ${r.trace_id} ${r.payload.company} ${r.workflow_name}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const count = (status: string) =>
    data?.counts.find((c) => c.status === status)?.count || 0;
  const total = data?.counts.reduce((sum, c) => sum + c.count, 0) || 0;
  const done =
    count("success") +
    count("skipped") +
    count("failed") +
    count("needs_review");
  const success = done
    ? (((count("success") + count("skipped")) / done) * 100).toFixed(1)
    : "—";
  const durations = (data?.runs || [])
    .filter((r) => r.finished_at && r.started_at)
    .map((r) => r.finished_at! - r.started_at!)
    .sort((a, b) => a - b);
  const p95 = durations.length
    ? duration(durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)])
    : "—";
  const attention =
    count("failed") + count("needs_review") + count("waiting_approval");
  const title = views.find((v) => v.id === view)?.name;
  const sub: Record<View, string> = {
    overview: "Every system. Every workflow. One clear picture.",
    studio: "Build with intent. Execute with confidence.",
    integrations: "Connect your stack. Keep every system in sync.",
    executions: "Follow every event, from trigger to delivery.",
    audit: "A durable record of every operational change.",
  };
  return (
    <div className={`app-shell view-${view}${demo ? " is-demo" : ""}`} ref={motionRef}>
      <aside
        inert={Boolean(modal)}
        className={`sidebar ${sidebar ? "open" : ""}`}
      >
        <a className="brand" href={demo ? "/portfolio" : "/?view=overview"}>
          <span className="brand-mark">
            <Layers3 size={22} />
          </span>
          Integration<span>OS</span>
        </a>
        {demo && <div className="demo-sidebar-tag"><i /> INTERACTIVE ENGINE SANDBOX</div>}
        <button
          className="workspace-switch"
          disabled={demo}
          onClick={() => setModal("workspace")}
        >
          <span className="workspace-avatar">A</span>
          <span>
            {demo ? "Your visitor sandbox" : "Acme workspace"}<small>{demo ? "Private to this browser · 24 hours" : "Enterprise sandbox"}</small>
          </span>
          <ChevronDown size={13} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {availableViews.map((v) => (
            <button
              key={v.id}
              className={view === v.id ? "active" : ""}
              onClick={() => go(v.id)}
            >
              <v.icon size={17} />
              <span>{v.name}</span>
              {v.id === "executions" && attention > 0 && <b>{attention}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="engine-status">
            <span className="pulse-dot" />
            <div>
              {error
                ? "Connection interrupted"
                : data
                  ? "Engine online"
                  : "Connecting…"}
              <small>Durable queue · SQL storage</small>
            </div>
            <Activity size={14} />
          </div>
          <button onClick={() => setModal("architecture")}>
            <HelpCircle size={17} />
            Architecture & guide
            <ArrowUpRight size={13} />
          </button>
          {!demo && <button onClick={() => setModal("workspace")}>
            <Settings2 size={17} />
            Workspace settings
          </button>}
          <div className="user">
            <span className="user-avatar">
              {data?.workspace.user.slice(0, 1).toUpperCase() || "A"}
            </span>
            <div>
              {demo ? "Visitor workspace" : data?.workspace.user.split("@")[0] || "Workspace owner"}
              <small>{data?.workspace.role || (demo ? "Sandbox visitor" : "Admin")}</small>
            </div>
            {!demo && <a
              title="Sign out"
              href="/signout-with-chatgpt?return_to=/"
              target="_top"
            >
              <Unplug size={15} />
            </a>}
          </div>
        </div>
      </aside>
      <div className="main-shell" inert={Boolean(modal)}>
        <header className="topbar">
          <div className="inline">
            <button
              className="icon-btn mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setSidebar(!sidebar)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">{demo ? "Public sandbox" : "Workspace"}</span>
            <ChevronRight size={12} />
            <span>{title}</span>
          </div>
          <div className="top-actions">
            {demo && <a className="demo-top-link" href="/portfolio">Portfolio <ArrowUpRight size={14} /></a>}
            <label className="search">
              <Search size={14} />
              <input
                aria-label="Search executions"
                ref={searchRef}
                placeholder="Search executions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>/</kbd>
            </label>
            <span className="environment">
              <i />
              {data?.workflows.some((f) => f.config.mode === "live")
                ? "Live enabled"
                : "Sandbox"}
            </span>
            <button
              className="icon-btn"
              title="Executions requiring attention"
              onClick={() => {
                setFilter("attention");
                go("executions");
              }}
            >
              <Bell size={17} />
              {attention > 0 && <i className="notification-dot" />}
            </button>
          </div>
        </header>
        <main>
          {demo && view === "studio" ? (
            <DemoIntro
              engineStatus={error ? "offline" : data ? "online" : "connecting"}
              onInspect={() => go("executions")}
            />
          ) : (
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                INTEGRATION OPERATIONS <span>/</span>{" "}
                {view === "overview" ? "OVERVIEW" : view.toUpperCase()}
              </div>
              <h1>
                {title}
                <span className="heading-dot">.</span>
              </h1>
              <p>{sub[view]}</p>
            </div>
            <div className="heading-actions">
              <span className="engine-label">
                <span className="live-dot" />
                ENGINE ONLINE
              </span>
              <select
                aria-label="Time range"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              >
                <option value="1">Last hour</option>
                <option value="24">Last 24 hours</option>
                <option value="168">Last 7 days</option>
              </select>
              <button className="primary" onClick={openRun}>
                <Play size={14} fill="currentColor" />
                Run workflow
              </button>
            </div>
          </div>
          )}
          {error && (
            <div role="alert" className="error-banner">
              <Activity size={16} />
              {error}
              <button onClick={() => void refresh()}>Retry</button>
            </div>
          )}
          {!data && !error ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              <span>Connecting to your workspace…</span>
            </div>
          ) : (
            data && (
              <>
                <div className="sandbox-banner">
                  <div>
                    <Box size={15} />
                    <strong>{demo ? "Your isolated sandbox" : "Sandbox by default"}</strong>
                    <span>
                      {demo ? "Build, publish and run. Real traces; simulated integrations. 30 runs · expires after 24 hours. Use sample data." : "Real engine. Persisted traces. Live actions require connected accounts."}
                    </span>
                  </div>
                  {demo ? <a href="/portfolio">Back to portfolio <ArrowUpRight size={13} /></a> : <button
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api("seed", { method: "POST", body: "{}" });
                        notify(
                          "12 reference events queued. Traces will appear as workers execute.",
                        );
                      })
                    }
                  >
                    {total
                      ? "Load reference events"
                      : "Initialize reference events"}
                    <ArrowRight size={13} />
                  </button>}
                </div>
                {view === "overview" && (
                  <>
                    <div className="command-signal" data-enter>
                      <div>
                        <span className="micro-label">
                          ORCHESTRATION LAYER / 01
                        </span>
                        <h2>
                          Your systems.
                          <br />
                          <em>Perfectly orchestrated.</em>
                        </h2>
                        <p>
                          Every connection, decision and delivery.
                          <br />
                          One observable system of record.
                        </p>
                        <button
                          className="text-btn"
                          onClick={() => go("studio")}
                        >
                          Open Workflow Studio <ArrowUpRight size={15} />
                        </button>
                      </div>
                      <div
                        className="signal-map"
                        aria-label="Connected systems feed the workflow engine and execution traces"
                      >
                        <div className="signal-sources">
                          <span>
                            <Provider name="hubspot" small />
                            HubSpot
                          </span>
                          <span>
                            <Provider name="gmail" small />
                            Gmail
                          </span>
                          <span>
                            <Globe2 size={15} />
                            Webhook
                          </span>
                        </div>
                        <div className="signal-track">
                          <i />
                          <i />
                          <i />
                        </div>
                        <div className="signal-core">
                          <Layers3 size={28} />
                          <strong>IntegrationOS</strong>
                          <small>
                            {data.workflows.length} WORKFLOW
                            {data.workflows.length === 1 ? "" : "S"}
                          </small>
                        </div>
                        <div className="signal-track output">
                          <i />
                        </div>
                        <div className="signal-destinations">
                          <span>
                            <Provider name="slack" small />
                            Slack
                          </span>
                          <span>
                            <Activity size={15} />
                            Execution traces
                          </span>
                        </div>
                      </div>
                      <div className="signal-caption">
                        <span className="live-dot" />
                        PERSISTED EXECUTIONS <span>•</span> {total} IN SELECTED
                        WINDOW
                      </div>
                    </div>
                    <div className="metrics-grid">
                      {[
                        {
                          label: "Workflow executions",
                          value: compact(total),
                          sub: `${count("running") + count("queued")} active in queue`,
                          icon: Workflow,
                          color: "#7797fc",
                        },
                        {
                          label: "Success rate",
                          value: success === "—" ? "—" : success + "%",
                          sub: "Successful + filtered / completed",
                          icon: CheckCheck,
                          color: "#4ccea8",
                        },
                        {
                          label: "P95 execution latency",
                          value: p95,
                          sub: `Based on ${durations.length} completed samples`,
                          icon: Clock3,
                          color: "#8b8bed",
                        },
                        {
                          label: "Needs attention",
                          value: String(attention).padStart(2, "0"),
                          sub: `${count("retry_wait")} automatically retrying`,
                          icon: Activity,
                          color: "#e7b66e",
                        },
                      ].map((m) => (
                        <SpotlightCard
                          className="metric panel"
                          key={m.label}
                          spotlightColor={m.color}
                          intensity={0.1}
                          borderGlow={0.5}
                          proximity={40}
                          grain={0}
                        >
                          <div className="metric-label">
                            {m.label}
                            <m.icon size={16} />
                          </div>
                          <div className="metric-main">
                            <strong>{m.value}</strong>
                            <Spark
                              runs={data.runs}
                              color={m.color}
                              kind={
                                m.label === "Workflow executions"
                                  ? "count"
                                  : m.label === "Success rate"
                                    ? "success"
                                    : m.label === "Needs attention"
                                      ? "attention"
                                      : "latency"
                              }
                            />
                          </div>
                          <p>
                            <i style={{ background: m.color }} />
                            {m.sub}
                          </p>
                        </SpotlightCard>
                      ))}
                    </div>
                    <div className="section-heading">
                      <h2>
                        {demo ? "Sandbox adapters" : "Connected systems"} <span>03</span>
                      </h2>
                      <button
                        className="text-btn"
                        onClick={() => go("integrations")}
                      >
                        {demo ? "Build a workflow" : "Manage integrations"}
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                    <div className="system-grid">
                      {data.connections.map((c) => (
                        <button
                          className="system-card"
                          key={c.provider}
                          onClick={() => go("integrations")}
                        >
                          <Provider name={c.provider} />
                          <span>
                            <strong>
                              {c.provider === "gmail"
                                ? "Gmail"
                                : c.provider === "hubspot"
                                  ? "HubSpot"
                                  : "Slack"}
                            </strong>
                            <small>
                              {c.provider === "hubspot"
                                ? "Customer relationship management"
                                : c.provider === "slack"
                                  ? "Team notifications"
                                  : "Email & communication"}
                            </small>
                          </span>
                          <span
                            className={`connection-health ${c.status === "connected" ? "connected" : ""}`}
                          >
                            <i />
                            {c.status === "connected"
                              ? "Authorized"
                              : "Test adapter"}
                          </span>
                          <ChevronRight size={14} />
                        </button>
                      ))}
                    </div>
                    <div className="section-heading">
                      <div className="inline">
                        <h2>Execution telemetry</h2>
                        <button
                          className={`live-toggle ${live ? "on" : ""}`}
                          onClick={() => setLive(!live)}
                        >
                          {live ? <Radio size={12} /> : <Pause size={12} />}{" "}
                          {live ? "LIVE" : "PAUSED"}
                        </button>
                      </div>
                      <span className="muted micro">
                        {data.serverTime
                          ? "Updated " + time(data.serverTime)
                          : ""}
                      </span>
                    </div>
                    <div className="telemetry-grid">
                      <Waterfall
                        trace={trace}
                        compact
                        onExpand={() => go("executions")}
                      />
                      <Throughput runs={data.runs} />
                    </div>
                    <div className="bottom-grid">
                      <section className="panel">
                        <div className="panel-title">
                          <div className="inline">
                            <h3>Recent executions</h3>
                            <span className="count-pill">
                              {filtered.length}
                            </span>
                          </div>
                          <button
                            className="text-btn"
                            onClick={() => go("executions")}
                          >
                            View all
                            <ArrowRight size={13} />
                          </button>
                        </div>
                        <RunTable
                          runs={filtered.slice(0, 6)}
                          selected={selected}
                          onSelect={(r) => void select(r)}
                        />
                      </section>
                      <section className="panel activity-feed">
                        <div className="panel-title">
                          <h3>Activity stream</h3>
                          <span className="pulse-dot" />
                        </div>
                        <div className="activity-list">
                          {data.activity.slice(0, 5).map((a) => (
                            <button
                              key={a.id}
                              onClick={() => {
                                const r = data.runs.find(
                                  (r) => r.id === a.execution_id,
                                );
                                if (r) void select(r, true);
                                else go("audit");
                              }}
                            >
                              <span
                                className={`activity-symbol ${a.action.includes("failed") ? "warn" : ""}`}
                              >
                                {a.action.includes("failed") ? (
                                  <Activity size={13} />
                                ) : (
                                  <Check size={13} />
                                )}
                              </span>
                              <span>
                                <strong>
                                  {a.action
                                    .replaceAll(".", " · ")
                                    .replaceAll("_", " ")}
                                </strong>
                                <small>
                                  {a.execution_id
                                    ? "#" + a.execution_id.slice(0, 8)
                                    : a.detail.provider || "Workspace"}
                                  <time>{time(a.created_at)}</time>
                                </small>
                              </span>
                            </button>
                          ))}
                          {!data.activity.length && (
                            <p className="muted">
                              Activity will appear after your first event.
                            </p>
                          )}
                        </div>
                        <button
                          className="feed-footer"
                          onClick={() => go("audit")}
                        >
                          Open audit trail
                          <ArrowUpRight size={13} />
                        </button>
                      </section>
                    </div>
                  </>
                )}
                {view === "executions" && (
                  <>
                    <div className="filter-bar">
                      <div className="tabs">
                        {[
                          ["all", "All executions"],
                          ["success", "Successful"],
                          ["attention", "Needs attention"],
                          ["skipped", "Filtered"],
                        ].map(([key, label]) => (
                          <button
                            key={key}
                            className={filter === key ? "active" : ""}
                            onClick={() => setFilter(key)}
                          >
                            {label}
                            {key === "attention" && attention > 0 && (
                              <b>{attention}</b>
                            )}
                          </button>
                        ))}
                      </div>
                      <button
                        className="text-btn"
                        onClick={() => setLive(!live)}
                      >
                        {live ? <Pause size={13} /> : <Play size={13} />}{" "}
                        {live ? "Pause updates" : "Resume updates"}
                      </button>
                    </div>
                    <div className="inspector-grid">
                      <section className="panel execution-list">
                        <div className="panel-title">
                          <h3>Executions</h3>
                          <span className="count-pill">{filtered.length}</span>
                        </div>
                        {filtered.map((r) => (
                          <button
                            key={r.id}
                            className={`execution-list-item ${selected === r.id ? "active" : ""}`}
                            onClick={() => void select(r)}
                          >
                            <div>
                              <strong>{r.payload.company}</strong>
                              <Badge status={r.status} />
                            </div>
                            <small>
                              <code>#{r.id.slice(0, 8)}</code>
                              <span>
                                {runDuration(r)} · {time(r.created_at)}
                              </span>
                            </small>
                          </button>
                        ))}
                        {!filtered.length && (
                          <Empty
                            title="No executions"
                            description="Run a workflow to inspect its trace."
                          />
                        )}
                      </section>
                      <div className="inspector-detail">
                        {trace && (
                          <div className="inspector-toolbar">
                            <div>
                              <code>
                                exec_{trace.execution.id.slice(0, 12)}
                              </code>
                              <span>
                                Version {trace.execution.workflow_version} ·{" "}
                                {trace.execution.source}
                              </span>
                            </div>
                            <div className="inline">
                              <button
                                className="secondary"
                                title="Copy trace ID"
                                onClick={() =>
                                  void navigator.clipboard
                                    .writeText(trace.execution.trace_id)
                                    .then(() => notify("Trace ID copied."))
                                    .catch(() =>
                                      notify(
                                        "Clipboard unavailable. Trace ID is shown above.",
                                      ),
                                    )
                                }
                              >
                                <Copy size={14} />
                              </button>
                              <button
                                className="secondary"
                                onClick={() => {
                                  const blob = new Blob(
                                    [JSON.stringify(trace, null, 2)],
                                    { type: "application/json" },
                                  );
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement("a");
                                  a.href = url;
                                  a.download =
                                    "trace-" + trace.execution.id + ".json";
                                  a.click();
                                  URL.revokeObjectURL(url);
                                }}
                              >
                                <Download size={14} />
                                Export
                              </button>
                              {["failed", "skipped"].includes(
                                trace.execution.status,
                              ) && (
                                <button
                                  className="primary"
                                  disabled={busy}
                                  onClick={() => void replay(trace.execution)}
                                >
                                  <RefreshCw size={14} />
                                  Safe replay
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {trace?.execution.status === "waiting_approval" && (
                          <section className="approval-queue panel">
                            <ShieldCheck size={23} />
                            <div>
                              <span className="micro-label">
                                HUMAN IN THE LOOP
                              </span>
                              <h3>This execution needs your decision.</h3>
                              {trace.nodes
                                .filter((n) => n.status === "waiting")
                                .map((n) => (
                                  <div
                                    className="approval-request"
                                    key={n.node_id}
                                  >
                                    <p>
                                      {trace.execution.config.graph?.nodes.find(
                                        (x) => x.id === n.node_id,
                                      )?.config.prompt ||
                                        "Review this step before continuing."}
                                    </p>
                                    <button
                                      className="primary"
                                      disabled={busy}
                                      onClick={() =>
                                        void action(async () => {
                                          await api(
                                            "approvals/" + trace.execution.id,
                                            {
                                              method: "POST",
                                              body: JSON.stringify({
                                                nodeId: n.node_id,
                                                decision: "approved",
                                              }),
                                            },
                                          );
                                          notify(
                                            "Approved. Execution resumed from its checkpoint.",
                                          );
                                        })
                                      }
                                    >
                                      Approve & continue
                                    </button>
                                    <button
                                      className="secondary"
                                      disabled={busy}
                                      onClick={() =>
                                        void action(async () => {
                                          await api(
                                            "approvals/" + trace.execution.id,
                                            {
                                              method: "POST",
                                              body: JSON.stringify({
                                                nodeId: n.node_id,
                                                decision: "rejected",
                                              }),
                                            },
                                          );
                                          notify(
                                            "Rejected. Execution will stop.",
                                          );
                                        })
                                      }
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ))}
                            </div>
                          </section>
                        )}
                        <Waterfall trace={trace} />
                        {trace && (
                          <section className="panel execution-context">
                            <div className="panel-title">
                              <h3>Execution context</h3>
                              <ShieldCheck size={16} />
                            </div>
                            <div className="context-grid">
                              <div>
                                <span className="eyebrow">
                                  NORMALIZED EVENT
                                </span>
                                <pre>
                                  {JSON.stringify(
                                    trace.execution.payload,
                                    null,
                                    2,
                                  )}
                                </pre>
                              </div>
                              <div>
                                <span className="eyebrow">CORRELATED LOGS</span>
                                {trace.logs.map((l) => (
                                  <div className="log-line" key={l.id}>
                                    <time>{time(l.created_at)}</time>
                                    <code>{l.action}</code>
                                  </div>
                                ))}
                                {trace.execution.error && (
                                  <p className="error-text">
                                    {trace.execution.error}
                                  </p>
                                )}
                              </div>
                            </div>
                          </section>
                        )}
                      </div>
                    </div>
                  </>
                )}
                {view === "studio" && (
                  <WorkflowStudio
                    demo={demo}
                    flows={data.workflows}
                    onPublished={refresh}
                    onInspect={(id) => {
                      selectedRef.current = id;
                      setSelected(id);
                      setTrace(null);
                      go("executions");
                      void refresh();
                    }}
                  />
                )}
                {!demo && view === "integrations" && (
                  <>
                    <div className="section-heading">
                      <h2>Your integration stack</h2>
                      <span className="muted">
                        {
                          data.connections.filter(
                            (c) => c.status === "connected",
                          ).length
                        }{" "}
                        live connections · 3 available adapters
                      </span>
                    </div>
                    <div className="integration-grid">
                      {data.connections.map((c) => (
                        <section
                          key={c.provider}
                          className="panel integration-card"
                        >
                          <div className="inline spread">
                            <Provider name={c.provider} />
                            <span className="mode-label">
                              {c.status === "connected"
                                ? "LIVE ACCOUNT"
                                : "SANDBOX"}
                            </span>
                          </div>
                          <h2>
                            {c.provider === "hubspot"
                              ? "HubSpot"
                              : c.provider === "slack"
                                ? "Slack"
                                : "Gmail"}
                          </h2>
                          <p>
                            {c.provider === "hubspot"
                              ? "Read CRM contacts through an authorized HubSpot account."
                              : c.provider === "slack"
                                ? "Deliver workflow notifications and verify accessible channels."
                                : "Read message IDs from an authorized Gmail mailbox."}
                          </p>
                          <div className="integration-details">
                            <span>
                              Authentication<strong>OAuth 2.0</strong>
                            </span>
                            <span>
                              Credential storage<strong>AES-256-GCM</strong>
                            </span>
                            <span>
                              Last checked
                              <strong>
                                {c.synced_at
                                  ? time(c.synced_at)
                                  : "Not checked"}
                              </strong>
                            </span>
                          </div>
                          {c.summary && (
                            <div className="sync-result">
                              <Check size={13} />
                              {c.summary.message ||
                                `${c.summary.count} ${c.summary.resource} read (first page)`}
                            </div>
                          )}
                          <div className="integration-actions">
                            <button
                              disabled={busy}
                              className="secondary"
                              onClick={() =>
                                void action(async () => {
                                  await api(`connections/${c.provider}/sync`, {
                                    method: "POST",
                                    body: "{}",
                                  });
                                  notify(
                                    c.status === "sandbox"
                                      ? "Test adapter health check completed."
                                      : "Provider read completed.",
                                  );
                                })
                              }
                            >
                              <RefreshCw size={14} />
                              {c.status === "sandbox"
                                ? "Test adapter"
                                : "Read provider"}
                            </button>
                            {c.status === "connected" ? (
                              <button
                                disabled={busy}
                                className="text-btn"
                                onClick={() =>
                                  setModal("disconnect:" + c.provider)
                                }
                              >
                                Disconnect
                              </button>
                            ) : (
                              <button
                                className="primary"
                                disabled={busy}
                                onClick={() => {
                                  if (!c.configured)
                                    setModal("setup:" + c.provider);
                                  else
                                    void action(async () => {
                                      const result = await api(
                                        `connections/${c.provider}/authorize`,
                                        { method: "POST", body: "{}" },
                                      );
                                      window.location.assign(result.url);
                                    });
                                }}
                              >
                                {c.configured
                                  ? "Connect account"
                                  : "Set up OAuth"}
                                <ArrowUpRight size={14} />
                              </button>
                            )}
                          </div>
                        </section>
                      ))}
                    </div>
                    <div className="integration-note">
                      <ShieldCheck size={20} />
                      <div>
                        <h3>Credentials stay on the server</h3>
                        <p>
                          OAuth credentials are encrypted with workspace-bound
                          authenticated encryption. Provider checks read one
                          page; continuous bidirectional synchronization is not
                          enabled in this release.
                        </p>
                      </div>
                    </div>
                  </>
                )}
                {view === "audit" && (
                  <section className="panel">
                    <div className="panel-title">
                      <h3>Workspace audit history</h3>
                      <span className="muted micro">
                        Latest 30 events · persisted in SQL
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>TIME</th>
                            <th>EVENT</th>
                            <th>EXECUTION</th>
                            <th>CONTEXT</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.activity.map((a) => (
                            <tr key={a.id}>
                              <td className="mono muted">
                                {time(a.created_at)}
                              </td>
                              <td>
                                <span className="inline">
                                  <FileClock size={14} />
                                  {a.action}
                                </span>
                              </td>
                              <td>
                                <button
                                  className="text-btn mono"
                                  onClick={() => {
                                    const r = data.runs.find(
                                      (r) => r.id === a.execution_id,
                                    );
                                    if (r) void select(r, true);
                                    else
                                      notify(
                                        "Execution is outside the selected time range.",
                                      );
                                  }}
                                  disabled={!a.execution_id}
                                >
                                  {a.execution_id
                                    ? "#" + a.execution_id.slice(0, 10)
                                    : "Workspace"}
                                </button>
                              </td>
                              <td className="mono micro muted">
                                {JSON.stringify(a.detail)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!data.activity.length && (
                        <Empty
                          title="A clean audit trail"
                          description="Run a workflow or check an adapter to record your first event."
                        />
                      )}
                    </div>
                  </section>
                )}
                <footer className="page-footer">
                  <span>
                    <span className="pulse-dot" />
                    All values sourced from persisted executions
                  </span>
                  <span>
                    IntegrationOS <b>CORE / 01</b>
                  </span>
                </footer>
              </>
            )
          )}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CircleDot size={17} />
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="modal panel"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-btn"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={18} />
            </button>
            {modal === "run" ? (
              <>
                <span className="eyebrow">WORKFLOW LAUNCHER</span>
                <h2 id="modal-title">Send an event. Follow the trace.</h2>
                <p>
                  The event is validated, persisted, and processed by the
                  background engine.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run();
                  }}
                >
                  <label>
                    Workflow
                    <select
                      aria-label="Workflow to run"
                      value={runWorkflowId || data?.workflows[0]?.id}
                      onChange={(e) => {
                        setRunWorkflowId(e.target.value);
                        setRunMode("sandbox");
                      }}
                    >
                      {data?.workflows.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Company
                    <input
                      autoFocus
                      required
                      maxLength={120}
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      Enquiry value (£)
                      <input
                        type="number"
                        required
                        min={0}
                        max={100000000}
                        value={value}
                        onChange={(e) => setValue(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Environment
                      <select
                        value={runMode}
                        onChange={(e) => setRunMode(e.target.value)}
                      >
                        <option value="sandbox">Sandbox</option>
                        {(
                          data?.workflows.find((f) => f.id === runWorkflowId) ||
                          data?.workflows[0]
                        )?.config.mode === "live" && (
                          <option value="live">Live connected actions</option>
                        )}
                      </select>
                    </label>
                  </div>
                  {runMode === "sandbox" && (
                    <label>
                      Test scenario
                      <select
                        value={scenario}
                        onChange={(e) => setScenario(e.target.value)}
                      >
                        <option value="success">Healthy destination</option>
                        <option value="transient">
                          Rate limit once → recover
                        </option>
                        <option value="failure">
                          Persistent failure → dead letter
                        </option>
                      </select>
                    </label>
                  )}
                  <div className="run-notice">
                    <ShieldCheck size={16} />
                    {runMode === "sandbox"
                      ? "No external calls. Real persistence, orchestration, and timing."
                      : "This run will send a message to your configured Slack channel."}
                  </div>
                  <button
                    disabled={busy}
                    className="primary wide"
                    type="submit"
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Play size={15} />
                    )}
                    Execute workflow
                  </button>
                </form>
              </>
            ) : modal.startsWith("setup:") ? (
              <>
                <span className="eyebrow">PROVIDER CONFIGURATION</span>
                <h2 id="modal-title">Connect {modal.split(":")[1]}</h2>
                <p>
                  Register an OAuth app with the provider, then configure these
                  server environment variables through your hosting settings.
                </p>
                <pre>{`${modal.endsWith("gmail") ? "GOOGLE" : modal.split(":")[1].toUpperCase()}_CLIENT_ID\n${modal.endsWith("gmail") ? "GOOGLE" : modal.split(":")[1].toUpperCase()}_CLIENT_SECRET\nTOKEN_ENCRYPTION_KEY (32+ random characters)`}</pre>
                <label>
                  Allowed callback URL
                  <input
                    readOnly
                    value={`${typeof window !== "undefined" ? window.location.origin : ""}/api/connections/${modal.split(":")[1]}/callback`}
                  />
                </label>
                <p className="muted">
                  Once configured, the Connect account button starts the real
                  OAuth authorization flow. Test adapters remain available in
                  the meantime.
                </p>
                <button className="primary wide" onClick={() => setModal(null)}>
                  Understood
                </button>
              </>
            ) : modal.startsWith("disconnect:") ? (
              <>
                <h2 id="modal-title">Disconnect {modal.split(":")[1]}?</h2>
                <p>
                  This removes the locally stored credentials and restores the
                  test adapter. Revoke the app in the provider’s settings to
                  revoke its grant as well.
                </p>
                <button
                  className="primary wide"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await api("connections/" + modal.split(":")[1], {
                        method: "DELETE",
                        body: "{}",
                      });
                      setModal(null);
                      notify("Credentials removed.");
                    })
                  }
                >
                  Remove connection
                </button>
              </>
            ) : modal === "workspace" && !demo ? (
              <>
                <span className="eyebrow">WORKSPACE</span>
                <h2 id="modal-title">Workspace operations</h2>
                {data && (
                  <WorkspaceOperations
                    workspace={data.workspace}
                    workspaces={data.workspaces || [data.workspace]}
                    maintenance={data.maintenance}
                  />
                )}
              </>
            ) : (
              <>
                <span className="eyebrow">ENGINEERING NOTES</span>
                <h2 id="modal-title">Built to show its work.</h2>
                <p>
                  IntegrationOS connects a React interface to a durable SQL
                  execution engine on Cloudflare Workers.
                </p>
                <div className="guide-steps">
                  <div>
                    <b>01</b>
                    <span>
                      <strong>Ingest & persist</strong>Validate input, verify
                      signed webhooks, and deduplicate events by workspace and
                      idempotency key.
                    </span>
                  </div>
                  <div>
                    <b>02</b>
                    <span>
                      <strong>Claim & execute</strong>Workers atomically claim a
                      lease, execute the versioned pipeline, and record every
                      span.
                    </span>
                  </div>
                  <div>
                    <b>03</b>
                    <span>
                      <strong>Observe & recover</strong>Inspect live timings,
                      retry rate limits, review uncertain delivery, and replay
                      failed sandbox events.
                    </span>
                  </div>
                </div>
                <p className="muted">
                  This is the Core release. Document Intelligence and
                  PropertyOps are deferred until the core’s production gates
                  pass. Workspace operations shows the latest unattended
                  recovery heartbeat, sync controls, members and verified
                  backups.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
