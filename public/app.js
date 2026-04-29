const state = {
  validated: false,
  context: null,
  result: null,
  selectedNodeId: null
};

const STORAGE_KEY = "nodestory.openaiApiKey";
const REASONING_MODEL_KEY = "nodestory.reasoningModel";
const WRITING_MODEL_KEY = "nodestory.writingModel";
const USE_LOCAL_CHARACTERS_KEY = "nodestory.useLocalCharacters";
const DEFAULT_REASONING_MODEL = "gpt-4o";
const DEFAULT_WRITING_MODEL = "gpt-5.5";

const elements = {
  apiKey: document.querySelector("#apiKey"),
  rememberKey: document.querySelector("#rememberKey"),
  validateBtn: document.querySelector("#validateBtn"),
  keyStatus: document.querySelector("#keyStatus"),
  reasoningModel: document.querySelector("#reasoningModel"),
  writingModel: document.querySelector("#writingModel"),
  useLocalCharacters: document.querySelector("#useLocalCharacters"),
  storyInput: document.querySelector("#storyInput"),
  generateBtn: document.querySelector("#generateBtn"),
  importBtn: document.querySelector("#importBtn"),
  importFileInput: document.querySelector("#importFileInput"),
  exportBtn: document.querySelector("#exportBtn"),
  sendToUEBtn: document.querySelector("#sendToUEBtn"),
  sendNodesBtn: document.querySelector("#sendNodesBtn"),
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

function selectOptionIfAvailable(selectElement, value) {
  if (!selectElement || !value) return false;
  const found = Array.from(selectElement.options).some(option => option.value === value);
  if (found) {
    selectElement.value = value;
    return true;
  }
  return false;
}

function loadSavedModels() {
  const savedReasoning = localStorage.getItem(REASONING_MODEL_KEY);
  const savedWriting = localStorage.getItem(WRITING_MODEL_KEY);
  if (!selectOptionIfAvailable(elements.reasoningModel, savedReasoning)) {
    selectOptionIfAvailable(elements.reasoningModel, DEFAULT_REASONING_MODEL);
  }
  if (!selectOptionIfAvailable(elements.writingModel, savedWriting)) {
    selectOptionIfAvailable(elements.writingModel, DEFAULT_WRITING_MODEL);
  }
}

function getSelectedModels() {
  const reasoning = elements.reasoningModel?.value || DEFAULT_REASONING_MODEL;
  const writing = elements.writingModel?.value || DEFAULT_WRITING_MODEL;
  return {
    structure: reasoning,
    blueprint: reasoning,
    foundation: writing,
    detail: writing
  };
}

function loadSavedUseLocalCharacters() {
  const saved = localStorage.getItem(USE_LOCAL_CHARACTERS_KEY);
  if (saved === null || saved === undefined) return;
  if (elements.useLocalCharacters) {
    elements.useLocalCharacters.checked = saved !== "false";
  }
}

function getUseLocalCharacters() {
  return elements.useLocalCharacters ? elements.useLocalCharacters.checked : true;
}

function setBusy(isBusy, message) {
  elements.validateBtn.disabled = isBusy;
  elements.generateBtn.disabled = isBusy || !state.validated || !elements.storyInput.value.trim();
  if (message) {
    elements.notice.textContent = message;
    elements.notice.classList.remove("hidden");
  }
}

function renderGeneratedLevelData(payload) {
  const summary = payload.levelDataSummary || {};
  if (summary.npcSource !== "ai") return "";
  const data = payload.levelData;
  if (!data) return "";
  const npcs = Array.isArray(data.npcs) ? data.npcs : [];
  const buildings = Array.isArray(data.buildings) ? data.buildings : [];
  if (!npcs.length && !buildings.length) return "";

  const npcMarkup = npcs.length ? `
    <section>
      <h4>AI 生成的 NPC</h4>
      <ul class="generated-list">
        ${npcs.map(npc => `
          <li>
            <div class="generated-head">
              <strong>${escapeHtml(npc.name || "")}</strong>
              <span class="generated-tag">${escapeHtml(npc.type || "")}</span>
              ${npc.affinity !== undefined && npc.affinity !== "" ? `<span class="generated-affinity">好感 ${escapeHtml(npc.affinity)}</span>` : ""}
            </div>
            ${npc.state ? `<p class="generated-state">${escapeHtml(npc.state)}</p>` : ""}
            ${npc.background ? `<p class="generated-background">${escapeHtml(npc.background)}</p>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
  ` : "";

  const buildingMarkup = buildings.length ? `
    <section>
      <h4>AI 生成的地点</h4>
      <ul class="generated-list">
        ${buildings.map(building => `
          <li>
            <div class="generated-head">
              <strong>${escapeHtml(building.name || "")}</strong>
              <span class="generated-tag">${escapeHtml(building.resource || "")}</span>
            </div>
            ${building.description ? `<p class="generated-background">${escapeHtml(building.description)}</p>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
  ` : "";

  return `
    <div class="summary-block">
      <h3>AI 生成的素材（道具仍来自本地）</h3>
      <div class="generated-data">
        ${npcMarkup}
        ${buildingMarkup}
      </div>
    </div>
  `;
}

function renderSummary(payload) {
  const story = payload.story;
  const selectionScores = payload.selection?.scores || [];
  const generationStages = payload.generationStages || [];
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

  elements.resultTitle.textContent = story.selectedStructure?.name || `结构 ${story.selectedStructure?.id || ""}`;
  const summary = payload.levelDataSummary || {};
  const characterSourceLabel = summary.npcSource === "ai"
    ? "NPC / 地点：AI 生成"
    : `NPC / 地点：本地 ${summary.relativePath || ""}`.trim();
  const itemSourceLabel = `道具：本地 ${summary.relativePath || ""}`.trim();
  elements.resultMeta.textContent = story.selectedStructure
    ? `分阶段生成 · ${story.selectedStructure.file || ""} · ${characterSourceLabel} · ${itemSourceLabel}`
    : "导入 JSON";
  elements.storySummary.classList.remove("hidden");
  elements.storySummary.innerHTML = `
    <div class="summary-block">
      <h3>生成阶段</h3>
      <div class="stage-list">
        ${generationStages.map(stage => `<span>${escapeHtml(stage.label)}：${escapeHtml(stage.model)}</span>`).join("")}
      </div>
    </div>
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
    ${renderGeneratedLevelData(payload)}
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
      <p>${escapeHtml(story.reason || payload.selection?.reason || "")}</p>
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
      <div class="plot-text">${escapeHtml(node.plot)}</div>
      ${renderSceneBeats(node)}
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

function renderSceneBeats(node) {
  const dialogue = Array.isArray(node.keyDialogue) ? node.keyDialogue : [];
  const actions = Array.isArray(node.keyActions) ? node.keyActions : [];
  if (!dialogue.length && !actions.length) return "";

  const dialogueMarkup = dialogue.length ? `
    <section class="key-dialogue">
      <strong>NPC 对白</strong>
      <ul>
        ${dialogue.map(item => `
          <li>
            <span class="speaker">${escapeHtml(item.speaker || "NPC")}</span>
            <span class="line">"${escapeHtml(item.line || "")}"</span>
            ${item.intent ? `<span class="intent">${escapeHtml(item.intent)}</span>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
  ` : "";

  const actionMarkup = actions.length ? `
    <section class="key-actions">
      <strong>NPC 动作</strong>
      <ul>
        ${actions.map(item => `
          <li>
            <span class="actor">${escapeHtml(item.actor || "NPC")}</span>
            <span class="action">${escapeHtml(item.action || "")}</span>
            ${item.intent ? `<span class="intent">${escapeHtml(item.intent)}</span>` : ""}
          </li>
        `).join("")}
      </ul>
    </section>
  ` : "";

  return `<div class="scene-beats">${dialogueMarkup}${actionMarkup}</div>`;
}

function renderCarriedResults(results) {
  if (!results || !results.length) return "";
  return `<em class="carried-results">继承结果：${results.map(escapeHtml).join("；")}</em>`;
}

const OBJECTIVE_KIND_LABELS = {
  affinity_min: "好感 ≥",
  affinity_max: "好感 ≤",
  friend: "说服为朋友",
  companion: "说服为伙伴",
  enemy: "成为敌人",
  not_enemy: "避免敌对",
  defeated: "击败",
  item_obtained: "获得道具",
  item_lost: "失去道具",
  item_delivered: "交付道具",
  money_at_least: "筹集金钱",
  money_spent: "花费金钱",
  fame_min: "名誉 ≥",
  fame_max: "名誉 ≤",
  story_flag: "剧情标记"
};

const RESULT_KIND_LABELS = {
  affinity: "好感",
  friend: "朋友",
  enemy: "敌人",
  companion: "伙伴",
  defeated: "击败",
  money: "金钱",
  item: "道具",
  fame: "名誉",
  route: "路线",
  story_flag: "剧情标记"
};

const RESULT_KIND_GROUP = {
  affinity: "relation",
  friend: "relation",
  enemy: "negative",
  companion: "relation",
  defeated: "negative",
  money: "money",
  item: "item",
  fame: "fame",
  route: "route",
  story_flag: "flag"
};

function objectiveKindLabel(kind) {
  return OBJECTIVE_KIND_LABELS[kind] || kind || "目标";
}

function resultKindLabel(kind) {
  return RESULT_KIND_LABELS[kind] || kind || "结果";
}

function objectiveKindClass(kind) {
  if (!kind) return "kind-default";
  if (kind.startsWith("affinity")) return "kind-affinity";
  if (kind.startsWith("money")) return "kind-money";
  if (kind.startsWith("fame")) return "kind-fame";
  if (kind.startsWith("item")) return "kind-item";
  if (kind === "friend") return "kind-friend";
  if (kind === "companion") return "kind-companion";
  if (kind === "enemy") return "kind-enemy";
  if (kind === "not_enemy") return "kind-not-enemy";
  if (kind === "defeated") return "kind-defeated";
  return "kind-default";
}

function resultKindClass(kind) {
  return `kind-${RESULT_KIND_GROUP[kind] || "default"} kind-${kind || "default"}`;
}

function deltaTone(delta, kind) {
  const value = String(delta || "").trim();
  if (!value) {
    if (kind === "enemy") return "negative";
    if (kind === "friend" || kind === "companion") return "positive";
    return "neutral";
  }
  if (/^\+/.test(value) || ["获得", "开启", "成立", "提升", "上升"].some(token => value.includes(token))) return "positive";
  if (/^-/.test(value) || ["失去", "关闭", "解除", "下降", "降低"].some(token => value.includes(token))) return "negative";
  return "neutral";
}

function renderObjective(objective) {
  const kind = objective.kind || "";
  const summary = objective.text || `${objective.target || ""} ${objective.operator || ""} ${objective.value || ""}`.trim();
  const detailParts = [];
  if (objective.target) detailParts.push(escapeHtml(objective.target));
  if (objective.operator) detailParts.push(escapeHtml(objective.operator));
  if (objective.value !== undefined && objective.value !== "") detailParts.push(escapeHtml(objective.value));

  return `
    <li class="objective-item ${objectiveKindClass(kind)}">
      <span class="kind-badge">${escapeHtml(objectiveKindLabel(kind))}</span>
      <div class="objective-body">
        <p class="objective-text">${escapeHtml(summary || "-")}</p>
        ${detailParts.length ? `<p class="objective-detail">${detailParts.join(" ")}</p>` : ""}
      </div>
    </li>
  `;
}

function renderResult(result) {
  const kind = result.kind || "";
  const tone = deltaTone(result.delta || result.change, kind);
  const delta = result.delta || result.change || "";
  return `
    <li class="result-item ${resultKindClass(kind)} tone-${tone}">
      <span class="kind-badge">${escapeHtml(resultKindLabel(kind))}</span>
      ${result.target ? `<span class="result-target">${escapeHtml(result.target)}</span>` : ""}
      ${delta ? `<span class="result-delta">${escapeHtml(delta)}</span>` : ""}
      <p class="result-text">${escapeHtml(result.text || result.change || "-")}</p>
    </li>
  `;
}

function renderCompletionLogic(logic) {
  if (!logic) return "";
  const objectives = logic.objectives || logic.rules || [];
  const results = logic.results || logic.effects || [];
  const resultBranches = logic.resultBranches || [];

  return `
    <div class="completion-logic">
      <strong>任务目标</strong>
      <p class="logic-expression">${escapeHtml(logic.summary || logic.description || logic.expression || "-")}</p>
      ${objectives.length ? `
        <ul class="objective-list">
          ${objectives.map(renderObjective).join("")}
        </ul>
      ` : ""}
      ${results.length ? `
        <div class="result-block">
          <strong>通用完成结果</strong>
          <ul class="result-list">
            ${results.map(renderResult).join("")}
          </ul>
        </div>
      ` : ""}
      ${resultBranches.length ? `
        <div class="result-branches">
          <strong>分支完成结果</strong>
          ${resultBranches.map(branch => `
            <article class="result-branch">
              <h4>${escapeHtml(branch.branchId || "分支")} · ${escapeHtml(branch.appliesWhen || "")}</h4>
              ${(branch.to || []).length ? `<p class="branch-target">进入：${(branch.to || []).map(escapeHtml).join(" / ")}</p>` : ""}
              <ul class="result-list">
                ${(branch.results || []).map(renderResult).join("")}
              </ul>
            </article>
          `).join("")}
        </div>
      ` : ""}
      ${logic.expression ? `<p class="logic-formula">${escapeHtml(logic.expression)}</p>` : ""}
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

elements.reasoningModel?.addEventListener("change", () => {
  localStorage.setItem(REASONING_MODEL_KEY, elements.reasoningModel.value);
});

elements.writingModel?.addEventListener("change", () => {
  localStorage.setItem(WRITING_MODEL_KEY, elements.writingModel.value);
});

elements.useLocalCharacters?.addEventListener("change", () => {
  localStorage.setItem(USE_LOCAL_CHARACTERS_KEY, String(elements.useLocalCharacters.checked));
});

elements.generateBtn.addEventListener("click", async () => {
  const models = getSelectedModels();
  const useLocalCharacters = getUseLocalCharacters();
  const characterStage = useLocalCharacters
    ? "本地素材：使用 NPC.csv / Building.csv"
    : `AI 生成 NPC / 地点（${models.foundation}）`;
  setBusy(true, `${characterStage} → 结构选择 / 节点蓝图（${models.structure}）→ 故事底稿 / 节点细写（${models.foundation}）...`);
  const apiKey = elements.apiKey.value.trim();
  elements.apiKey.value = apiKey;
  syncSavedApiKey(apiKey);
  try {
    const payload = await requestJson("/api/generate-story", {
      method: "POST",
      body: JSON.stringify({
        apiKey,
        story: elements.storyInput.value.trim(),
        models,
        useLocalCharacters
      })
    });
    state.result = payload;
    state.selectedNodeId = null;
    elements.exportBtn.disabled = false;
    elements.sendToUEBtn.disabled = false;
    elements.sendNodesBtn.disabled = false;
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

elements.importBtn.addEventListener("click", () => {
  elements.importFileInput.value = "";
  elements.importFileInput.click();
});

elements.importFileInput.addEventListener("change", () => {
  const file = elements.importFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);
      // 支持两种格式：直接是 story 对象（含 nodes/edges），或包含 story 字段的 payload
      let payload;
      if (json.nodes && json.edges) {
        // 裸 story 对象，包装成 payload 格式
        payload = { story: json };
      } else if (json.story && json.story.nodes && json.story.edges) {
        payload = json;
      } else {
        throw new Error("JSON 格式不正确：缺少 nodes 或 edges 字段");
      }
      const nodes = payload.story.nodes;
      if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error("nodes 数组为空");
      }
      state.result = payload;
      state.selectedNodeId = null;
      elements.exportBtn.disabled = false;
      elements.sendToUEBtn.disabled = false;
      elements.sendNodesBtn.disabled = false;
      elements.notice.textContent = `已导入 JSON：${nodes.length} 个节点`;
      elements.notice.classList.remove("hidden");
      if (payload.story.selectedStructure) {
        renderSummary(payload);
      }
      renderGraph(payload.story);
      renderNodes(nodes);
    } catch (err) {
      elements.notice.textContent = `导入失败：${err.message}`;
      elements.notice.classList.remove("hidden");
    }
  };
  reader.readAsText(file, "utf-8");
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

elements.sendToUEBtn.addEventListener("click", async () => {
  if (!state.result) return;
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    elements.notice.textContent = "请先输入并验证 API Key";
    elements.notice.classList.remove("hidden");
    return;
  }
  const storyText = state.result.story.expandedStory || state.result.story.storyContext || "";
  if (!storyText) {
    elements.notice.textContent = "无法获取故事文本，请重新生成";
    elements.notice.classList.remove("hidden");
    return;
  }
  setBusy(true, "正在调用 LUA-Skills 生成 Lua 并发送到 UE5...");
  elements.notice.classList.add("hidden");
  try {
    const genResp = await fetch("http://localhost:9000/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story_input: storyText, api_key: apiKey, stages_only: true })
    });
    if (!genResp.ok) {
      const err = await genResp.text();
      throw new Error(`LUA-Skills 生成失败 (${genResp.status}): ${err}`);
    }
    const genData = await genResp.json();
    const stages = Array.isArray(genData) ? genData : (genData.stages || []);
    if (!stages.length) throw new Error("LUA-Skills 返回了空的 stages");
    let sentCount = 0;
    for (const stage of stages) {
      const sendResp = await fetch("http://localhost:9000/api/send-to-unreal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: stage.Type, code: stage.Code })
      });
      if (sendResp.ok) sentCount++;
    }
    elements.notice.textContent = `已发送 ${sentCount}/${stages.length} 个阶段到 UE5`;
    elements.notice.classList.remove("hidden");
  } catch (e) {
    elements.notice.textContent = `发送失败：${e.message}`;
    elements.notice.classList.remove("hidden");
  } finally {
    setBusy(false);
  }
});

elements.sendNodesBtn.addEventListener("click", async () => {
  if (!state.result) return;
  const apiKey = elements.apiKey.value.trim();
  if (!apiKey) {
    elements.notice.textContent = "请先输入并验证 API Key";
    elements.notice.classList.remove("hidden");
    return;
  }
  const story = state.result.story;
  const nodes = story.nodes || [];
  if (!nodes.length) {
    elements.notice.textContent = "没有节点数据，请重新生成";
    elements.notice.classList.remove("hidden");
    return;
  }

  setBusy(true, `正在处理 ${nodes.length} 个节点...`);
  elements.notice.classList.add("hidden");

  try {
    // 1. 获取 InitMap
    const mapResp = await fetch("http://localhost:9000/api/preset-map");
    if (!mapResp.ok) throw new Error("获取 InitMap 失败");
    const mapData = await mapResp.json();
    const initMapCode = mapData.code || "";

    // 2. 构建节点的前置flag和结果flag映射
    const edges = story.edges || [];
    const nodePrereqs = {};  // nodeId -> [flag]
    const nodeResults = {};  // nodeId -> [flag]
    nodes.forEach(n => {
      nodePrereqs[n.id] = [];
      nodeResults[n.id] = [];
      const logic = n.completionLogic;
      if (logic && logic.resultBranches) {
        logic.resultBranches.forEach(b => {
          if (b.appliesWhen) nodeResults[n.id].push(b.appliesWhen);
        });
      }
    });
    // 从 edges 推导前置条件
    edges.forEach(e => {
      if (e.from && e.to) {
        const fromResults = nodeResults[e.from] || [];
        if (fromResults.length) {
          nodePrereqs[e.to] = nodePrereqs[e.to] || [];
          nodePrereqs[e.to].push(...fromResults);
        }
      }
    });

    // 3. 逐节点调用 /api/generate-node
    const encounterLuas = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      setBusy(true, `正在生成节点 ${i + 1}/${nodes.length}: ${node.title || node.id}...`);
      const encPrefix = `enc${String(i + 1).padStart(2, "0")}`;
      const resp = await fetch("http://localhost:9000/api/generate-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node_id: node.id,
          node_plot: node.plot || node.nodePurpose || "",
          node_dialogue: node.keyDialogue || [],
          node_actions: node.keyActions || [],
          completion_logic: node.completionLogic || null,
          prerequisite_flags: nodePrereqs[node.id] || [],
          result_flags: nodeResults[node.id] || [],
          enc_prefix: encPrefix,
          api_key: apiKey
        })
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`节点 ${node.id} 生成失败: ${err}`);
      }
      const data = await resp.json();
      if (data.lua) encounterLuas.push(`-- 节点: ${node.title || node.id}\n${data.lua}`);
    }

    // 4. 合并所有 Encounter 为一个 InitEvent
    const initEventCode = [
      "_G.story_flags = _G.story_flags or {}",
      "",
      ...encounterLuas
    ].join("\n\n");

    // 5. 依次发送 InitMap → InitEvent → StartGame
    const startGameCode = "World.StartGame()\nTime.Resume()\nUI.Toast(\"游戏开始\")";
    const stages = [
      { type: "InitMap", code: initMapCode },
      { type: "InitEvent", code: initEventCode },
      { type: "StartGame", code: startGameCode }
    ];

    let sentCount = 0;
    for (const stage of stages) {
      const sendResp = await fetch("http://localhost:9000/api/send-to-unreal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: stage.type, code: stage.code })
      });
      if (sendResp.ok) sentCount++;
    }

    elements.notice.textContent = `多节点发送完成：${nodes.length} 个节点 → ${sentCount}/3 个阶段已发送到 UE5`;
    elements.notice.classList.remove("hidden");
  } catch (e) {
    elements.notice.textContent = `多节点发送失败：${e.message}`;
    elements.notice.classList.remove("hidden");
  } finally {
    setBusy(false);
  }
});

loadSavedApiKey();
loadSavedModels();
loadSavedUseLocalCharacters();
loadContext();
