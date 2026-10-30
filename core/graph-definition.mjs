import { AppError } from "./security.mjs";
export const nodeKinds = [
  "trigger",
  "transform",
  "condition",
  "slack",
  "hubspot",
  "gmail",
  "delay",
  "approval",
  "ai",
];
const safeField = (s) =>
  typeof s === "string" &&
  /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(s) &&
  !["constructor", "prototype", "__proto__"].includes(s);
const bounded = (s, max = 1000) =>
  typeof s === "string" && s.length > 0 && s.length <= max;
export function referenceGraph(config = {}) {
  const nodes = [
    {
      id: "trigger",
      kind: "trigger",
      label: "Enquiry received",
      position: { x: 80, y: 170 },
      config: {},
    },
    {
      id: "normalize",
      kind: "transform",
      label: "Normalize company",
      position: { x: 380, y: 170 },
      config: { field: "company", operation: "trim", value: "" },
    },
    {
      id: "qualify",
      kind: "condition",
      label: "Qualify enquiry",
      position: { x: 680, y: 170 },
      config: {
        field: "value",
        operator: "gte",
        value: String(config.minimumValue ?? 1000),
      },
    },
    {
      id: "notify",
      kind: "slack",
      label: "Notify sales",
      position: { x: 1000, y: 80 },
      config: {
        channel: config.channel || "integration-events",
        message:
          config.message || "Qualified enquiry: {{company}} · £{{value}}",
      },
    },
    {
      id: "review",
      kind: "transform",
      label: "Tag nurture lead",
      position: { x: 1000, y: 330 },
      config: { field: "segment", operation: "set", value: "nurture" },
    },
  ];
  return {
    nodes,
    edges: [
      { id: "e1", source: "trigger", target: "normalize" },
      { id: "e2", source: "normalize", target: "qualify" },
      { id: "e3", source: "qualify", target: "notify", sourceHandle: "true" },
      { id: "e4", source: "qualify", target: "review", sourceHandle: "false" },
    ],
  };
}
export function validateGraph(graph) {
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    graph.nodes.length < 2 ||
    graph.nodes.length > 24 ||
    graph.edges.length > 48
  )
    throw new AppError(
      "A workflow needs 2–24 nodes and at most 48 connections.",
    );
  const ids = new Set();
  const nodes = graph.nodes.map((n) => {
    if (
      !bounded(n.id, 64) ||
      !/^[\w-]+$/.test(n.id) ||
      ids.has(n.id) ||
      !nodeKinds.includes(n.kind) ||
      !bounded(n.label, 60)
    )
      throw new AppError("Each node needs a unique ID, valid type and label.");
    ids.add(n.id);
    const c = n.config || {};
    if (
      n.kind === "transform" &&
      (!safeField(c.field) ||
        ![
          "set",
          "trim",
          "uppercase",
          "lowercase",
          "multiply",
          "template",
        ].includes(c.operation) ||
        typeof c.value !== "string" ||
        c.value.length > 1000 ||
        (c.operation === "multiply" &&
          (!Number.isFinite(Number(c.value)) ||
            Math.abs(Number(c.value)) > 1000000)))
    )
      throw new AppError("Invalid transform configuration.");
    if (
      n.kind === "condition" &&
      (!safeField(c.field) ||
        !["gte", "gt", "lte", "lt", "eq", "contains"].includes(c.operator) ||
        typeof c.value !== "string" ||
        c.value.length > 200 ||
        (["gte", "gt", "lte", "lt"].includes(c.operator) &&
          !Number.isFinite(Number(c.value))))
    )
      throw new AppError("Invalid condition configuration.");
    if (n.kind === "slack" && (!bounded(c.channel, 80) || !bounded(c.message)))
      throw new AppError(
        "Slack requires a channel and a message (maximum 1,000 characters).",
      );
    if (
      n.kind === "delay" &&
      (!Number.isInteger(c.ms) || c.ms < 0 || c.ms > 1000)
    )
      throw new AppError("Delay must be 0–1,000 milliseconds.");
    if (n.kind === "approval" && !bounded(c.prompt, 500))
      throw new AppError("Add an approval request.");
    if (
      n.kind === "ai" &&
      (!bounded(c.instruction, 500) ||
        !safeField(c.field) ||
        !Array.isArray(c.labels) ||
        c.labels.length < 2 ||
        c.labels.length > 6 ||
        c.labels.some((x) => !bounded(x, 40)))
    )
      throw new AppError(
        "AI classification needs an instruction, output field and 2–6 labels.",
      );
    const position = { x: Number(n.position?.x), y: Number(n.position?.y) };
    if (
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      Math.abs(position.x) > 10000 ||
      Math.abs(position.y) > 10000
    )
      throw new AppError("Invalid canvas position.");
    return {
      id: n.id,
      kind: n.kind,
      label: n.label,
      position,
      config: JSON.parse(JSON.stringify(c)),
    };
  });
  if (nodes.filter((n) => n.kind === "trigger").length !== 1)
    throw new AppError("Use exactly one event trigger.");
  const edgeIds = new Set(),
    pairs = new Set();
  const edges = graph.edges.map((e) => {
    const source = nodes.find((n) => n.id === e.source),
      target = nodes.find((n) => n.id === e.target);
    const key = `${e.source}:${e.target}:${e.sourceHandle || ""}`;
    if (
      !bounded(e.id, 100) ||
      edgeIds.has(e.id) ||
      pairs.has(key) ||
      !source ||
      !target ||
      source.id === target.id ||
      target.kind === "trigger"
    )
      throw new AppError("Remove invalid or duplicate connections.");
    if (
      source.kind === "condition"
        ? !["true", "false"].includes(e.sourceHandle)
        : Boolean(e.sourceHandle && e.sourceHandle !== "out")
    )
      throw new AppError(
        "Connect conditions through their true or false output.",
      );
    edgeIds.add(e.id);
    pairs.add(key);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      ...(source.kind === "condition" ? { sourceHandle: e.sourceHandle } : {}),
    };
  });
  const ordered = [],
    remaining = new Set(ids);
  while (remaining.size) {
    const ready = nodes.filter(
      (n) =>
        remaining.has(n.id) &&
        edges
          .filter((e) => e.target === n.id)
          .every((e) => !remaining.has(e.source)),
    );
    if (!ready.length)
      throw new AppError(
        "Cycles are not supported. Every path must move forward.",
      );
    for (const n of ready) {
      ordered.push(n);
      remaining.delete(n.id);
    }
  }
  const reachable = new Set([nodes.find((n) => n.kind === "trigger").id]);
  for (const n of ordered)
    if (edges.some((e) => e.target === n.id && reachable.has(e.source)))
      reachable.add(n.id);
  if (reachable.size !== nodes.length)
    throw new AppError("Connect every node to the trigger before publishing.");
  return { nodes, edges };
}
export const renderTemplate = (text, input) =>
  text.replace(/\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g, (_, key) =>
    String(input[key] ?? ""),
  );
export function transform(input, c) {
  const value = input[c.field];
  let result;
  switch (c.operation) {
    case "trim":
      result = String(value ?? "").trim();
      break;
    case "uppercase":
      result = String(value ?? "").toUpperCase();
      break;
    case "lowercase":
      result = String(value ?? "").toLowerCase();
      break;
    case "multiply":
      result = Number(value) * Number(c.value);
      if (!Number.isFinite(result))
        throw new AppError("Transform requires a numeric input.");
      break;
    case "template":
      result = renderTemplate(c.value, input);
      break;
    default:
      result = c.value;
  }
  return { ...input, [c.field]: result };
}
export function matches(input, c) {
  const value = input[c.field];
  switch (c.operator) {
    case "gte":
      return Number(value) >= Number(c.value);
    case "gt":
      return Number(value) > Number(c.value);
    case "lte":
      return Number(value) <= Number(c.value);
    case "lt":
      return Number(value) < Number(c.value);
    case "eq":
      return String(value) === c.value;
    case "contains":
      return String(value ?? "").includes(c.value);
    default:
      return false;
  }
}
