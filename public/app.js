const state = {
  validated: false,
  context: null,
  result: null,
  selectedNodeId: null
};

const STORAGE_KEY = "nodestory.openaiApiKey";

const elements = {
  apiKey: document.querySelector("#apiKey"),
  rememberKey: document.querySelector("#rememberKey"),
  validateBtn: document.querySelector("#validateBtn"),
  keyStatus: document.querySelector("#keyStatus"),
  storyInput: document.querySelector("#storyInput"),
  generateBtn: document.querySelector("#generateBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  structures: document.querySelector("#structures"),
  npcCount: document.querySelector("#npcCount"),
  itemCount: document.querySelector("#itemCount"),
  buildingCount: document.querySelector("#buildingCount"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  notice: document.querySelector("#notice"),
  storySummary: document.querySelector("#storySummary"),
  graph: document.querySelector("#graph"),
  nodeList: document.querySelector("#nodeList")
};

function setStatus(message, type) {
  elements.keyStatus.textContent = message;
  elements.keyStatus.className = `status ${type || ""}`.trim();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function renderContext(context) {
  state.context = context;
  elements.npcCount.textContent = context.levelData.npcs.length;
  elements.itemCount.textContent = context.levelData.items.length;
  elements.buildingCount.textContent = context.levelData.buildings.length;

  elements.structures.innerHTML = context.structures.map(structure => `
    <article class="structure-card" data-structure-id="${escapeHtml(structure.id)}">
      <h3>结构 ${escapeHtml(structure.id)} · ${escapeHtml(structure.file)}</h3>
      <pre>${escapeHtml(structure.content)}</pre>
    </article>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function updateGenerateState() {
  elements.generateBtn.disabled = !state.validated || !elements.storyInput.value.trim();
}

function loadSavedApiKey() {
  const savedKey = localStorage.getItem(STORAGE_KEY) || "";
  if (savedKey) {
    elements.apiKey.value = savedKey;
    elements.rememberKey.checked = true;
    setStatus("已读取本地保存的 Key，需重新验证", "");
  }
}

function syncSavedApiKey(apiKey) {
  if (elements.rememberKey.checked) {
    localStorage.setItem(STORAGE_KEY, apiKey);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function setBusy(isBusy, message) {
  elements.validateBtn.disabled = isBusy;
  elements.generateBtn.disabled = isBusy || !state.validated || !elements.storyInput.value.trim();
  if (message) {
    elements.notice.textContent = message;
    elements.notice.classList.remove("hidden");
  }
}

function renderSummary(payload) {
  const story = payload.story;
  const selectionScores = payload.selection?.scores || [];
  const adaptation = story.adaptation || {};
  const storyContext = story.storyContext || {};
  const deck = story.designDeck || {};
  const layerNotes = story.layerNotes || [];
  const deckItems = [
    ["前提牌", deck.premiseCard],
    ["冲突牌", deck.conflictCard],
    ["地点牌", deck.locationCard],
    ["转折牌", deck.twistCard],
    ["代价牌", deck.costCard],
    ["结局牌", deck.resolutionCard]
  ];

  elements.resultTitle.textContent = story.selectedStructure.name || `结构 ${story.selectedStructure.id}`;
  elements.resultMeta.textContent = `由 gpt-4o 选择 ${story.selectedStructure.file}，素材来自 ${payload.levelDataSummary.relativePath}`;
  elements.storySummary.classList.remove("hidden");
  elements.storySummary.innerHTML = `
    <div class="summary-block">
      <h3>改编原则</h3>
      <dl class="deck-list">
        <div><dt>核心母题</dt><dd>${escapeHtml(adaptation.sourceTheme || "-")}</dd></div>
        <div><dt>保留精神</dt><dd>${escapeHtml(adaptation.keptSpirit || "-")}</dd></div>
        <div><dt>替换表层</dt><dd>${escapeHtml(adaptation.changedSurface || "-")}</dd></div>
        <div><dt>冒险承诺</dt><dd>${escapeHtml(adaptation.newAdventurePromise || "-")}</dd></div>
      </dl>
    </div>
    <div class="summary-block">
      <h3>故事上下文</h3>
      <dl class="deck-list">
        <div><dt>玩家身份</dt><dd>${escapeHtml(storyContext.playerRole || "-")}</dd></div>
        <div><dt>主冲突</dt><dd>${escapeHtml(storyContext.mainConflict || "-")}</dd></div>
        <div><dt>事发前因</dt><dd>${escapeHtml(storyContext.priorIncident || "-")}</dd></div>
        <div><dt>失败代价</dt><dd>${escapeHtml(storyContext.stakes || "-")}</dd></div>
      </dl>
    </div>
    <div class="summary-block">
      <h3>完整故事底稿</h3>
      <div class="story-text">${escapeHtml(story.expandedStory)}</div>
    </div>
    <div class="summary-grid">
      <section>
        <h3>叙事发牌</h3>
        <dl class="deck-list">
          ${deckItems.map(([label, value]) => `
            <div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value || "-")}</dd></div>
          `).join("")}
        </dl>
        <div class="mini-tags">
          ${(deck.npcCards || []).map(card => `<span>NPC牌：${escapeHtml(card)}</span>`).join("")}
          ${(deck.itemCards || []).map(card => `<span>道具牌：${escapeHtml(card)}</span>`).join("")}
        </div>
      </section>
      <section>
        <h3>层级规则</h3>
        <div class="layer-list">
          ${layerNotes.map(note => `
            <article>
              <strong>第 ${escapeHtml(note.layer)} 层</strong>
              <p>${escapeHtml(note.purpose)}</p>
              <em>${escapeHtml(note.peerRule)}</em>
            </article>
          `).join("")}
        </div>
      </section>
    </div>
    <div class="summary-block">
      <h3>选择理由</h3>
      <p>${escapeHtml(story.reason || payload.selection.reason)}</p>
      <div class="score-list">
        ${selectionScores.map(item => `
          <article class="${item.id === story.selectedStructure.id ? "active" : ""}">
            <strong>结构 ${escapeHtml(item.id)}：${escapeHtml(item.score)} 分</strong>
            <span>${escapeHtml(item.reason)}</span>
          </article>
        `).join("")}
      </div>
    </div>
  `;

  document.querySelectorAll(".structure-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.structureId === story.selectedStructure.id);
  });
}

function renderNodes(nodes) {
  state.selectedNodeId = null;
  elements.nodeList.innerHTML = `
    <article class="node-card empty-detail">
      <h3>点击结构图中的节点</h3>
      <p>生成后的节点内容不会全部展开。选择一个节点后，这里会显示剧情、NPC、道具、地点、完成条件和后续衔接。</p>
    </article>
  `;
}

function renderNodeDetail(nodeId) {
  if (!state.result) return;
  const story = state.result.story;
  const node = story.nodes.find(item => item.id === nodeId);
  if (!node) return;

  state.selectedNodeId = nodeId;
  const tags = [
    ...(node.npcs || []).map(name => `NPC: ${name}`),
    ...(node.items || []).map(name => `道具: ${name}`),
    ...(node.locations || []).map(name => `地点: ${name}`)
  ];
  const transitions = (story.edges || []).filter(edge => edge.from === node.id);

  elements.nodeList.innerHTML = `
    <article class="node-card selected-detail" id="node-${escapeHtml(node.id)}">
      <div class="node-meta">第 ${escapeHtml(node.layer)} 层 · ${escapeHtml(node.nodePurpose)}</div>
      <h3>${escapeHtml(node.id)} · ${escapeHtml(node.title)}</h3>
      <div class="beat"><strong>节点开始状态</strong><p>${escapeHtml(node.startState)}</p></div>
      <p>${escapeHtml(node.plot)}</p>
      <div class="beat"><strong>节点结果</strong><p>${escapeHtml(node.nodeOutcome)}</p></div>
      <div class="tags">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="condition"><strong>开启下一节点条件：</strong>${escapeHtml(node.completionCondition)}</div>
      ${renderCompletionLogic(node.completionLogic)}
      <div class="transitions">
        <strong>后续衔接</strong>
        ${transitions.length ? transitions.map(edge => `
          <p><span>${escapeHtml(edge.to)}</span>${escapeHtml(edge.transition || edge.label)}${renderCarriedResults(edge.carriedResults)}</p>
        `).join("") : "<p>这是当前结构的终点节点。</p>"}
      </div>
    </article>
  `;

  elements.graph.querySelectorAll(".graph-node").forEach(item => {
    item.classList.toggle("selected", item.dataset.nodeId === nodeId);
  });
}

function renderCarriedResults(results) {
  if (!results || !results.length) return "";
  return `<em class="carried-results">继承结果：${results.map(escapeHtml).join("；")}</em>`;
}

function renderCompletionLogic(logic) {
  if (!logic) return "";
  const objectives = logic.objectives || logic.rules || [];
  const results = logic.results || logic.effects || [];

  return `
    <div class="completion-logic">
      <strong>任务目标</strong>
      <p class="logic-expression">${escapeHtml(logic.summary || logic.description || logic.expression || "-")}</p>
      ${objectives.length ? `
        <div class="logic-list">
          ${objectives.map(objective => `
            <p><span>${escapeHtml(objective.id || objective.kind)}</span>${escapeHtml(objective.text || `${objective.target} ${objective.operator} ${objective.value}`)}</p>
          `).join("")}
        </div>
      ` : ""}
      ${results.length ? `
        <div class="logic-effects">
          <strong>完成结果</strong>
          ${results.map(result => `<p><span>${escapeHtml(result.kind || result.trigger)}</span>${escapeHtml(result.text || result.effect || result.change)}</p>`).join("")}
        </div>
      ` : ""}
      <p class="logic-formula">${escapeHtml(logic.expression || "")}</p>
    </div>
  `;
}

function renderGraph(story) {
  const nodes = story.nodes;
  const edges = story.edges;
  const nodeWidth = 190;
  const nodeHeight = 88;
  const colGap = 96;
  const rowGap = 52;
  const depth = assignDepths(nodes, edges);
  const columns = new Map();

  nodes.forEach(node => {
    const column = depth.get(node.id) || 0;
    if (!columns.has(column)) columns.set(column, []);
    columns.get(column).push(node);
  });

  const positions = new Map();
  const sortedColumns = [...columns.keys()].sort((a, b) => a - b);
  sortedColumns.forEach(column => {
    const columnNodes = columns.get(column).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    columnNodes.forEach((node, row) => {
      positions.set(node.id, {
        x: 32 + column * (nodeWidth + colGap),
        y: 32 + row * (nodeHeight + rowGap)
      });
    });
  });

  const maxRows = Math.max(1, ...[...columns.values()].map(column => column.length));
  const width = 64 + sortedColumns.length * (nodeWidth + colGap);
  const height = 64 + maxRows * (nodeHeight + rowGap);

  const edgeMarkup = edges.map(edge => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const x1 = from.x + nodeWidth;
    const y1 = from.y + nodeHeight / 2;
    const x2 = to.x;
    const y2 = to.y + nodeHeight / 2;
    const mid = x1 + Math.max(30, (x2 - x1) / 2);
    return `
      <g>
        <title>${escapeHtml(edge.transition || edge.label)}</title>
        <path d="M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}" fill="none" stroke="#9c8f7b" stroke-width="2" marker-end="url(#arrow)" />
        <text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle">${escapeHtml(edge.label)}</text>
      </g>
    `;
  }).join("");

  const nodeMarkup = nodes.map(node => {
    const point = positions.get(node.id);
    if (!point) return "";
    const title = node.title.length > 18 ? `${node.title.slice(0, 17)}...` : node.title;
    return `
      <g class="graph-node" data-node-id="${escapeHtml(node.id)}" tabindex="0" role="button" aria-label="查看节点 ${escapeHtml(node.id)}">
        <rect class="node-rect" x="${point.x}" y="${point.y}" width="${nodeWidth}" height="${nodeHeight}" rx="8" fill="#fffaf1" stroke="#1f6f64" stroke-width="2" />
        <text x="${point.x + 14}" y="${point.y + 25}" font-weight="800">${escapeHtml(node.id)}</text>
        <text x="${point.x + 14}" y="${point.y + 49}">${escapeHtml(title)}</text>
        <text x="${point.x + 14}" y="${point.y + 72}" class="layer-text">第 ${escapeHtml(node.layer)} 层</text>
      </g>
    `;
  }).join("");

  elements.graph.innerHTML = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="节点结构图">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#9c8f7b" />
        </marker>
      </defs>
      <style>
        text { font: 13px Inter, Segoe UI, Microsoft YaHei, Arial, sans-serif; fill: #25231e; }
        .layer-text { fill: #6b675d; font-size: 12px; }
      </style>
      ${edgeMarkup}
      ${nodeMarkup}
    </svg>
  `;

  elements.graph.querySelectorAll(".graph-node").forEach(node => {
    node.addEventListener("click", () => renderNodeDetail(node.dataset.nodeId));
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        renderNodeDetail(node.dataset.nodeId);
      }
    });
  });
}

function assignDepths(nodes, edges) {
  const explicitLayers = nodes.map(node => Number(node.layer));
  if (explicitLayers.every(layer => Number.isFinite(layer) && layer > 0)) {
    return new Map(nodes.map(node => [node.id, Math.max(0, Number(node.layer) - 1)]));
  }

  const ids = new Set(nodes.map(node => node.id));
  const incoming = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map(nodes.map(node => [node.id, []]));

  edges.forEach(edge => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) return;
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    outgoing.get(edge.from).push(edge.to);
  });

  const starts = nodes.filter(node => (incoming.get(node.id) || 0) === 0).map(node => node.id);
  const queue = starts.length ? starts : [nodes[0]?.id].filter(Boolean);
  const depth = new Map(queue.map(id => [id, 0]));

  while (queue.length) {
    const id = queue.shift();
    const nextDepth = (depth.get(id) || 0) + 1;
    for (const next of outgoing.get(id) || []) {
      if (!depth.has(next) || nextDepth > depth.get(next)) {
        depth.set(next, nextDepth);
        queue.push(next);
      }
    }
  }

  nodes.forEach((node, index) => {
    if (!depth.has(node.id)) depth.set(node.id, index);
  });
  return depth;
}

