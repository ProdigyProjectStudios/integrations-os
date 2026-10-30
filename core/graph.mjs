import { AppError, hash, id } from "./security.mjs";
import { all, one, execute, auditLog } from "./store.mjs";
import { notifySlack, synchronize } from "./adapters.mjs";

import {
  validateGraph,
  renderTemplate,
  transform,
  matches,
} from "./graph-definition.mjs";
export { referenceGraph, validateGraph } from "./graph-definition.mjs";
async function deliver(db, env, e, node, input, options) {
  const key = e.id + ":" + node.id;
  const previous = await one(db, "SELECT * FROM deliveries WHERE id=?", key);
  if (previous?.status === "delivered")
    return { ...input, delivery: JSON.parse(previous.receipt), reused: true };
  if (["sending", "uncertain"].includes(previous?.status))
    throw new AppError(
      "Delivery outcome is uncertain. Investigate the provider before continuing.",
      409,
    );
  if (e.mode === "sandbox") {
    await options.sleep(260);
    if (
      e.scenario === "failure" ||
      (e.scenario === "transient" && options.nodeAttempt === 1)
    )
      throw new AppError(
        "Sandbox fault injection: destination returned HTTP 429.",
        429,
        true,
      );
  }
  await execute(
    db,
    "INSERT INTO deliveries(id,execution_id,status,updated_at) VALUES(?,?,'sending',?) ON CONFLICT(id) DO UPDATE SET status='sending',updated_at=excluded.updated_at",
    key,
    e.id,
    Date.now(),
  );
  let receipt;
  try {
    const digest = await hash(key),
      deliveryId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    receipt =
      e.mode === "sandbox"
        ? {
            mode: "sandbox",
            provider: "test-adapter",
            receipt: id(),
            delivered: true,
          }
        : await (options.notify || notifySlack)(
            db,
            env,
            { ...e, id: deliveryId },
            input,
            {
              channel: node.config.channel,
              message: renderTemplate(node.config.message, input),
            },
          );
  } catch (error) {
    await execute(
      db,
      "UPDATE deliveries SET status=?,updated_at=? WHERE id=?",
      error.retryable ? "retryable" : "uncertain",
      Date.now(),
      key,
    );
    throw error;
  }
  await execute(
    db,
    "UPDATE deliveries SET status='delivered',receipt=?,updated_at=? WHERE id=?",
    JSON.stringify(receipt),
    Date.now(),
    key,
  );
  return { ...input, delivery: receipt };
}
async function classify(env, e, node, input) {
  if (e.mode === "sandbox")
    return {
      ...input,
      [node.config.field]: node.config.labels[0],
      classification_mode: "sandbox-test-adapter",
    };
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL)
    throw new AppError(
      "Configure OPENAI_API_KEY and OPENAI_MODEL to run live AI classification.",
      409,
    );
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      store: false,
      instructions: node.config.instruction,
      input: JSON.stringify(input),
      max_output_tokens: 300,
      text: {
        format: {
          type: "json_schema",
          name: "classification",
          strict: true,
          schema: {
            type: "object",
            properties: { label: { type: "string", enum: node.config.labels } },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
    }),
  });
  if (!response.ok)
    throw new AppError(
      `AI provider rejected request (${response.status}).`,
      502,
      response.status === 429,
    );
  const body = await response.json();
  const text = body.output
    ?.flatMap((x) => x.content || [])
    .find((x) => x.type === "output_text")?.text;
  let label;
  try {
    label = JSON.parse(text).label;
  } catch {
    throw new AppError("AI output failed schema validation.", 502);
  }
  if (!node.config.labels.includes(label))
    throw new AppError("AI output returned an invalid category.", 502);
  return { ...input, [node.config.field]: label, classification_mode: "live" };
}

