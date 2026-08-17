// Extension: agentic-workflows
//
// Canvas that lists every Agentic Workflow in this repository and renders the
// flow of whichever one you click: trigger -> engine/guardrails -> tools ->
// steps -> sub-agents -> safe outputs -> downstream workflows.
//
// Data lives in the repo itself (.github/workflows/*.md), so nothing is
// persisted by this extension: the canvas re-reads the files on open, on
// refresh, and whenever a workflow file changes on disk.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { scanWorkflows } from "./workflows.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(HERE, "client");

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
};

/** Live canvas instances: instanceId -> { server, url }. */
const servers = new Map();
/** Connected SSE listeners across every instance. */
const listeners = new Set();

let repoRoot = null;
let cache = null;
let watcher = null;

async function isRepoRoot(dir) {
    try {
        const info = await stat(path.join(dir, ".github", "workflows"));
        return info.isDirectory();
    } catch {
        return false;
    }
}

async function resolveRepoRoot(workspacePath) {
    const candidates = [];
    if (workspacePath) candidates.push(workspacePath);
    let dir = HERE;
    for (let i = 0; i < 6; i += 1) {
        candidates.push(dir);
        dir = path.dirname(dir);
    }
    candidates.push(process.cwd());
    for (const candidate of candidates) {
        if (await isRepoRoot(candidate)) return candidate;
    }
    return workspacePath || process.cwd();
}

async function getData({ force = false } = {}) {
    if (cache && !force) return cache;
    const result = await scanWorkflows(repoRoot);
    cache = {
        repoRoot,
        scannedAt: new Date().toISOString(),
        agenticCount: result.workflows.filter((w) => w.kind === "agentic").length,
        ...result,
    };
    return cache;
}

function broadcast(payload) {
    const frame = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of listeners) {
        try {
            res.write(frame);
        } catch {
            listeners.delete(res);
        }
    }
}

function startWatching() {
    if (watcher) return;
    const dir = path.join(repoRoot, ".github", "workflows");
    try {
        let timer = null;
        watcher = watch(dir, () => {
            clearTimeout(timer);
            timer = setTimeout(async () => {
                await getData({ force: true });
                broadcast({ type: "changed" });
            }, 300);
        });
        watcher.unref?.();
    } catch {
        watcher = null;
    }
}

async function serveClientFile(res, name) {
    const safe = path.normalize(name).replace(/^(\.\.[/\\])+/, "");
    const file = path.join(CLIENT_DIR, safe);
    if (!file.startsWith(CLIENT_DIR)) {
        res.writeHead(403).end("forbidden");
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(body);
    } catch {
        res.writeHead(404).end("not found");
    }
}

function sendJson(res, payload, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(payload));
}

async function handleRequest(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");

    if (url.pathname === "/" || url.pathname === "/index.html") {
        await serveClientFile(res, "index.html");
        return;
    }
    if (url.pathname === "/app.css" || url.pathname === "/app.js") {
        await serveClientFile(res, url.pathname.slice(1));
        return;
    }
    if (url.pathname === "/api/data") {
        sendJson(res, await getData({ force: url.searchParams.get("refresh") === "1" }));
        return;
    }
    if (url.pathname === "/events") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        res.write("retry: 2000\n\n");
        listeners.add(res);
        req.on("close", () => listeners.delete(res));
        return;
    }
    res.writeHead(404).end("not found");
}

async function startServer() {
    const server = createServer((req, res) => {
        handleRequest(req, res).catch(() => {
            if (!res.headersSent) res.writeHead(500);
            res.end("error");
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

function summarize(workflow) {
    return {
        id: workflow.id,
        name: workflow.name,
        kind: workflow.kind,
        description: workflow.description,
        file: workflow.file,
        triggers: workflow.triggers.map((t) => `${t.label}${t.detail ? ` (${t.detail})` : ""}`),
        steps: workflow.steps.length,
        agents: workflow.agents.map((a) => a.name),
        safeOutputs: workflow.safeOutputs.items.map((o) => o.name),
    };
}

const canvas = createCanvas({
    id: "agentic-workflows",
    displayName: "Agentic Workflows",
    description:
        "Browse every Agentic Workflow in this repository and visualize a selected workflow's flow, tools and safe outputs.",
    inputSchema: {
        type: "object",
        properties: {
            workflowId: {
                type: "string",
                description: "Workflow file id to select on open, e.g. 'bug-fixer'.",
            },
            view: {
                type: "string",
                enum: ["overview", "workflow"],
                description: "Start on the pipeline overview or on a single workflow.",
            },
        },
        additionalProperties: false,
    },
    actions: [
        {
            name: "list_workflows",
            description: "Return the parsed workflows found in .github/workflows.",
            handler: async () => {
                const data = await getData({ force: true });
                return {
                    repoRoot: data.repoRoot,
                    count: data.workflows.length,
                    agentic: data.agenticCount,
                    workflows: data.workflows.map(summarize),
                    edges: data.edges,
                };
            },
        },
        {
            name: "select_workflow",
            description: "Select a workflow in the open canvas and show its flow.",
            inputSchema: {
                type: "object",
                properties: { workflowId: { type: "string" } },
                required: ["workflowId"],
                additionalProperties: false,
            },
            handler: async (ctx) => {
                const data = await getData();
                const workflow = data.workflows.find((w) => w.id === ctx.input?.workflowId);
                if (!workflow) {
                    throw new CanvasError(
                        "workflow_not_found",
                        `No workflow '${ctx.input?.workflowId}' in ${data.dir}`,
                    );
                }
                broadcast({ type: "select", id: workflow.id, instanceId: ctx.instanceId });
                return summarize(workflow);
            },
        },
        {
            name: "refresh",
            description: "Re-scan .github/workflows and reload the canvas.",
            handler: async () => {
                const data = await getData({ force: true });
                broadcast({ type: "changed" });
                return { count: data.workflows.length, agentic: data.agenticCount, scannedAt: data.scannedAt };
            },
        },
    ],
    open: async (ctx) => {
        const data = await getData({ force: true });
        startWatching();

        let entry = servers.get(ctx.instanceId);
        if (!entry) {
            entry = await startServer();
            servers.set(ctx.instanceId, entry);
        }

        const params = new URLSearchParams();
        if (ctx.input?.workflowId) params.set("workflow", ctx.input.workflowId);
        if (ctx.input?.view) params.set("view", ctx.input.view);
        const query = params.toString();

        return {
            title: "Agentic Workflows",
            status: `${data.agenticCount} agentic · ${data.workflows.length} workflows`,
            url: query ? `${entry.url}?${query}` : entry.url,
        };
    },
    onClose: async (ctx) => {
        const entry = servers.get(ctx.instanceId);
        if (!entry) return;
        servers.delete(ctx.instanceId);
        await new Promise((resolve) => entry.server.close(() => resolve()));
    },
});

const session = await joinSession({ canvases: [canvas] });
repoRoot = await resolveRepoRoot(session.workspacePath);
