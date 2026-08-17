// Canvas client: sidebar list of workflows + flow visualization for the
// selected one, plus a pipeline overview graph of how workflows chain.

const listEl = document.getElementById("list");
const mainEl = document.getElementById("main");
const metaEl = document.getElementById("meta");
const searchEl = document.getElementById("search");
const refreshEl = document.getElementById("refresh");

const state = {
    data: null,
    selected: null, // null => pipeline overview
    tab: "flow",
    query: "",
    openSteps: new Set(),
};

const EDGE_COLORS = {
    dispatch: "var(--accent)",
    label: "var(--amber)",
    pr: "var(--green)",
    run: "var(--purple)",
};

// ------------------------------------------------------------------ helpers

function esc(value) {
    return String(value ?? "").replace(
        /[&<>"]/g,
        (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch],
    );
}

function inlineMd(text) {
    let html = esc(text);
    html = html.replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expr) => {
        return '<span class="expr">' + "${{" + expr.trim() + "}}" + "</span>";
    });
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
        try {
            const url = new URL(href.replaceAll("&amp;", "&"), window.location.href);
            if (!["http:", "https:"].includes(url.protocol)) return label;
            return `<a href="${esc(url.href)}" target="_blank" rel="noreferrer">${label}</a>`;
        } catch {
            return label;
        }
    });
    return html;
}

