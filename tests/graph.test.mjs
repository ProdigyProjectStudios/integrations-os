import test from "node:test";
import assert from "node:assert/strict";
import { database } from "./database.mjs";
import {
  workspaceFor,
  one,
  all,
  execute,
  defaultConfig,
} from "../core/store.mjs";
import { referenceGraph, validateGraph } from "../core/graph-definition.mjs";
import { enqueue, processExecution } from "../core/engine.mjs";
import { handleApi } from "../core/api.mjs";
const payload = { company: "Meridian", value: 4800, region: "UK" };
const instant = { sleep: async () => {} };
function node(id, kind, config = {}, x = 0) {
  return { id, kind, label: id, position: { x, y: 0 }, config };
}
function edge(source, target, handle) {
  return {
    id: source + "-" + target,
    source,
    target,
    ...(handle ? { sourceHandle: handle } : {}),
  };
}
async function setup(graph = referenceGraph()) {
  const db = database(),
    ws = await workspaceFor(db, "graph-owner");
  await execute(
    db,
    "UPDATE workflows SET config=? WHERE workspace_id=?",
    JSON.stringify({ ...defaultConfig, graph }),
    ws,
  );
  return { db, ws };
}
async function row(db, id) {
  return one(db, "SELECT * FROM executions WHERE id=?", id);
}
async function req(db, path, body, user = "graph-owner", method = "POST") {
  const bg = [];
  const response = await handleApi(
    new Request("https://example.test/api/" + path, {
      method,
      headers: {
        Origin: "https://example.test",
        "Idempotency-Key": crypto.randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { DB: db },
    { userId: user, email: user + "@example.test" },
    (p) => bg.push(p),
  );
  await Promise.allSettled(bg);
  return { status: response.status, data: await response.json() };
}
test("saved graph determines branching and transformed delivery input, with skipped branch spans", async () => {
  const graph = referenceGraph();
  graph.nodes[1].config.operation = "uppercase";
  const { db, ws } = await setup(graph),
    run = await enqueue(db, ws, "graph-owner", payload, "graph-path-test");
  await processExecution(db, {}, run, instant);
  assert.equal((await row(db, run.id)).status, "success");
  const steps = await all(
    db,
    "SELECT * FROM node_results WHERE execution_id=?",
    run.id,
  );
  assert.equal(steps.find((n) => n.node_id === "review").status, "skipped");
  assert.equal(
    JSON.parse(steps.find((n) => n.node_id === "notify").output).company,
    "MERIDIAN",
  );
  const spans = await all(
    db,
    "SELECT * FROM spans WHERE execution_id=?",
    run.id,
  );
  assert.equal(spans.length, 6);
  assert.ok(spans.every((s) => s.ended_at >= s.started_at));
  assert.ok(spans.some((s) => JSON.parse(s.input).node_id === "normalize"));
  db.close();
});
test("false condition follows its own route and never delivers to Slack", async () => {
  const { db, ws } = await setup(),
    run = await enqueue(
      db,
      ws,
      "graph-owner",
      { ...payload, value: 10 },
      "graph-false-test",
    );
  await processExecution(db, {}, run, instant);
  const result = await one(
    db,
    "SELECT * FROM node_results WHERE execution_id=? AND node_id='review'",
    run.id,
  );
  assert.equal(JSON.parse(result.output).segment, "nurture");
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 0);
  db.close();
});
test("parallel dependencies execute concurrently and join only after both complete", async () => {
  const graph = {
    nodes: [
      node("start", "trigger"),
      node("a", "delay", { ms: 30 }),
      node("b", "delay", { ms: 30 }),
      node("join", "transform", {
        field: "result",
        operation: "set",
        value: "joined",
      }),
    ],
    edges: [
      edge("start", "a"),
      edge("start", "b"),
      edge("a", "join"),
      edge("b", "join"),
    ],
  };
  const { db, ws } = await setup(graph),
    run = await enqueue(db, ws, "graph-owner", payload, "graph-parallel-test");
  await processExecution(db, {}, run);
  const spans = await all(
    db,
    "SELECT * FROM spans WHERE execution_id=?",
    run.id,
  );
  const a = spans.find((s) => s.name === "a"),
    b = spans.find((s) => s.name === "b"),
    j = spans.find((s) => s.name === "join");
  assert.ok(a.started_at < b.ended_at && b.started_at < a.ended_at);
  assert.ok(j.started_at >= Math.max(a.ended_at, b.ended_at));
  db.close();
});
test("multiple action nodes have independent delivery receipts and durable retry checkpoints", async () => {
  const graph = {
    nodes: [
      node("start", "trigger"),
      node("first", "slack", { channel: "one", message: "First" }),
      node("second", "slack", { channel: "two", message: "Second" }),
    ],
    edges: [edge("start", "first"), edge("first", "second")],
  };
  const { db, ws } = await setup(graph);
  await execute(
    db,
    "UPDATE workflows SET config=? WHERE workspace_id=?",
    JSON.stringify({ ...defaultConfig, mode: "live", graph }),
    ws,
  );
  const run = await enqueue(
    db,
    ws,
    "graph-owner",
    payload,
    "graph-checkpoints",
  );
  let calls = [];
  const notify = async (_db, _env, e, _p, c) => {
    calls.push({ id: e.id, channel: c.channel });
    if (c.channel === "two" && calls.length === 2) {
      const error = new Error("Rate limited");
      error.retryable = true;
      throw error;
    }
    return { confirmed: true, channel: c.channel };
  };
  await processExecution(db, {}, run, { ...instant, notify });
  assert.equal((await row(db, run.id)).status, "retry_wait");
  await execute(db, "UPDATE executions SET next_at=0 WHERE id=?", run.id);
  await processExecution(db, {}, run, { ...instant, notify });
  assert.equal((await row(db, run.id)).status, "success");
  assert.deepEqual(
    calls.map((c) => c.channel),
    ["one", "two", "two"],
  );
  assert.notEqual(calls[0].id, calls[1].id);
  assert.equal(calls[1].id, calls[2].id);
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 2);
  db.close();
});
test("approval pauses durably, rejects cross-tenant decisions, resumes the same trace exactly once", async () => {
  const graph = {
    nodes: [
      node("start", "trigger"),
      node("review", "approval", { prompt: "Approve?" }),
      node("send", "slack", {
        channel: "one",
        message: "Approved {{company}}",
      }),
    ],
    edges: [edge("start", "review"), edge("review", "send")],
  };
  const { db, ws } = await setup(graph),
    run = await enqueue(db, ws, "graph-owner", payload, "graph-approval-test");
  await processExecution(db, {}, run, instant);
  assert.equal((await row(db, run.id)).status, "waiting_approval");
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 0);
  assert.equal(
    (
      await req(
        db,
        "approvals/" + run.id,
        { nodeId: "review", decision: "approved" },
        "intruder",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await req(db, "approvals/" + run.id, {
        nodeId: "review",
        decision: "approved",
      })
    ).status,
    202,
  );
  assert.equal((await row(db, run.id)).status, "success");
  assert.equal((await row(db, run.id)).trace_id, run.trace_id);
  assert.equal(
    (
      await req(db, "approvals/" + run.id, {
        nodeId: "review",
        decision: "approved",
      })
    ).status,
    409,
  );
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 1);
  db.close();
});
test("rejected approval stops downstream actions", async () => {
  const graph = {
    nodes: [
      node("start", "trigger"),
      node("review", "approval", { prompt: "Approve?" }),
      node("send", "slack", { channel: "one", message: "Approved" }),
    ],
    edges: [edge("start", "review"), edge("review", "send")],
  };
  const { db, ws } = await setup(graph),
    run = await enqueue(db, ws, "graph-owner", payload, "graph-rejection");
  await processExecution(db, {}, run, instant);
  await req(db, "approvals/" + run.id, {
    nodeId: "review",
    decision: "rejected",
  });
  assert.equal((await row(db, run.id)).status, "failed");
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 0);
  db.close();
});
test("graph validation rejects cycles, unreachable nodes, invalid handles, duplicate IDs and unsafe fields", () => {
  for (const change of [
    (g) => g.edges.push(edge("notify", "normalize")),
    (g) => g.nodes.push(node("orphan", "delay", { ms: 1 })),
    (g) => (g.edges[2].sourceHandle = "invalid"),
    (g) => (g.nodes[1].id = "trigger"),
    (g) => (g.nodes[1].config.field = "__proto__"),
  ]) {
    const g = referenceGraph();
    change(g);
    assert.throws(() => validateGraph(g));
  }
});
test("published graphs are snapshotted and multiple workflows remain tenant scoped", async () => {
  const { db, ws } = await setup(),
    run = await enqueue(db, ws, "graph-owner", payload, "graph-version-test");
  const config = { ...defaultConfig, graph: referenceGraph() };
  config.graph.nodes[2].config.value = "999999";
  assert.equal(
    (
      await req(
        db,
        "workflows",
        { version: 1, config, name: "Updated flow" },
        "graph-owner",
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await req(db, "workflows", { version: 1, config }, "graph-owner", "PUT"))
      .status,
    409,
  );
  await processExecution(db, {}, run, instant);
  assert.equal((await all(db, "SELECT * FROM deliveries")).length, 1);
  const created = await req(db, "workflows", { name: "Another graph" });
  assert.equal(created.status, 201);
  await assert.rejects(
    enqueue(
      db,
      await workspaceFor(db, "intruder"),
      "intruder",
      payload,
      "cross-tenant-graph",
      { workflowId: created.data.id },
    ),
    /not found/,
  );
  const other = await enqueue(
    db,
    ws,
    "graph-owner",
    payload,
    "second-flow-run",
    { workflowId: created.data.id },
  );
  assert.equal(other.workflow_id, created.data.id);
  db.close();
});
test("AI sandbox output is explicitly labelled and live configuration requires credentials", async () => {
  const graph = {
    nodes: [
      node("start", "trigger"),
      node("classify", "ai", {
        field: "category",
        instruction: "Classify enquiry",
        labels: ["hot", "cold"],
      }),
    ],
    edges: [edge("start", "classify")],
  };
  const { db, ws } = await setup(graph),
    run = await enqueue(db, ws, "graph-owner", payload, "graph-ai-test");
  await processExecution(db, {}, run, instant);
  const result = await one(
    db,
    "SELECT output FROM node_results WHERE execution_id=? AND node_id='classify'",
    run.id,
  );
  assert.equal(
    JSON.parse(result.output).classification_mode,
    "sandbox-test-adapter",
  );
  assert.equal(
    (
      await req(
        db,
        "workflows",
        { version: 1, config: { ...defaultConfig, mode: "live", graph } },
        "graph-owner",
        "PUT",
      )
    ).status,
    409,
  );
  db.close();
});