// The saved graph is the executable definition. Node checkpoints survive retries,
// approval pauses and worker restarts; completed side effects are never rerun.
export async function executeGraph(db, env, e, graph, payload, step, options) {
  validateGraph(graph);
  const records = await all(
    db,
    "SELECT * FROM node_results WHERE execution_id=?",
    e.id,
  );
  const states = new Map(
    records.map((r) => [
      r.node_id,
      { ...r, output: r.output ? JSON.parse(r.output) : null },
    ]),
  );
  const pending = new Set(graph.nodes.map((n) => n.id));
  const deadline = Date.now() + 9000;
  let waiting = false,
    filtered = false;
  while (pending.size) {
    const ready = graph.nodes.filter(
      (n) =>
        pending.has(n.id) &&
        graph.edges
          .filter((x) => x.target === n.id)
          .every((x) => !pending.has(x.source)),
    );
    if (!ready.length) break;
    const results = await Promise.allSettled(
      ready.slice(0, 4).map(async (node) => {
        const incoming = graph.edges
          .filter((x) => x.target === node.id)
          .sort((a, b) => a.source.localeCompare(b.source));
        // A join waits for all dependencies, and proceeds if at least one branch is active.
        if (
          incoming.some((x) =>
            ["waiting", "blocked"].includes(states.get(x.source)?.status),
          )
        ) {
          states.set(node.id, { status: "blocked" });
          pending.delete(node.id);
          return;
        }
        const active = incoming.filter(
          (x) =>
            states.get(x.source)?.status === "success" &&
            (!x.sourceHandle ||
              states.get(x.source)?.output?.$branch === x.sourceHandle),
        );
        const input = Object.assign(
          {},
          payload,
          ...active.map((x) => states.get(x.source)?.output),
        );
        delete input.$branch;
        const existing = states.get(node.id);
        if (existing?.status === "rejected")
          throw new AppError("Human reviewer rejected this workflow.", 409);
        if (existing?.status === "success") {
          await step(
            node.label,
            node.kind,
            {
              node_id: node.id,
              dependencies: incoming.map((x) => x.source),
              checkpoint: true,
            },
            async () => ({ ...existing.output, reused: true }),
          );
          pending.delete(node.id);
          return;
        }
        if (node.kind !== "trigger" && !active.length) {
          filtered = true;
          states.set(node.id, { status: "skipped" });
          pending.delete(node.id);
          await execute(
            db,
            "INSERT INTO node_results(execution_id,node_id,status,updated_at) VALUES(?,?,'skipped',?) ON CONFLICT(execution_id,node_id) DO UPDATE SET status='skipped'",
            e.id,
            node.id,
            Date.now(),
          );
          await step(
            node.label,
            node.kind,
            { node_id: node.id, skipped: true },
            async () => ({
              skipped: true,
              reason: "Upstream condition chose another branch.",
            }),
          );
          return;
        }
        const attempt = (existing?.attempts || 0) + 1;
        if (node.kind === "approval" && existing?.status !== "approved") {
          await execute(
            db,
            "INSERT INTO node_results(execution_id,node_id,status,output,updated_at) VALUES(?,?,'waiting',?,?) ON CONFLICT(execution_id,node_id) DO NOTHING",
            e.id,
            node.id,
            JSON.stringify(input),
            Date.now(),
          );
          await step(
            node.label,
            "approval",
            { node_id: node.id, ...input },
            async () => ({
              waiting_for_review: true,
              prompt: node.config.prompt,
            }),
          );
          states.set(node.id, { status: "waiting" });
          waiting = true;
          pending.delete(node.id);
          return;
        }
        await execute(
          db,
          "INSERT INTO node_results(execution_id,node_id,status,attempts,updated_at) VALUES(?,?,'running',?,?) ON CONFLICT(execution_id,node_id) DO UPDATE SET status='running',attempts=excluded.attempts,updated_at=excluded.updated_at",
          e.id,
          node.id,
          attempt,
          Date.now(),
        );
        try {
          const output = await step(
            node.label,
            node.kind,
            {
              node_id: node.id,
              kind: node.kind,
              dependencies: incoming.map((x) => x.source),
              data: input,
            },
            async () => {
              if (e.mode === "sandbox") await options.sleep(70);
              switch (node.kind) {
                case "trigger":
                  return input;
                case "transform":
                  return transform(input, node.config);
                case "condition":
                  return {
                    ...input,
                    $branch: matches(input, node.config) ? "true" : "false",
                  };
                case "delay":
                  await options.sleep(node.config.ms);
                  return input;
                case "approval":
                  return { ...input, approved: true };
                case "slack":
                  return deliver(db, env, e, node, input, {
                    ...options,
                    nodeAttempt: attempt,
                  });
                case "ai":
                  return classify(env, e, node, input);
                case "hubspot":
                case "gmail":
                  return {
                    ...input,
                    [node.kind]:
                      e.mode === "sandbox"
                        ? { mode: "sandbox", count: 0 }
                        : await (options.synchronize || synchronize)(
                            db,
                            env,
                            e.workspace_id,
                            node.kind,
                          ),
                  };
              }
            },
          );
          if (JSON.stringify(output).length > 32000)
            throw new AppError("Node output exceeds 32 KB.");
          await execute(
            db,
            "UPDATE node_results SET status='success',output=?,updated_at=? WHERE execution_id=? AND node_id=?",
            JSON.stringify(output),
            Date.now(),
            e.id,
            node.id,
          );
          states.set(node.id, { status: "success", output, attempts: attempt });
          pending.delete(node.id);
        } catch (error) {
          await execute(
            db,
            "UPDATE node_results SET status='error',updated_at=? WHERE execution_id=? AND node_id=?",
            Date.now(),
            e.id,
            node.id,
          );
          error.nodeAttempt = attempt;
          throw error;
        }
      }),
    );
    for (const r of results) if (r.status === "rejected") throw r.reason;
    if (Date.now() > deadline && pending.size && !waiting) return "queued";
  }
  if (waiting) return "waiting_approval";
  await auditLog(
    db,
    e.workspace_id,
    "worker",
    "execution.completed",
    { graph: true, nodes: graph.nodes.length },
    e.id,
  );
  const leaves = graph.nodes.filter(
    (n) => !graph.edges.some((edge) => edge.source === n.id),
  );
  return filtered && leaves.every((n) => states.get(n.id)?.status === "skipped")
    ? "skipped"
    : "success";
}
