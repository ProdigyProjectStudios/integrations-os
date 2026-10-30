"use client";
import { workspaceHeaders, apiUrl } from "./workspace-api";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  BackgroundVariant,
} from "@xyflow/react";
import {
  Zap,
  Braces,
  GitBranch,
  Send,
  Clock3,
  ShieldCheck,
  Sparkles,
  Mail,
  Contact,
  Plus,
  Save,
  Play,
  Undo2,
  Redo2,
  Trash2,
  ArrowUpRight,
  Check,
  Move,
  Download,
  Upload,
  X,
  LayoutGrid,
} from "lucide-react";
import { referenceGraph, validateGraph } from "../core/graph-definition.mjs";
import "@xyflow/react/dist/style.css";

type NodeConfig = {
  field?: string;
  operation?: string;
  operator?: string;
  value?: string;
  channel?: string;
  message?: string;
  ms?: number;
  prompt?: string;
  instruction?: string;
  labels?: string[];
};
export type GraphNode = {
  id: string;
  kind: string;
  label: string;
  position: { x: number; y: number };
  config: NodeConfig;
};
export type Graph = {
  nodes: GraphNode[];
  edges: {
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
  }[];
};
export type WorkflowConfig = {
  minimumValue: number;
  channel: string;
  message: string;
  mode: string;
  maxAttempts: number;
  graph?: Graph;
};
export type Flow = {
  id: string;
  name: string;
  version: number;
  config: WorkflowConfig;
};
type StepData = Record<string, unknown> & {
  kind: string;
  label: string;
  config: NodeConfig;
  status?: string;
};
type FlowNode = Node<StepData>;
const catalog = [
  {
    kind: "trigger",
    name: "Event trigger",
    note: "Signed webhook or console",
    icon: Zap,
    color: "#88a4ff",
    config: {},
  },
  {
    kind: "transform",
    name: "Transform",
    note: "Shape and enrich data",
    icon: Braces,
    color: "#b797ff",
    config: { field: "company", operation: "uppercase", value: "" },
  },
  {
    kind: "condition",
    name: "Condition",
    note: "Route true / false paths",
    icon: GitBranch,
    color: "#e6bd70",
    config: { field: "value", operator: "gte", value: "1000" },
  },
  {
    kind: "slack",
    name: "Slack message",
    note: "Deliver a notification",
    icon: Send,
    color: "#74d9bf",
    config: {
      channel: "integration-events",
      message: "New enquiry: {{company}} · {{value}}",
    },
  },
  {
    kind: "hubspot",
    name: "HubSpot read",
    note: "Read contact summary",
    icon: Contact,
    color: "#ff9b78",
    config: {},
  },
  {
    kind: "gmail",
    name: "Gmail read",
    note: "Read mailbox summary",
    icon: Mail,
    color: "#f4a0b9",
    config: {},
  },
  {
    kind: "approval",
    name: "Human approval",
    note: "Pause until reviewed",
    icon: ShieldCheck,
    color: "#e4bc77",
    config: { prompt: "Review this enquiry before delivery." },
  },
  {
    kind: "ai",
    name: "AI classify",
    note: "Schema-validated category",
    icon: Sparkles,
    color: "#b8a1ff",
    config: {
      field: "category",
      instruction: "Classify this enquiry into the best category.",
      labels: ["qualified", "nurture"],
    },
  },
  {
    kind: "delay",
    name: "Delay",
    note: "Controlled timing",
    icon: Clock3,
    color: "#86b6d9",
    config: { ms: 500 },
  },
];
const info = (kind: string) =>
  catalog.find((c) => c.kind === kind) || catalog[0];
const makeNodes = (graph: Graph): FlowNode[] =>
  graph.nodes.map((n) => ({
    id: n.id,
    type: "step",
    position: n.position,
    data: { kind: n.kind, label: n.label, config: n.config },
  }));
const makeEdges = (graph: Graph): Edge[] =>
  graph.edges.map((e) => ({
    ...e,
    type: "smoothstep",
    label: e.sourceHandle,
    animated: false,
  }));