function markdown(source) {
    const lines = String(source ?? "").split("\n");
    const out = [];
    let listType = null;
    let paragraph = [];
    let fence = null;

    const closeParagraph = () => {
        if (paragraph.length) {
            out.push(`<p>${inlineMd(paragraph.join(" "))}</p>`);
            paragraph = [];
        }
    };
    const closeList = () => {
        if (listType) {
            out.push(`</${listType}>`);
            listType = null;
        }
    };

    for (const raw of lines) {
        const line = raw.replace(/\s+$/, "");

        if (/^\s*```/.test(line)) {
            if (fence === null) {
                closeParagraph();
                closeList();
                fence = [];
            } else {
                out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
                fence = null;
            }
            continue;
        }
        if (fence !== null) {
            fence.push(line);
            continue;
        }
        if (!line.trim()) {
            closeParagraph();
            closeList();
            continue;
        }

        const heading = line.match(/^#{1,6}\s+(.*)$/);
        if (heading) {
            closeParagraph();
            closeList();
            out.push(`<p><strong>${inlineMd(heading[1])}</strong></p>`);
            continue;
        }

        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
        if (bullet || ordered) {
            closeParagraph();
            const wanted = bullet ? "ul" : "ol";
            if (listType !== wanted) {
                closeList();
                out.push(`<${wanted}>`);
                listType = wanted;
            }
            out.push(`<li>${inlineMd((bullet || ordered)[1])}</li>`);
            continue;
        }

        if (listType) {
            out.push(`<li>${inlineMd(line.trim())}</li>`);
            continue;
        }
        paragraph.push(line.trim());
    }

    if (fence !== null) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
    closeParagraph();
    closeList();
    return out.join("\n");
}

function chip(text, variant = "") {
    return `<span class="chip ${variant}">${text}</span>`;
}

function triggerText(trigger) {
    return `${trigger.icon} ${esc(trigger.label)}${trigger.detail ? ` · ${esc(trigger.detail)}` : ""}`;
}

function workflowById(id) {
    return state.data?.workflows.find((w) => w.id === id) ?? null;
}

// ------------------------------------------------------------------ sidebar

function matchesQuery(workflow, query) {
    if (!query) return true;
    const haystack = [
        workflow.id,
        workflow.name,
        workflow.description,
        workflow.triggers.map((t) => `${t.label} ${t.detail}`).join(" "),
        workflow.tools.map((t) => t.name).join(" "),
        workflow.safeOutputs.items.map((o) => o.name).join(" "),
        workflow.agents.map((a) => a.name).join(" "),
    ]
        .join(" ")
        .toLowerCase();
    return haystack.includes(query.toLowerCase());
}

function renderSidebar() {
    const data = state.data;
    if (!data) return;

    const visible = data.workflows.filter((w) => matchesQuery(w, state.query));
    const groups = [
        { key: "agentic", label: `Agentic 工作流 · ${visible.filter((w) => w.kind === "agentic").length}` },
        { key: "standard", label: `标准 Actions · ${visible.filter((w) => w.kind === "standard").length}` },
    ];

    const overviewItem = `
        <button class="item ${state.selected === null ? "active" : ""}" data-id="__overview__">
            <span class="item-name">🗺️ 流水线全景</span>
            <span class="item-sub">${data.workflows.length} 个工作流 · ${data.edges.length} 条衔接关系</span>
        </button>`;

    const groupHtml = groups
        .map((group) => {
            const items = visible.filter((w) => w.kind === group.key);
            if (!items.length) return "";
            return `
                <div class="group-label">${group.label}</div>
                ${items
                    .map(
                        (w) => `
                    <button class="item ${w.kind} ${state.selected === w.id ? "active" : ""}" data-id="${w.id}">
                        <span class="item-name"><i class="dot"></i>${esc(w.name)}</span>
                        <span class="item-sub">${w.triggers.map((t) => `${t.icon} ${esc(t.label)}`).join(" · ") || esc(w.file)}</span>
                    </button>`,
                    )
                    .join("")}`;
        })
        .join("");

    listEl.innerHTML = overviewItem + groupHtml;
    metaEl.textContent = `${data.agenticCount} 个 agentic · 共 ${data.workflows.length} 个工作流`;
}

// --------------------------------------------------------------- flow view

function stage(label, nodesHtml, { connector = true, parallel = false } = {}) {
    return `
        <section class="stage">
            <div class="stage-label">${label}</div>
            <div class="nodes">${nodesHtml}</div>
        </section>
        ${connector ? `<div class="stage"><div></div><div class="connector ${parallel ? "parallel" : ""}"></div></div>` : ""}`;
}

function node(title, sub, variant = "", attrs = "") {
    return `
        <div class="node ${variant}" ${attrs}>
            <div class="node-title">${title}</div>
            ${sub ? `<div class="node-sub">${sub}</div>` : ""}
        </div>`;
}

function renderFlow(workflow) {
    const data = state.data;
    const parts = [];

    // 1. triggers
    parts.push(
        stage(
            "触发",
            workflow.triggers.length
                ? workflow.triggers
                      .map((t) => node(`${t.icon} ${esc(t.label)}`, esc(t.detail), "trigger"))
                      .join("")
                : node("无触发器", "", "trigger"),
        ),
    );

    // 2. optional run condition
    if (workflow.condition) {
        parts.push(stage("条件", node("if", `<code>${esc(workflow.condition)}</code>`)));
    }

    // 3. engine / guardrails
    if (workflow.kind === "agentic") {
        const guards = [
            workflow.strict ? chip("strict", "green") : "",
            ...workflow.network.map((n) => chip(`network: ${esc(n)}`)),
            ...workflow.permissions.map((p) => chip(esc(p))),
        ]
            .filter(Boolean)
            .join("");
        parts.push(
            stage(
                "引擎",
                node(
                    `🤖 engine: ${esc(workflow.engine ?? "copilot")}`,
                    `<div class="chips">${guards}</div>` +
                        (workflow.imports.length
                            ? `<div style="margin-top:6px">imports: ${workflow.imports.map((i) => `<code>${esc(i)}</code>`).join(" ")}</div>`
                            : ""),
                    "engine",
                ),
            ),
        );

        if (workflow.tools.length) {
            parts.push(
                stage(
                    "工具",
                    workflow.tools
                        .map((tool) =>
                            node(
                                `🧰 ${esc(tool.name)}`,
                                tool.items.length
                                    ? `<div class="chips">${tool.items.map((i) => `<span class="chip mono">${esc(i)}</span>`).join("")}</div>`
                                    : "",
                            ),
                        )
                        .join(""),
                    { parallel: true },
                ),
            );
        }
    }

    // 4. steps — the actual prompt flow
    if (workflow.steps.length) {
        const steps = workflow.steps
            .map((step, index) => {
                const open = state.openSteps.has(`${workflow.id}:${index}`);
                const body = step.detail || step.substeps.join("\n");
                return `
                    <li class="step ${open ? "open" : ""}" data-step="${index}">
                        <button class="step-head">
                            <span class="step-index">${index + 1}</span>
                            <span class="step-title">${inlineMd(step.title)}</span>
                            ${body ? '<span class="step-caret">▸</span>' : ""}
                        </button>
                        ${body ? `<div class="step-body">${markdown(body)}</div>` : ""}
                    </li>`;
            })
            .join("");
        parts.push(stage("步骤", `<ol class="steps">${steps}</ol>`));
    } else if (workflow.jobs.length) {
        parts.push(
            stage(
                "Jobs",
                workflow.jobs
                    .map((job) =>
                        node(
                            `⚙️ ${esc(job.name)}`,
                            job.steps.map((s) => `<div>· ${esc(s)}</div>`).join(""),
                        ),
                    )
                    .join(""),
                { parallel: true },
            ),
        );
    }

    // 5. sub-agents run in parallel inside the run
    if (workflow.agents.length) {
        parts.push(
            stage(
                "子代理",
                workflow.agents
                    .map((agent) =>
                        node(
                            `🧑‍⚖️ ${esc(agent.name)}`,
                            `${esc(agent.role)}${agent.model ? ` <span class="chip mono">${esc(agent.model)}</span>` : ""}`,
                            "agent",
                        ),
                    )
                    .join(""),
                { parallel: true },
            ),
        );
    }

    // 6. safe outputs
    const outputs = workflow.safeOutputs.items;
    if (outputs.length) {
        parts.push(
            stage(
                "安全输出",
                outputs
                    .map((output) =>
                        node(
                            `${output.icon} ${esc(output.name)}`,
                            output.details.length
                                ? `<div class="chips">${output.details.map((d) => chip(esc(d))).join("")}</div>`
                                : "",
                            "output",
                        ),
                    )
                    .join(""),
                { parallel: true, connector: true },
            ),
        );
    }

    // 7. downstream workflows this one wakes up
    const downstream = data.edges.filter((edge) => edge.from === workflow.id);
    if (downstream.length) {
        parts.push(
            stage(
                "下游",
                downstream
                    .map((edge) => {
                        const target = workflowById(edge.to);
                        return node(
                            `➡️ ${esc(target ? target.name : edge.to)}`,
                            esc(edge.label),
                            "downstream",
                            `data-goto="${edge.to}"`,
                        );
                    })
                    .join(""),
                { parallel: true, connector: false },
            ),
        );
    } else {
        // drop the dangling connector emitted by the previous stage
        parts.push(stage("结束", node("✅ 运行结束", "本工作流不再唤起其他工作流"), { connector: false }));
    }

    return `<div class="flow">${parts.join("")}</div>`;
}

function renderConfig(workflow) {
    const rows = [
        ["文件", `<code>${esc(workflow.file)}</code>`],
        ["类型", workflow.kind === "agentic" ? "Agentic Workflow (gh-aw)" : "标准 GitHub Actions"],
        ["引擎", workflow.engine ? `<code>${esc(workflow.engine)}</code>` : "—"],
        ["strict", workflow.strict ? "true" : "—"],
        [
            "触发",
            workflow.triggers.length
                ? workflow.triggers.map((t) => `<div>${triggerText(t)}</div>`).join("")
                : "—",
        ],
        ["权限", workflow.permissions.length ? workflow.permissions.map((p) => chip(esc(p))).join(" ") : "—"],
        ["网络", workflow.network.length ? workflow.network.map((n) => chip(esc(n))).join(" ") : "—"],
        ["导入", workflow.imports.length ? workflow.imports.map((i) => `<code>${esc(i)}</code>`).join(" ") : "—"],
        [
            "工具",
            workflow.tools.length
                ? workflow.tools
                      .map(
                          (t) =>
                              `<div><strong>${esc(t.name)}</strong> ${t.items.map((i) => `<code>${esc(i)}</code>`).join(" ")}</div>`,
                      )
                      .join("")
                : "—",
        ],
        [
            "安全输出",
            workflow.safeOutputs.items.length
                ? workflow.safeOutputs.items
                      .map(
                          (o) =>
                              `<div>${o.icon} <strong>${esc(o.name)}</strong> ${o.details.map((d) => chip(esc(d))).join(" ")}</div>`,
                      )
                      .join("") + (workflow.safeOutputs.staged ? chip("staged (dry-run)", "amber") : "")
                : "—",
        ],
        [
            "编译产物",
            workflow.compiled
                ? `<code>${esc(workflow.compiled.file)}</code> · ${Math.round(workflow.compiled.size / 1024)} KB`
                : "—",
        ],
    ];

    const agents = workflow.agents.length
        ? `<div class="section"><h3>子代理 (${workflow.agents.length})</h3>${workflow.agents
              .map(
                  (agent) => `
            <div class="node agent" style="margin-bottom:8px">
                <div class="node-title">🧑‍⚖️ ${esc(agent.name)}</div>
                <div class="node-sub">${markdown(agent.body.slice(0, 700))}</div>
            </div>`,
              )
              .join("")}</div>`
        : "";

    return `
        <div class="section">
            <h3>配置</h3>
            <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
        </div>
        ${agents}`;
}

function renderDetail(workflow) {
    const badges = [
        chip(workflow.kind === "agentic" ? "Agentic" : "Actions", workflow.kind === "agentic" ? "accent" : ""),
        workflow.engine ? chip(`engine: ${esc(workflow.engine)}`) : "",
        workflow.strict ? chip("strict", "green") : "",
        workflow.steps.length ? chip(`${workflow.steps.length} 步`) : "",
        workflow.agents.length ? chip(`${workflow.agents.length} 子代理`, "amber") : "",
        `<span class="chip mono">${esc(workflow.file)}</span>`,
    ]
        .filter(Boolean)
        .join("");

    const tabs = [
        ["flow", "流程图"],
        ["config", "配置"],
        ["source", "源码"],
    ]
        .map(
            ([key, label]) =>
                `<button class="tab ${state.tab === key ? "active" : ""}" data-tab="${key}">${label}</button>`,
        )
        .join("");

    let body = "";
    if (state.tab === "flow") body = renderFlow(workflow);
    else if (state.tab === "config") body = renderConfig(workflow);
    else body = `<pre class="raw">${esc(workflow.raw)}</pre>`;

    mainEl.innerHTML = `
        <div class="detail-head">
            <h2>${esc(workflow.name)}</h2>
            <p class="desc">${esc(workflow.description)}</p>
            <div class="chips">${badges}</div>
        </div>
        <div class="tabs">${tabs}</div>
        ${body}`;
}

// ----------------------------------------------------------- overview graph

function computeLayers(workflows, edges) {
    const layer = new Map(workflows.map((w) => [w.id, 0]));
    for (let pass = 0; pass < workflows.length; pass += 1) {
        let changed = false;
        for (const edge of edges) {
            if (!layer.has(edge.from) || !layer.has(edge.to)) continue;
            const want = layer.get(edge.from) + 1;
            if (want > layer.get(edge.to)) {
                layer.set(edge.to, want);
                changed = true;
            }
        }
        if (!changed) break;
    }
    return layer;
}

function drawEdges(graph) {
    const svg = graph.querySelector("svg.edges");
    const width = graph.scrollWidth;
    const height = graph.scrollHeight;
    svg.setAttribute("width", width);
    svg.setAttribute("height", height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

    const origin = graph.getBoundingClientRect();
    const position = (id) => {
        const el = graph.querySelector(`[data-node="${id}"]`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
            center: rect.left - origin.left + graph.scrollLeft + rect.width / 2,
            top: rect.top - origin.top + graph.scrollTop,
            bottom: rect.bottom - origin.top + graph.scrollTop,
        };
    };

    const markers = Object.entries(EDGE_COLORS)
        .map(
            ([kind, color]) => `
        <marker id="arrow-${kind}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="${color}" />
        </marker>`,
        )
        .join("");

    const paths = state.data.edges
        .map((edge, index) => {
            const from = position(edge.from);
            const to = position(edge.to);
            if (!from || !to) return "";
            const color = EDGE_COLORS[edge.kind] || "var(--border)";
            const forward = to.top >= from.bottom;
            const y0 = forward ? from.bottom + 2 : from.top - 2;
            const y1 = forward ? to.top - 8 : to.bottom + 8;
            const dy = Math.max(22, Math.abs(y1 - y0) / 2);
            const path = `M ${from.center} ${y0} C ${from.center} ${y0 + (forward ? dy : -dy)}, ${to.center} ${y1 - (forward ? dy : -dy)}, ${to.center} ${y1}`;
            const midX = (from.center + to.center) / 2;
            // Stagger labels so parallel edges landing on the same row stay readable.
            const midY = (y0 + y1) / 2 + ((index % 3) - 1) * 11;
            return `
                <path d="${path}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.8" marker-end="url(#arrow-${edge.kind})" />
                <text class="edge-label" x="${midX}" y="${midY}" fill="${color}" text-anchor="middle">${esc(edge.label)}</text>`;
        })
        .join("");

    svg.innerHTML = `<defs>${markers}</defs>${paths}`;
}

function renderOverview() {
    const { workflows, edges } = state.data;
    const layer = computeLayers(workflows, edges);
    const maxLayer = Math.max(0, ...layer.values());

    const rows = [];
    for (let i = 0; i <= maxLayer; i += 1) {
        const items = workflows.filter((w) => layer.get(w.id) === i);
        if (!items.length) continue;
        rows.push(`
            <div class="row">
                ${items
                    .map(
                        (w) => `
                    <button class="gnode ${w.kind}" data-node="${w.id}" data-goto="${w.id}">
                        <span class="gname">${w.kind === "agentic" ? "🤖" : "⚙️"} ${esc(w.name)}</span>
                        <span class="gtrigger">${w.triggers.map((t) => `${t.icon} ${esc(t.label)}`).join(" · ") || "—"}</span>
                    </button>`,
                    )
                    .join("")}
            </div>`);
    }

    mainEl.innerHTML = `
        <div class="detail-head">
            <h2>流水线全景</h2>
            <p class="desc">
                本仓库 ${state.data.agenticCount} 个 Agentic Workflow 与 ${workflows.length - state.data.agenticCount} 个标准工作流之间的衔接关系，
                由 <code>safe-outputs</code>、标签、PR 事件与 <code>workflow_run</code> 推导得出。点击任意节点查看该工作流的完整流程。
            </p>
        </div>
        <div class="graph"><svg class="edges"></svg><div class="rows">${rows.join("")}</div></div>
        <div class="legend">
            <span style="color:var(--accent)">dispatch 派发</span>
            <span style="color:var(--amber)">label 打标签</span>
            <span style="color:var(--green)">PR 事件</span>
            <span style="color:var(--purple)">workflow_run</span>
        </div>`;

    const graph = mainEl.querySelector(".graph");
    requestAnimationFrame(() => drawEdges(graph));
    if (window.__graphObserver) window.__graphObserver.disconnect();
    window.__graphObserver = new ResizeObserver(() => drawEdges(graph));
    window.__graphObserver.observe(graph);
}

// ------------------------------------------------------------------ wiring

function render() {
    renderSidebar();
    if (!state.data) return;
    if (state.selected === null) {
        renderOverview();
        return;
    }
    const workflow = workflowById(state.selected);
    if (!workflow) {
        state.selected = null;
        renderOverview();
        return;
    }
    renderDetail(workflow);
}

function select(id) {
    state.selected = id === "__overview__" ? null : id;
    state.tab = "flow";
    render();
    mainEl.scrollTop = 0;
}

async function load({ refresh = false } = {}) {
    const response = await fetch(`/api/data${refresh ? "?refresh=1" : ""}`);
    state.data = await response.json();
    if (state.selected && !workflowById(state.selected)) state.selected = null;
    render();
}

listEl.addEventListener("click", (event) => {
    const item = event.target.closest(".item");
    if (item) select(item.dataset.id);
});

mainEl.addEventListener("click", (event) => {
    const goto = event.target.closest("[data-goto]");
    if (goto) {
        select(goto.dataset.goto);
        return;
    }
    const tab = event.target.closest(".tab");
    if (tab) {
        state.tab = tab.dataset.tab;
        render();
        return;
    }
    const stepHead = event.target.closest(".step-head");
    if (stepHead) {
        const step = stepHead.closest(".step");
        const key = `${state.selected}:${step.dataset.step}`;
        if (state.openSteps.has(key)) state.openSteps.delete(key);
        else state.openSteps.add(key);
        step.classList.toggle("open");
    }
});

searchEl.addEventListener("input", () => {
    state.query = searchEl.value.trim();
    renderSidebar();
});

refreshEl.addEventListener("click", () => load({ refresh: true }));

const events = new EventSource("/events");
events.addEventListener("message", (event) => {
    let payload = null;
    try {
        payload = JSON.parse(event.data);
    } catch {
        return;
    }
    if (payload.type === "changed") load();
    if (payload.type === "select") select(payload.id);
});

const params = new URLSearchParams(location.search);
await load();
if (params.get("workflow")) select(params.get("workflow"));
else if (params.get("view") === "workflow" && state.data.workflows.length) {
    select(state.data.workflows.find((w) => w.kind === "agentic")?.id ?? state.data.workflows[0].id);
}
