// Scans .github/workflows and turns each workflow file into a structured model
// the canvas can render: triggers, engine, tools, steps, sub-agents, safe
// outputs, and the inferred edges between workflows.
//
// GitHub Agentic Workflows (gh-aw) are authored as markdown files with YAML
// frontmatter and compiled to a sibling `<name>.lock.yml`. Plain Actions
// workflows are read too, so the pipeline view can show how they connect
// (e.g. CI -> CI Doctor).

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------- YAML subset

function tokenize(text) {
    const tokens = [];
    for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim()) continue;
        if (/^\s*#/.test(raw)) continue;
        tokens.push({ indent: raw.match(/^ */)[0].length, text: raw.replace(/\s+$/, "").trim() });
    }
    return tokens;
}

function splitFlow(inner) {
    const parts = [];
    let depth = 0;
    let quote = null;
    let current = "";
    for (const ch of inner) {
        if (quote) {
            current += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === "[" || ch === "{") depth++;
        if (ch === "]" || ch === "}") depth--;
        if (ch === "," && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts.map((p) => p.trim());
}

function stripTrailingComment(value) {
    const first = value[0];
    if (first === '"' || first === "'") return value;
    const idx = value.indexOf(" #");
    return idx >= 0 ? value.slice(0, idx).trim() : value;
}

function parseScalar(value) {
    let v = stripTrailingComment(String(value).trim()).trim();
    if (v === "") return null;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        return v.slice(1, -1);
    }
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null" || v === "~") return null;
    if (/^-?\d+$/.test(v)) return Number(v);
    if (v.startsWith("[") && v.endsWith("]")) {
        const inner = v.slice(1, -1).trim();
        return inner ? splitFlow(inner).map((item) => parseScalar(item)) : [];
    }
    return v;
}

const INLINE_MAP_KEY = /^[A-Za-z0-9_.\-/]+:(\s|$)/;

function parseBlock(tokens, start, indent) {
    let i = start;
    if (i >= tokens.length) return [null, i];

    const isSequence = tokens[i].text === "-" || tokens[i].text.startsWith("- ");
    if (isSequence) {
        const list = [];
        while (i < tokens.length && tokens[i].indent === indent) {
            const token = tokens[i];
            if (token.text !== "-" && !token.text.startsWith("- ")) break;
            const rest = token.text === "-" ? "" : token.text.slice(2).trim();
            if (rest === "") {
                const next = tokens[i + 1];
                if (next && next.indent > indent) {
                    const [value, nextIndex] = parseBlock(tokens, i + 1, next.indent);
                    list.push(value);
                    i = nextIndex;
                } else {
                    list.push(null);
                    i += 1;
                }
            } else if (INLINE_MAP_KEY.test(rest)) {
                // "- uses: actions/checkout@v4" — the item is a mapping whose
                // first key sits at indent + 2. Rewrite the token in place so
                // the mapping parser sees a normal block.
                tokens[i] = { indent: indent + 2, text: rest };
                const [value, nextIndex] = parseBlock(tokens, i, indent + 2);
                list.push(value);
                i = nextIndex;
            } else {
                list.push(parseScalar(rest));
                i += 1;
            }
        }
        return [list, i];
    }

    const map = {};
    while (i < tokens.length && tokens[i].indent === indent) {
        const token = tokens[i];
        if (token.text === "-" || token.text.startsWith("- ")) break;
        const match = token.text.match(/^([^:]+):\s*(.*)$/);
        if (!match) {
            i += 1;
            continue;
        }
        const key = match[1].trim().replace(/^["']|["']$/g, "");
        const rest = match[2].trim();
        if (rest === "") {
            const next = tokens[i + 1];
            if (next && next.indent > indent) {
                const [value, nextIndex] = parseBlock(tokens, i + 1, next.indent);
                map[key] = value;
                i = nextIndex;
            } else {
                map[key] = null;
                i += 1;
            }
        } else if (/^[|>][-+]?$/.test(rest)) {
            const lines = [];
            let j = i + 1;
            while (j < tokens.length && tokens[j].indent > indent) {
                lines.push(tokens[j].text);
                j += 1;
            }
            map[key] = rest[0] === "|" ? lines.join("\n") : lines.join(" ");
            i = j;
        } else {
            map[key] = parseScalar(rest);
            i += 1;
        }
    }
    return [map, i];
}

export function parseYaml(text) {
    const tokens = tokenize(text);
    if (!tokens.length) return {};
    const [value] = parseBlock(tokens, 0, tokens[0].indent);
    return value ?? {};
}

// ------------------------------------------------------------- markdown parts

function splitFrontmatter(text) {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { frontmatter: "", body: text };
    return { frontmatter: match[1], body: match[2] };
}

function extractAgents(body) {
    const agents = [];
    const re = /^##\s+agent:\s*`([^`]+)`\s*$([\s\S]*?)^##\s+end agent:\s*`?[^\n]*$/gm;
    let match;
    while ((match = re.exec(body)) !== null) {
        let content = match[2].trim();
        let meta = {};
        const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
        if (fm) {
            try {
                meta = parseYaml(fm[1]) || {};
            } catch {
                meta = {};
            }
            content = fm[2].trim();
        }
        const firstProse = content.split(/\n\s*\n/)[0] || "";
        agents.push({
            name: match[1],
            model: meta.model ? String(meta.model) : null,
            role: String(meta.description || tidy(firstProse)),
            body: content,
        });
    }
    return agents;
}

function stripAgentBlocks(body) {
    return body.replace(/^##\s+agent:[\s\S]*?^##\s+end agent:[^\n]*$/gm, "");
}

function tidy(line) {
    return line.replace(/\s+/g, " ").trim();
}

const TITLE_LIMIT = 200;

/** Split an ordered-list item into a readable title plus the rest of its body. */
function splitItem(lines) {
    const paragraph = [];
    let index = 0;
    for (; index < lines.length; index += 1) {
        const line = lines[index];
        if (!line.trim()) break;
        if (/^\s*```/.test(line) || /^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) break;
        paragraph.push(line.trim());
    }
    const full = tidy(paragraph.join(" "));
    const rest = lines.slice(index).join("\n").trim();

    if (full.length <= TITLE_LIMIT) {
        return { title: full, detail: rest };
    }
    const window = full.slice(0, TITLE_LIMIT);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("。"), window.lastIndexOf("; "));
    const title = `${full.slice(0, cut > 60 ? cut + 1 : TITLE_LIMIT).trim()}…`;
    return { title, detail: [full, rest].filter(Boolean).join("\n\n") };
}

function parseOrderedList(text) {
    const lines = text.split(/\r?\n/);
    const items = [];
    let fenced = false;
    let current = null;
    for (const line of lines) {
        if (/^\s*```/.test(line)) {
            fenced = !fenced;
            if (current) current.lines.push(line);
            continue;
        }
        if (fenced) {
            if (current) current.lines.push(line);
            continue;
        }
        const start = line.match(/^(\d+)\.\s+(.*)$/);
        if (start) {
            if (current) items.push(current);
            current = { lines: [start[2]] };
            continue;
        }
        if (/^#{1,6}\s/.test(line)) {
            if (current) items.push(current);
            current = null;
            continue;
        }
        if (current) current.lines.push(line);
    }
    if (current) items.push(current);
    return items.map((item) => splitItem(item.lines));
}

function extractSteps(body) {
    const clean = stripAgentBlocks(body);
    const headings = [...clean.matchAll(/^##\s+(.+)$/gm)].filter((m) =>
        /^step\s*\d/i.test(m[1].trim()),
    );

    if (headings.length >= 2) {
        return headings.map((heading, index) => {
            const from = heading.index + heading[0].length;
            const to = index + 1 < headings.length ? headings[index + 1].index : clean.length;
            const section = clean.slice(from, to).trim();
            const title = heading[1].replace(/^Step\s*\d+\s*[—\-–:]\s*/i, "").trim();
            return {
                title: title || heading[1].trim(),
                detail: section,
                substeps: parseOrderedList(section).map((item) => item.title),
            };
        });
    }

    const stepsHeading = clean.match(/^##\s+Steps?\s*$/m);
    const scope = stepsHeading ? clean.slice(stepsHeading.index + stepsHeading[0].length) : clean;
    return parseOrderedList(scope).map((item) => ({
        title: item.title,
        detail: item.detail,
        substeps: [],
    }));
}

// ------------------------------------------------------------------ semantics

function asList(value) {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
}

const TRIGGER_ICONS = {
    issues: "🐛",
    issue_comment: "💬",
    pull_request: "🔀",
    pull_request_target: "🔀",
    pull_request_review_comment: "💬",
    workflow_run: "⚙️",
    workflow_dispatch: "🖲️",
    slash_command: "⌨️",
    command: "⌨️",
    schedule: "⏰",
    push: "⬆️",
    release: "🏷️",
};

function describeTrigger(kind, config) {
    const icon = TRIGGER_ICONS[kind] || "⚡";
    const parts = [];
    let label = kind;
    let types = [];
    let names = [];
    let upstream = [];

    if (config && typeof config === "object" && !Array.isArray(config)) {
        types = asList(config.types).map(String);
        names = asList(config.names).map(String);
        upstream = asList(config.workflows).map(String);
        const branches = asList(config.branches);
        const inputs =
            config.inputs && typeof config.inputs === "object" ? Object.keys(config.inputs) : [];

        if (kind === "slash_command" || kind === "command") {
            label = `/${config.name ?? "command"}`;
            if (asList(config.events).length) parts.push(asList(config.events).join(", "));
        } else if (kind === "workflow_run") {
            label = `${upstream.join(", ") || "workflow"} 运行完成`;
            if (types.length) parts.push(types.join(", "));
        } else {
            if (types.length) parts.push(types.join(", "));
            if (names.length) parts.push(`label: ${names.join(", ")}`);
            if (branches.length) parts.push(`branch: ${branches.join(", ")}`);
            if (inputs.length) parts.push(`inputs: ${inputs.join(", ")}`);
        }
    }

    return { kind, icon, label, detail: parts.join(" · "), types, names, upstream };
}

function describeTriggers(on) {
    if (!on) return [];
    if (typeof on === "string") return [describeTrigger(on, null)];
    if (Array.isArray(on)) return on.map((kind) => describeTrigger(String(kind), null));
    return Object.entries(on).map(([kind, config]) => describeTrigger(kind, config));
}

function describeTools(tools) {
    if (!tools || typeof tools !== "object") return [];
    return Object.entries(tools).map(([name, config]) => {
        if (config == null) return { name, items: [] };
        if (Array.isArray(config)) return { name, items: config.map(String) };
        if (typeof config === "object") {
            return {
                name,
                items: Object.entries(config).map(
                    ([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`,
                ),
            };
        }
        return { name, items: [String(config)] };
    });
}

const SAFE_OUTPUT_ICONS = {
    "create-pull-request": "🔀",
    "create-issue": "📄",
    "add-comment": "💬",
    "add-labels": "🏷️",
    "remove-labels": "🧹",
    "dispatch-workflow": "🚀",
    "push-to-pull-request-branch": "⬆️",
    "update-issue": "✏️",
    "missing-tool": "🧰",
};

function describeSafeOutputs(safeOutputs) {
    if (!safeOutputs || typeof safeOutputs !== "object") return { staged: false, items: [] };
    const staged = safeOutputs.staged === true;
    const items = Object.entries(safeOutputs)
        .filter(([name]) => name !== "staged")
        .map(([name, config]) => {
            const details = [];
            if (config && typeof config === "object" && !Array.isArray(config)) {
                for (const [key, value] of Object.entries(config)) {
                    details.push(`${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
                }
            } else if (Array.isArray(config)) {
                details.push(config.join(", "));
            }
            return { name, icon: SAFE_OUTPUT_ICONS[name] || "📤", details };
        });
    return { staged, items };
}

function slugify(value) {
    return String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------- edge graph

function inferEdges(workflows) {
    const edges = [];
    const byId = new Map(workflows.map((w) => [w.id, w]));
    const byName = new Map(workflows.map((w) => [slugify(w.name), w]));

    const add = (from, to, label, kind) => {
        if (!from || !to || from.id === to.id) return;
        if (edges.some((e) => e.from === from.id && e.to === to.id && e.label === label)) return;
        edges.push({ from: from.id, to: to.id, label, kind });
    };

    for (const wf of workflows) {
        const outputs = new Map(wf.safeOutputs.items.map((item) => [item.name, item]));
        const listOf = (item, key) =>
            item
                ? item.details
                      .filter((d) => d.startsWith(`${key}:`))
                      .flatMap((d) => d.slice(key.length + 1).split(",").map((t) => t.trim()))
                      .filter(Boolean)
                : [];

        for (const target of listOf(outputs.get("dispatch-workflow"), "workflows")) {
            add(wf, byId.get(slugify(target)) || byName.get(slugify(target)), "dispatch", "dispatch");
        }

        const allowedLabels = listOf(outputs.get("add-labels"), "allowed");
        if (allowedLabels.length) {
            for (const other of workflows) {
                for (const trigger of other.triggers) {
                    if (trigger.kind !== "issues" || !trigger.names.length) continue;
                    const hit = trigger.names.filter((label) => allowedLabels.includes(label));
                    if (hit.length) add(wf, other, `label: ${hit.join(", ")}`, "label");
                }
            }
        }

        const opensPr = outputs.has("create-pull-request");
        const pushesPr = outputs.has("push-to-pull-request-branch");
        if (opensPr || pushesPr) {
            const OPEN_TYPES = ["opened", "reopened", "ready_for_review"];
            for (const other of workflows) {
                for (const trigger of other.triggers) {
                    if (trigger.kind !== "pull_request" && trigger.kind !== "pull_request_target") continue;
                    const types = trigger.types.length ? trigger.types : OPEN_TYPES;
                    if (opensPr && types.some((t) => OPEN_TYPES.includes(t))) {
                        add(wf, other, "opens PR", "pr");
                    }
                    if (pushesPr && types.includes("synchronize")) {
                        add(wf, other, "pushes commit", "pr");
                    }
                    if (opensPr && types.includes("closed")) {
                        add(wf, other, "PR merged", "pr");
                    }
                }
            }
        }

        for (const trigger of wf.triggers) {
            if (trigger.kind !== "workflow_run") continue;
            for (const name of trigger.upstream) {
                add(byName.get(slugify(name)) || byId.get(slugify(name)), wf, "run completed", "run");
            }
        }
    }

    return edges;
}

// --------------------------------------------------------------------- public

async function readIfExists(file) {
    try {
        return await readFile(file, "utf8");
    } catch {
        return null;
    }
}

export async function scanWorkflows(repoRoot) {
    const dir = path.join(repoRoot, ".github", "workflows");
    let entries = [];
    try {
        entries = await readdir(dir);
    } catch {
        return { workflows: [], edges: [], dir };
    }

    const workflows = [];

    for (const entry of entries.sort()) {
        const isMarkdown = entry.endsWith(".md");
        const isYaml = /\.ya?ml$/.test(entry) && !entry.endsWith(".lock.yml");
        if (!isMarkdown && !isYaml) continue;

        const file = path.join(dir, entry);
        const text = await readIfExists(file);
        if (text == null) continue;

        const id = entry.replace(/\.(md|ya?ml)$/, "");
        const { frontmatter, body } = isMarkdown
            ? splitFrontmatter(text)
            : { frontmatter: text, body: "" };

        let config = {};
        try {
            config = parseYaml(frontmatter) || {};
        } catch {
            config = {};
        }

        const lockFile = path.join(dir, `${id}.lock.yml`);
        let compiled = null;
        try {
            const info = await stat(lockFile);
            compiled = { file: `.github/workflows/${id}.lock.yml`, size: info.size };
        } catch {
            compiled = null;
        }

        const agentic = isMarkdown && Boolean(config.engine || compiled);
        const steps = isMarkdown ? extractSteps(body) : [];
        const agents = isMarkdown ? extractAgents(body) : [];

        workflows.push({
            id,
            file: `.github/workflows/${entry}`,
            kind: agentic ? "agentic" : "standard",
            name: config.name || id,
            description: config.description || (isYaml ? "标准 GitHub Actions 工作流" : ""),
            engine: config.engine || null,
            strict: config.strict === true,
            condition: typeof config.if === "string" ? config.if : null,
            triggers: describeTriggers(config.on),
            permissions:
                config.permissions && typeof config.permissions === "object"
                    ? Object.entries(config.permissions).map(([k, v]) => `${k}: ${v}`)
                    : [],
            network: config.network ? asList(config.network.allowed).map(String) : [],
            imports: asList(config.imports).map(String),
            tools: describeTools(config.tools),
            safeOutputs: describeSafeOutputs(config["safe-outputs"]),
            jobs:
                !agentic && config.jobs && typeof config.jobs === "object"
                    ? Object.entries(config.jobs).map(([jobId, job]) => ({
                          id: jobId,
                          name: (job && job.name) || jobId,
                          steps: asList(job && job.steps)
                              .map((step) => (step && (step.name || step.uses || step.run)) || "")
                              .filter(Boolean)
                              .map((s) => tidy(String(s)).slice(0, 80)),
                      }))
                    : [],
            steps,
            agents,
            compiled,
            raw: text,
            bodyMarkdown: body.trim(),
        });
    }

    return { workflows, edges: inferEdges(workflows), dir };
}