const serialize = (nodes: FlowNode[], edges: Edge[]): Graph => ({
  nodes: nodes.map((n) => ({
    id: n.id,
    kind: n.data.kind,
    label: n.data.label,
    position: n.position,
    config: n.data.config,
  })),
  edges: edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
  })),
});
async function call(path: string, body?: unknown, method = "POST") {
  const response = await fetch(apiUrl(path), {
    method: body === undefined ? "GET" : method,
    headers: {
      "Content-Type": "application/json",
      ...workspaceHeaders(),
      "Idempotency-Key": crypto.randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await response.json()) as {
    id: string;
    error?: string;
    execution: { status: string };
    nodes: { node_id: string; status: string }[];
  };
  if (!response.ok) throw new Error(json.error || "Request failed.");
  return json;
}
function StepNode({ data, selected }: NodeProps<FlowNode>) {
  const c = info(data.kind);
  const Icon = c.icon;
  return (
    <div
      className={`flow-node ${selected ? "selected" : ""} state-${data.status || "idle"}`}
      style={{ "--node-color": c.color } as React.CSSProperties}
    >
      {data.kind !== "trigger" && (
        <Handle type="target" position={Position.Left} aria-label="Input" />
      )}
      <div className="node-topline">
        <span>
          {data.kind === "trigger"
            ? "TRIGGER"
            : data.kind === "condition"
              ? "ROUTER"
              : "ACTION"}
        </span>
        <span className="node-state">
          {data.status === "success" ? <Check size={11} /> : <span />}
          {data.status || "ready"}
        </span>
      </div>
      <div className="node-title">
        <span className="node-icon">
          <Icon size={19} />
        </span>
        <strong>{data.label}</strong>
      </div>
      <div className="node-description">
        {data.kind === "condition"
          ? `${data.config.field} ${data.config.operator} ${data.config.value}`
          : data.kind === "slack"
            ? `# ${data.config.channel}`
            : data.kind === "transform"
              ? `${data.config.operation} → ${data.config.field}`
              : c.note}
      </div>
      {data.kind === "condition" ? (
        <>
          <span className="branch-label yes">True</span>
          <Handle
            id="true"
            type="source"
            position={Position.Right}
            style={{ top: "64%" }}
          />
          <span className="branch-label no">False</span>
          <Handle
            id="false"
            type="source"
            position={Position.Right}
            style={{ top: "88%" }}
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} aria-label="Output" />
      )}
    </div>
  );
}
const nodeTypes = { step: StepNode };
type Props = {
  demo?: boolean;
  flows: Flow[];
  onPublished: () => Promise<void>;
  onInspect: (id: string) => void;
};
export default function WorkflowStudio(props: Props) {
  return (
    <ReactFlowProvider>
      <Builder {...props} />
    </ReactFlowProvider>
  );
}
function Builder({ flows, onPublished, onInspect, demo = false }: Props) {
  const [flowId, setFlowId] = useState(flows[0].id);
  const flow = flows.find((f) => f.id === flowId) || flows[0];
  const graph = flow.config.graph || (referenceGraph(flow.config) as Graph);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(
    makeNodes(graph),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    makeEdges(graph),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState(flow.name),
    [mode, setMode] = useState(flow.config.mode),
    [attempts, setAttempts] = useState(flow.config.maxAttempts);
  const [dirty, setDirty] = useState(!flow.config.graph),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [history, setHistory] = useState<Graph[]>([]),
    [future, setFuture] = useState<Graph[]>([]);
  const [runId, setRunId] = useState(""),
    [runState, setRunState] = useState(""),
    [runNodes, setRunNodes] = useState<Record<string, string>>({});
  const [company, setCompany] = useState("Meridian Estates"),
    [value, setValue] = useState(4800),
    [scenario, setScenario] = useState("success");
  const [drawer, setDrawer] = useState(false),
    [newName, setNewName] = useState(""),
    [creating, setCreating] = useState(false);
  const [connectTarget, setConnectTarget] = useState(""),
    [connectPort, setConnectPort] = useState("true");
  const upload = useRef<HTMLInputElement>(null),
    canvas = useRef<HTMLDivElement>(null);
  const rf = useReactFlow<FlowNode, Edge>();
  const loaded = useRef({ id: flow.id, version: flow.version });
  const [baseVersion, setBaseVersion] = useState(flow.version);
  useLayoutEffect(() => {
    if (
      loaded.current.id === flow.id &&
      loaded.current.version !== flow.version &&
      dirty
    ) {
      setError(
        "A newer version was published in another session. Your draft is preserved. Export it or discard changes to load the latest version.",
      );
      return;
    }
    loaded.current = { id: flow.id, version: flow.version };
    setBaseVersion(flow.version);
    const g = flow.config.graph || (referenceGraph(flow.config) as Graph);
    setNodes(makeNodes(g));
    setEdges(makeEdges(g));
    setName(flow.name);
    setMode(flow.config.mode);
    setAttempts(flow.config.maxAttempts);
    setDirty(!flow.config.graph);
    setSelected(null);
    setHistory([]);
    setFuture([]);
    setRunId("");
    setRunState("");
    setRunNodes({});
  }, [flow.id, flow.version]); // retain unsaved edits during polling
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    const navigate = (e: Event) => e.preventDefault();
    window.addEventListener("integrationos:before-navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", handler);
      window.removeEventListener("integrationos:before-navigate", navigate);
    };
  }, [dirty]);
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await call("executions/" + runId);
        if (alive) {
          setRunState(r.execution.status);
          setRunNodes(
            Object.fromEntries(
              r.nodes.map((n: { node_id: string; status: string }) => [
                n.node_id,
                n.status,
              ]),
            ),
          );
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(poll, 1800);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [runId]);
  const snapshot = () => serialize(nodes, edges);
  function remember() {
    setHistory((h) => [...h.slice(-29), snapshot()]);
    setFuture([]);
    setDirty(true);
    setError("");
    setNotice("");
  }
  function restore(g: Graph) {
    setNodes(makeNodes(g));
    setEdges(makeEdges(g));
    setDirty(true);
    setSelected(null);
  }
  const connect = useCallback(
    (connection: Connection) => {
      remember();
      setEdges((es) =>
        addEdge(
          {
            ...connection,
            id: crypto.randomUUID(),
            type: "smoothstep",
            label: connection.sourceHandle || undefined,
          },
          es,
        ),
      );
    },
    [nodes, edges],
  );
  function add(kind: string, position?: { x: number; y: number }) {
    if (nodes.length >= 24) {
      setError("Maximum 24 nodes per workflow.");
      return;
    }
    if (kind === "trigger" && nodes.some((n) => n.data.kind === "trigger")) {
      setError("A workflow has exactly one trigger.");
      return;
    }
    remember();
    const c = info(kind),
      nodeId = crypto.randomUUID();
    const pos =
      position ||
      rf.screenToFlowPosition({
        x: (canvas.current?.getBoundingClientRect().left || 0) + 300,
        y: (canvas.current?.getBoundingClientRect().top || 0) + 220,
      });
    setNodes((ns) => [
      ...ns,
      {
        id: nodeId,
        type: "step",
        position: pos,
        data: { kind, label: c.name, config: structuredClone(c.config) },
      },
    ]);
    setSelected(nodeId);
    setDrawer(true);
  }
  const node = nodes.find((n) => n.id === selected);
  function updateConfig(key: string, value: unknown) {
    remember();
    setNodes((ns) =>
      ns.map((n) =>
        n.id === selected
          ? {
              ...n,
              data: { ...n.data, config: { ...n.data.config, [key]: value } },
            }
          : n,
      ),
    );
  }
  function remove() {
    if (!node) return;
    remember();
    setNodes((ns) => ns.filter((n) => n.id !== selected));
    setEdges((es) =>
      es.filter((e) => e.source !== selected && e.target !== selected),
    );
    setSelected(null);
  }
  async function publish() {
    setBusy(true);
    setError("");
    try {
      const g = validateGraph(snapshot());
      await call(
        "workflows",
        {
          id: flow.id,
          name,
          version: baseVersion,
          config: { ...flow.config, mode, maxAttempts: attempts, graph: g },
        },
        "PUT",
      );
      setDirty(false);
      await onPublished();
      setNotice("Version published. The engine will execute this graph.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = await call("executions", {
        workflowId: flow.id,
        payload: { company, value, region: "UK" },
        mode,
        scenario,
      });
      setRunId(result.id);
      setRunState("queued");
      setRunNodes({});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function autoLayout() {
    remember();
    const levels = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++)
      for (const n of nodes) {
        const parents = edges.filter((e) => e.target === n.id);
        if (parents.every((e) => levels.has(e.source)))
          levels.set(
            n.id,
            parents.length
              ? Math.max(...parents.map((e) => levels.get(e.source)!)) + 1
              : 0,
          );
      }
    const offsets = new Map<number, number>();
    setNodes((ns) =>
      ns.map((n) => {
        const l = levels.get(n.id) || 0,
          offset = offsets.get(l) || 0;
        offsets.set(l, offset + 1);
        return { ...n, position: { x: 70 + l * 310, y: 80 + offset * 210 } };
      }),
    );
    requestAnimationFrame(
      () => void rf.fitView({ duration: 300, padding: 0.18 }),
    );
  }
  const displayNodes = nodes.map((n) => ({
    ...n,
    data: { ...n.data, status: runNodes[n.id] },
  }));
  return (
    <section id={demo ? "workflow-studio" : undefined} className="workflow-workbench" data-enter>
      <div className="studio-toolbar">
        <div className="studio-identity">
          <span className="studio-symbol">
            <GitBranch size={20} />
          </span>
          <div>
            <span className="micro-label">WORKFLOW / V{baseVersion}</span>
            <select
              aria-label="Select workflow"
              value={flow.id}
              onChange={(e) => {
                if (dirty) {
                  setError(
                    "Publish or discard your changes before switching workflows.",
                  );
                  return;
                }
                setFlowId(e.target.value);
              }}
            >
              {flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <span className={`draft-badge ${dirty ? "unsaved" : ""}`}>
            {dirty ? "Unsaved changes" : "Published"}
          </span>
        </div>
        <div className="studio-tools">
          <button
            className="secondary"
            title="Create workflow"
            onClick={() => setCreating(!creating)}
          >
            <Plus size={14} />
            <span>New</span>
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void publish()}
          >
            <Save size={14} />
            Publish version
          </button>
        </div>
      </div>
      {creating && (
        <form
          className="create-workflow"
          onSubmit={async (e) => {
            e.preventDefault();
            if (dirty) {
              setError("Publish or discard changes first.");
              return;
            }
            setBusy(true);
            try {
              const r = await call("workflows", { name: newName });
              await onPublished();
              setFlowId(r.id);
              setCreating(false);
              setNewName("");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            required
            maxLength={80}
            aria-label="New workflow name"
            placeholder="Workflow name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="primary" disabled={busy}>
            Create workflow
          </button>
        </form>
      )}
      {error && (
        <div className="studio-message error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}
      {notice && (
        <div className="studio-message" role="status">
          <Check size={14} />
          {notice}
        </div>
      )}
      <div className="builder-layout" inert={busy} aria-busy={busy}>
        <aside className="node-palette" data-lenis-prevent>
          <div className="palette-heading">
            <span className="micro-label">BUILDING BLOCKS</span>
            <span>01—09</span>
          </div>
          <h3>Make it flow.</h3>
          <p>
            Drag a step onto the canvas.
            <br />
            Connect it. Make it yours.
          </p>
          <div className="palette-list">
            {catalog.map((c) => (
              <button
                key={c.kind}
                className="palette-item"
                aria-label={"Add " + c.name}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.currentTarget.dataset.startX = String(e.clientX);
                  e.currentTarget.dataset.startY = String(e.clientY);
                }}
                onPointerUp={(e) => {
                  const moved =
                    Math.hypot(
                      e.clientX - Number(e.currentTarget.dataset.startX),
                      e.clientY - Number(e.currentTarget.dataset.startY),
                    ) > 12;
                  const b = canvas.current?.getBoundingClientRect();
                  if (
                    moved &&
                    b &&
                    e.clientX > b.left &&
                    e.clientX < b.right &&
                    e.clientY > b.top &&
                    e.clientY < b.bottom
                  ) {
                    e.currentTarget.dataset.dragged = "yes";
                    add(
                      c.kind,
                      rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }),
                    );
                  }
                }}
                onClick={(e) => {
                  if (e.currentTarget.dataset.dragged === "yes") {
                    delete e.currentTarget.dataset.dragged;
                    return;
                  }
                  add(c.kind);
                }}
                style={
                  {
                    "--node-color": c.color,
                    touchAction: "none",
                  } as React.CSSProperties
                }
              >
                <span>
                  <c.icon size={17} />
                </span>
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.note}</small>
                </div>
                <Plus size={12} />
              </button>
            ))}
          </div>
          <div className="palette-foot">
            <ShieldCheck size={15} />
            <span>
              Versioned definitions.
              <br />
              Durable execution.
            </span>
          </div>
        </aside>
        <div className="graph-canvas" ref={canvas} data-lenis-prevent>
          <div className="canvas-toolbar">
            <div>
              <span className="live-dot" /> CANVAS{" "}
              <span className="muted">/ {nodes.length} nodes</span>
            </div>
            <div>
              <button
                title="Undo"
                disabled={!history.length}
                onClick={() => {
                  const old = history.at(-1)!;
                  setFuture((f) => [snapshot(), ...f]);
                  setHistory((h) => h.slice(0, -1));
                  restore(old);
                }}
              >
                <Undo2 size={15} />
              </button>
              <button
                title="Redo"
                disabled={!future.length}
                onClick={() => {
                  setHistory((h) => [...h, snapshot()]);
                  restore(future[0]);
                  setFuture((f) => f.slice(1));
                }}
              >
                <Redo2 size={15} />
              </button>
              <button
                title="Workflow settings"
                onClick={() => {
                  setSelected(null);
                  setDrawer(true);
                }}
              >
                <GitBranch size={15} />
              </button>
              <button title="Auto arrange" onClick={autoLayout}>
                <LayoutGrid size={15} />
              </button>
              <button
                title="Export graph"
                onClick={() => {
                  const a = document.createElement("a"),
                    url = URL.createObjectURL(
                      new Blob(
                        [JSON.stringify({ name, graph: snapshot() }, null, 2)],
                        { type: "application/json" },
                      ),
                    );
                  a.href = url;
                  a.download = "workflow.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={15} />
              </button>
              <button
                title="Import graph"
                onClick={() => upload.current?.click()}
              >
                <Upload size={15} />
              </button>
            </div>
          </div>
          <input
            hidden
            ref={upload}
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              try {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 65536)
                  throw new Error("Graph file exceeds 64 KB.");
                const value = JSON.parse(await file.text());
                const g = validateGraph(value.graph || value);
                remember();
                restore(g);
                if (value.name) setName(String(value.name).slice(0, 80));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                if (upload.current) upload.current.value = "";
              }
            }}
          />
          <ReactFlow
            nodes={displayNodes}
            edges={edges.map((e) => ({
              ...e,
              animated:
                runState === "running" && runNodes[e.source] === "success",
            }))}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              if (changes.some((c) => c.type === "remove")) remember();
              onNodesChange(changes);
            }}
            onEdgesChange={(changes) => {
              if (changes.some((c) => c.type === "remove")) remember();
              onEdgesChange(changes);
            }}
            onConnect={connect}
            onNodeDragStart={remember}
            onNodeClick={(_, n) => {
              setSelected(n.id);
              setDrawer(true);
            }}
            onPaneClick={() => {
              setSelected(null);
              setDrawer(false);
            }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.25}
            maxZoom={1.5}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode="dark"
            connectionRadius={28}
            defaultEdgeOptions={{ type: "smoothstep" }}
            aria-label="Workflow canvas"
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1}
              color="#293345"
            />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(n) => info(String(n.data.kind)).color}
              maskColor="rgba(8,12,19,.8)"
              pannable
              zoomable
            />
          </ReactFlow>
          <div className="canvas-hint">
            <Move size={13} />
            Drag to arrange · connect handles · select a step to configure
          </div>
        </div>
        <aside
          className={`node-settings ${drawer ? "drawer-open" : ""}`}
          data-lenis-prevent
        >
          <div className="settings-title">
            <span className="micro-label">
              {node ? "STEP CONFIGURATION" : "WORKFLOW SETTINGS"}
            </span>
            <button
              aria-label="Close step configuration"
              onClick={() => {
                setSelected(null);
                setDrawer(false);
              }}
            >
              <X size={14} />
            </button>
          </div>
          {node ? (
            <>
              <div
                className="settings-node-icon"
                style={{ color: info(node.data.kind).color }}
              >
                {(() => {
                  const Icon = info(node.data.kind).icon;
                  return <Icon size={24} />;
                })()}
              </div>
              <h3>{info(node.data.kind).name}</h3>
              <code className="node-id">{node.id.slice(0, 16)}</code>
              <label>
                Step name
                <input
                  aria-label="Step name"
                  maxLength={60}
                  value={node.data.label}
                  onChange={(e) => {
                    remember();
                    setNodes((ns) =>
                      ns.map((n) =>
                        n.id === selected
                          ? { ...n, data: { ...n.data, label: e.target.value } }
                          : n,
                      ),
                    );
                  }}
                />
              </label>
              {["transform", "condition", "ai"].includes(node.data.kind) && (
                <label>
                  {node.data.kind === "ai" ? "Output field" : "Field"}
                  <input
                    aria-label="Field"
                    value={node.data.config.field || ""}
                    onChange={(e) => updateConfig("field", e.target.value)}
                  />
                </label>
              )}
              {node.data.kind === "transform" && (
                <label>
                  Operation
                  <select
                    aria-label="Operation"
                    value={node.data.config.operation}
                    onChange={(e) => updateConfig("operation", e.target.value)}
                  >
                    {[
                      "set",
                      "trim",
                      "uppercase",
                      "lowercase",
                      "multiply",
                      "template",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
              )}
              {node.data.kind === "condition" && (
                <label>
                  Operator
                  <select
                    aria-label="Operator"
                    value={node.data.config.operator}
                    onChange={(e) => updateConfig("operator", e.target.value)}
                  >
                    {[
                      ["gte", "Greater than or equal"],
                      ["gt", "Greater than"],
                      ["lte", "Less than or equal"],
                      ["lt", "Less than"],
                      ["eq", "Equals"],
                      ["contains", "Contains"],
                    ].map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(["condition"].includes(node.data.kind) ||
                (node.data.kind === "transform" &&
                  ["set", "multiply", "template"].includes(
                    node.data.config.operation || "",
                  ))) && (
                <label>
                  Value
                  <input
                    aria-label="Value"
                    value={node.data.config.value || ""}
                    onChange={(e) => updateConfig("value", e.target.value)}
                  />
                </label>
              )}
              {node.data.kind === "slack" && (
                <>
                  <label>
                    Channel
                    <input
                      aria-label="Channel"
                      value={node.data.config.channel}
                      onChange={(e) => updateConfig("channel", e.target.value)}
                    />
                  </label>
                  <label>
                    Message template
                    <textarea
                      aria-label="Message template"
                      rows={5}
                      value={node.data.config.message}
                      onChange={(e) => updateConfig("message", e.target.value)}
                    />
                  </label>
                  <p className="field-help">
                    Use {"{{company}}"}, {"{{value}}"} or any field created
                    upstream.
                  </p>
                </>
              )}
              {node.data.kind === "delay" && (
                <label>
                  Milliseconds
                  <input
                    aria-label="Milliseconds"
                    type="number"
                    min={0}
                    max={1000}
                    value={node.data.config.ms}
                    onChange={(e) => updateConfig("ms", Number(e.target.value))}
                  />
                </label>
              )}
              {node.data.kind === "approval" && (
                <label>
                  Review request
                  <textarea
                    aria-label="Review request"
                    rows={4}
                    value={node.data.config.prompt}
                    onChange={(e) => updateConfig("prompt", e.target.value)}
                  />
                </label>
              )}
              {node.data.kind === "ai" && (
                <>
                  <label>
                    Instruction
                    <textarea
                      aria-label="Instruction"
                      rows={3}
                      value={node.data.config.instruction}
                      onChange={(e) =>
                        updateConfig("instruction", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    Categories, comma separated
                    <input
                      aria-label="Categories"
                      value={node.data.config.labels?.join(",")}
                      onChange={(e) =>
                        updateConfig(
                          "labels",
                          e.target.value.split(",").map((x) => x.trim()),
                        )
                      }
                    />
                  </label>
                  <p className="field-help">
                    Sandbox returns the first category using a test adapter.
                    Live mode uses the configured OpenAI model.
                  </p>
                </>
              )}
              {["hubspot", "gmail"].includes(node.data.kind) && (
                <p className="field-help">
                  Reads the first 100 records from your connected account and
                  adds a count to this event. Sandbox uses the test adapter.
                </p>
              )}
              {node.data.kind === "trigger" && (
                <p className="field-help">
                  Accepts authenticated console runs or signed webhooks. Event
                  fields: company, value and region.
                </p>
              )}
              <div className="connection-editor">
                <span className="micro-label">OUTGOING CONNECTIONS</span>
                {edges
                  .filter((e) => e.source === node.id)
                  .map((e) => (
                    <div className="connection-item" key={e.id}>
                      <span>
                        {e.sourceHandle ? e.sourceHandle + " → " : ""}
                        {nodes.find((n) => n.id === e.target)?.data.label}
                      </span>
                      <button
                        aria-label={
                          "Remove connection to " +
                          nodes.find((n) => n.id === e.target)?.data.label
                        }
                        onClick={() => {
                          remember();
                          setEdges((es) => es.filter((x) => x.id !== e.id));
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                {node.data.kind === "condition" && (
                  <label>
                    Output
                    <select
                      aria-label="Connection output"
                      value={connectPort}
                      onChange={(e) => setConnectPort(e.target.value)}
                    >
                      <option value="true">True</option>
                      <option value="false">False</option>
                    </select>
                  </label>
                )}
                <label>
                  Connect to
                  <select
                    aria-label="Connect to step"
                    value={connectTarget}
                    onChange={(e) => setConnectTarget(e.target.value)}
                  >
                    <option value="">Choose a step</option>
                    {nodes
                      .filter(
                        (n) => n.id !== node.id && n.data.kind !== "trigger",
                      )
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.data.label}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  className="secondary"
                  disabled={!connectTarget}
                  onClick={() => {
                    connect({
                      source: node.id,
                      target: connectTarget,
                      sourceHandle:
                        node.data.kind === "condition" ? connectPort : null,
                      targetHandle: null,
                    });
                    setConnectTarget("");
                  }}
                >
                  <Plus size={12} />
                  Connect steps
                </button>
              </div>
              <div className="node-footer">
                <span>
                  {
                    edges.filter(
                      (e) => e.source === node.id || e.target === node.id,
                    ).length
                  }{" "}
                  connections
                </span>
                <button className="danger-text" onClick={remove}>
                  <Trash2 size={14} />
                  Delete step
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>
                Your workflow,
                <br />
                <span className="muted">in motion.</span>
              </h3>
              <label>
                Workflow name
                <input
                  aria-label="Workflow name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => {
                    setDirty(true);
                    setName(e.target.value);
                  }}
                />
              </label>
              <label>
                Execution mode
                <select
                  aria-label="Execution mode"
                  value={mode}
                  onChange={(e) => {
                    setDirty(true);
                    setMode(e.target.value);
                  }}
                >
                  <option value="sandbox">Sandbox · test adapters</option>
                  {!demo && <option value="live">Live · connected accounts</option>}
                </select>
              </label>
              <label>
                Maximum attempts
                <select
                  aria-label="Maximum attempts"
                  value={attempts}
                  onChange={(e) => {
                    setDirty(true);
                    setAttempts(Number(e.target.value));
                  }}
                >
                  {[1, 2, 3].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="settings-callout">
                <GitBranch size={19} />
                <p>
                  Every published version is immutable for queued runs. Changes
                  apply to new executions.
                </p>
              </div>
              {dirty && (
                <button
                  className="secondary"
                  onClick={() => {
                    restore(graph);
                    setName(flow.name);
                    setMode(flow.config.mode);
                    setAttempts(flow.config.maxAttempts);
                    setDirty(false);
                    loaded.current = { id: flow.id, version: flow.version };
                    setBaseVersion(flow.version);
                    setHistory([]);
                    setFuture([]);
                  }}
                >
                  Discard changes
                </button>
              )}
            </>
          )}
        </aside>
      </div>
      <div className="studio-runbar">
        <div>
          <span className="micro-label">
            {mode === "live" ? "LIVE · CONNECTED ACTIONS" : "TEST YOUR FLOW"}
          </span>
          <strong>
            {runId
              ? runState.replaceAll("_", " ")
              : "From canvas to execution."}
          </strong>
        </div>
        <label>
          Company
          <input
            aria-label="Test company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
        <label>
          Value
          <input
            aria-label="Test value"
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
          />
        </label>
        <label>
          Scenario
          <select
            aria-label="Test scenario"
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
          >
            <option value="success">Successful delivery</option>
            <option value="transient">One transient failure</option>
            <option value="failure">Persistent failure</option>
          </select>
        </label>
        <button
          className="primary"
          disabled={busy || dirty}
          title={
            dirty ? "Publish changes before running" : "Execute published graph"
          }
          onClick={() => void run()}
        >
          <Play size={14} />
          {mode === "live" ? "Run live" : "Test run"}
        </button>
        {runId && (
          <button className="text-btn" onClick={() => onInspect(runId)}>
            Inspect trace
            <ArrowUpRight size={15} />
          </button>
        )}
      </div>
    </section>
  );
}