async function loadContext() {
  try {
    const context = await requestJson("/api/context");
    renderContext(context);
  } catch (error) {
    elements.notice.textContent = `读取素材失败：${error.message}`;
  }
}

elements.validateBtn.addEventListener("click", async () => {
  const apiKey = elements.apiKey.value.trim();
  elements.apiKey.value = apiKey;
  if (!apiKey) {
    setStatus("请输入 Key", "error");
    return;
  }

  setBusy(true, "正在验证 OpenAI API Key...");
  setStatus("验证中", "");
  try {
    await requestJson("/api/validate-key", {
      method: "POST",
      body: JSON.stringify({ apiKey })
    });
    state.validated = true;
    syncSavedApiKey(apiKey);
    setStatus("验证成功", "ok");
  } catch (error) {
    state.validated = false;
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
    updateGenerateState();
  }
});

elements.storyInput.addEventListener("input", updateGenerateState);

elements.rememberKey.addEventListener("change", () => {
  if (!elements.rememberKey.checked) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    const apiKey = elements.apiKey.value.trim();
    if (state.validated && apiKey) {
      localStorage.setItem(STORAGE_KEY, apiKey);
    }
  }
});

elements.generateBtn.addEventListener("click", async () => {
  setBusy(true, "正在发叙事牌、选择结构并生成节点故事...");
  const apiKey = elements.apiKey.value.trim();
  elements.apiKey.value = apiKey;
  syncSavedApiKey(apiKey);
  try {
    const payload = await requestJson("/api/generate-story", {
      method: "POST",
      body: JSON.stringify({
        apiKey,
        story: elements.storyInput.value.trim()
      })
    });
    state.result = payload;
    state.selectedNodeId = null;
    elements.exportBtn.disabled = false;
    elements.notice.classList.add("hidden");
    renderSummary(payload);
    renderGraph(payload.story);
    renderNodes(payload.story.nodes);
  } catch (error) {
    elements.notice.classList.remove("hidden");
    elements.notice.textContent = `生成失败：${error.message}`;
  } finally {
    setBusy(false);
  }
});

elements.exportBtn.addEventListener("click", () => {
  if (!state.result) return;
  const blob = new Blob([JSON.stringify(state.result.story, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "node-story.json";
  link.click();
  URL.revokeObjectURL(url);
});

loadSavedApiKey();
loadContext();
