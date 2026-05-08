const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const STRUCTURE_DIR = path.join(ROOT, "NodeStructure");
const LEVEL_AI_DIR = findLevelAiDir(ROOT);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function hasLevelAiFiles(directory) {
  return ["NPC.csv", "Item.csv", "Building.csv"].every(file => fsSync.existsSync(path.join(directory, file)));
}

function findLevelAiDir(startDirectory) {
  const candidates = [];

  if (process.env.LEVEL_AI_DIR) {
    candidates.push(path.isAbsolute(process.env.LEVEL_AI_DIR)
      ? process.env.LEVEL_AI_DIR
      : path.resolve(startDirectory, process.env.LEVEL_AI_DIR));
  }

  let current = startDirectory;
  while (true) {
    candidates.push(path.join(current, "Doc", "Level_AI"));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const found = candidates.find(hasLevelAiFiles);
  if (!found) {
    throw new Error("Could not find Doc/Level_AI. Set LEVEL_AI_DIR or keep Doc/Level_AI in a parent folder.");
  }
  return found;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map(header => header.trim()).filter(Boolean);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] || "").trim();
    });
    return row;
  });
}

function deriveNodeRole(id, annotation) {
  if (id === "HUB") return "hub";
  if (annotation && annotation.includes("关键")) return "condition";
  if (/^E\d+$/.test(id)) return "ending";
  return "normal";
}

function parseTargetList(text) {
  return text
    .split(/\s*\/\s*/)
    .map(segment => {
      const match = segment.match(/([A-Za-z][A-Za-z0-9_]*)/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

function parseStructureTopology(content) {
  const topologyText = content.split(/===\s*结构示例\s*===/)[0];
  const rawLines = topologyText.split(/\r?\n/);

  const nodes = [];
  const edges = [];
  const seenNodeIds = new Set();
  let currentNode = null;
  let currentMode = null;

  const commitNode = node => {
    if (!node || seenNodeIds.has(node.id)) return;
    seenNodeIds.add(node.id);
    nodes.push(node);
  };

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (!line) {
      currentMode = null;
      continue;
    }

    if (!line.startsWith("-") && !line.startsWith("→")) {
      const headerMatch = line.match(/^([A-Za-z][A-Za-z0-9_]*)(?:（([^）]+)）)?\s*:?\s*$/);
      if (headerMatch) {
        commitNode(currentNode);
        const id = headerMatch[1];
        const annotation = headerMatch[2] || "";
        currentNode = {
          id,
          annotation,
          role: deriveNodeRole(id, annotation),
          outgoingTargets: []
        };
        currentMode = null;
        continue;
      }
    }

    if (!currentNode) continue;

    if (/^-\s*choices\s*:/.test(line)) {
      currentMode = "choices";
      continue;
    }

    if (/^-\s*condition\s*:/.test(line)) {
      currentMode = "condition";
      currentNode.role = "condition";
      continue;
    }

    if (/^-\s*ending\s*:/.test(line)) {
      currentNode.role = "ending";
      currentMode = null;
      continue;
    }

    const nextMatch = line.match(/^-\s*next\s*:\s*(.+)$/);
    if (nextMatch) {
      for (const target of parseTargetList(nextMatch[1])) {
        if (!currentNode.outgoingTargets.includes(target)) currentNode.outgoingTargets.push(target);
        edges.push({ from: currentNode.id, to: target, kind: "next" });
      }
      currentMode = null;
      continue;
    }

    if (currentMode === "choices") {
      const arrowMatch = line.match(/→\s*([A-Za-z][A-Za-z0-9_]*)/);
      if (arrowMatch) {
        const target = arrowMatch[1];
        if (!currentNode.outgoingTargets.includes(target)) currentNode.outgoingTargets.push(target);
        edges.push({ from: currentNode.id, to: target, kind: "choice" });
      }
      continue;
    }

    if (currentMode === "condition") {
      const condMatch = line.match(/(?:IF|ELSE)[^→]*→\s*([A-Za-z][A-Za-z0-9_]*)/);
      if (condMatch) {
        const target = condMatch[1];
        if (!currentNode.outgoingTargets.includes(target)) currentNode.outgoingTargets.push(target);
        edges.push({ from: currentNode.id, to: target, kind: "condition" });
      }
      continue;
    }
  }
  commitNode(currentNode);

  for (const node of nodes) {
    if (node.role === "ending") continue;
    if (node.outgoingTargets.length === 0 && /^E\d+$/.test(node.id)) {
      node.role = "ending";
    }
  }

  const incomingCount = {};
  for (const node of nodes) incomingCount[node.id] = 0;
  for (const edge of edges) {
    if (incomingCount[edge.to] != null) incomingCount[edge.to] += 1;
  }

  const layerOf = {};
  const startIds = nodes.filter(node => incomingCount[node.id] === 0).map(node => node.id);
  const queue = startIds.map(id => ({ id, layer: 1 }));
  while (queue.length) {
    const { id, layer } = queue.shift();
    if (layerOf[id] && layerOf[id] >= layer) continue;
    layerOf[id] = layer;
    for (const edge of edges) {
      if (edge.from === id) queue.push({ id: edge.to, layer: layer + 1 });
    }
  }
  for (const node of nodes) {
    node.layer = layerOf[node.id] || 1;
  }

  const layerBuckets = {};
  for (const node of nodes) {
    if (!layerBuckets[node.layer]) layerBuckets[node.layer] = [];
    layerBuckets[node.layer].push(node);
  }
  const sortedLayers = Object.keys(layerBuckets).map(Number).sort((a, b) => a - b);
  const layerLines = sortedLayers.map(layer => {
    const ids = layerBuckets[layer]
      .map(node => node.role && node.role !== "normal" ? `${node.id}（${node.role}）` : node.id)
      .join("、");
    return `  层 ${layer}: ${ids}`;
  });
  const edgeLines = edges.map(edge => {
    const tag = edge.kind === "choice" ? "（选择）" : edge.kind === "condition" ? "（条件）" : "";
    return `  ${edge.from} → ${edge.to}${tag}`;
  });

  const summary = [
    `节点总数：${nodes.length}`,
    `节点 id（必须严格复用，不得改名、不得新增、不得删除）：${nodes.map(node => node.id).join("、")}`,
    "层级分布：",
    ...layerLines,
    "连接（必须严格保留，不得增删，不得改向）：",
    ...edgeLines
  ].join("\n");

  return {
    nodeIds: nodes.map(node => node.id),
    nodes: nodes.map(node => ({
      id: node.id,
      role: node.role,
      layer: node.layer,
      outgoingTargets: node.outgoingTargets.slice()
    })),
    edges: edges.slice(),
    layerBuckets: sortedLayers.map(layer => ({
      layer,
      nodeIds: layerBuckets[layer].map(node => node.id)
    })),
    summary
  };
}

const ALLOWED_BRANCHING_KINDS = new Set(["money_at_least", "item_obtained", "affinity_min", "friend", "companion"]);
const FORBIDDEN_OBJECTIVE_KINDS = new Set(["story_flag"]);

function validateStoryConditions(story, topology, structureLabel) {
  const issues = [];
  if (!Array.isArray(story?.nodes)) return { ok: true, issues };

  const conditionNodeIds = new Set(
    (topology?.nodes || []).filter(node => node.role === "condition").map(node => node.id)
  );

  for (const node of story.nodes) {
    if (!node || typeof node !== "object") continue;
    const logic = node.completionLogic || {};
    const type = logic.type || "";
    const isBranching =
      type === "success_or_fail_branch" ||
      type === "exclusive_choice" ||
      conditionNodeIds.has(node.id);

    const objectives = Array.isArray(logic.objectives) ? logic.objectives : [];
    for (const obj of objectives) {
      if (!obj || typeof obj !== "object") continue;
      const kind = String(obj.kind || "");
      if (FORBIDDEN_OBJECTIVE_KINDS.has(kind)) {
        issues.push(`节点 ${node.id} 的 completionLogic.objectives 出现了禁用 kind '${kind}'（target='${obj.target || ""}'）：story_flag 不得用于条件判定，只能在 results 里出现。`);
      }
      if (isBranching && kind && !ALLOWED_BRANCHING_KINDS.has(kind) && !FORBIDDEN_OBJECTIVE_KINDS.has(kind)) {
        issues.push(`节点 ${node.id}（branching, type=${type || "condition_gate"}）的 objectives 使用了非允许 kind '${kind}'：branching 节点的条件只能用 money_at_least / item_obtained / affinity_min / friend / companion。`);
      }
    }

    const branches = Array.isArray(logic.resultBranches) ? logic.resultBranches : [];
    if (isBranching) {
      const branchTos = [];
      for (const branch of branches) {
        if (!branch || typeof branch !== "object") continue;
        const appliesWhen = String(branch.appliesWhen || "");
        if (/\bstory_flag\b/i.test(appliesWhen)) {
          issues.push(`节点 ${node.id} 的 resultBranches[branchId='${branch.branchId || "?"}'].appliesWhen 引用了 story_flag：分支条件不得使用 story_flag。`);
        }
        const to = Array.isArray(branch.to) ? branch.to : [];
        if (to.length !== 1) {
          issues.push(`节点 ${node.id} 的 resultBranches[branchId='${branch.branchId || "?"}'].to 长度应为 1，实际为 ${to.length}：每条分支必须 1:1 对应一个下游节点。`);
        }
        branchTos.push(...to);
      }
      const dupTargets = branchTos.filter((id, idx) => id && branchTos.indexOf(id) !== idx);
      if (dupTargets.length > 0) {
        issues.push(`节点 ${node.id} 的不同分支命中了同一个下游节点 ${[...new Set(dupTargets)].join("、")}：不同条件不允许殊途同归到同一节点。`);
      }
    }
  }

  if (issues.length > 0) {
    console.warn(`[condition-check] 结构 ${structureLabel || ""} 条件校验发现 ${issues.length} 项问题：`);
    for (const issue of issues) console.warn(`  - ${issue}`);
  } else {
    console.log(`[condition-check] 结构 ${structureLabel || ""} 条件校验通过。`);
  }

  return { ok: issues.length === 0, issues };
}

function validateStoryAgainstTopology(story, topology, structureLabel) {
  const issues = [];
  if (!topology || !Array.isArray(topology.nodes) || topology.nodes.length === 0) {
    return { ok: true, issues };
  }

  const expectedIds = new Set(topology.nodeIds);
  const actualNodes = Array.isArray(story.nodes) ? story.nodes : [];
  const actualNodeIds = new Set(actualNodes.map(node => node?.id).filter(Boolean));

  for (const expectedId of expectedIds) {
    if (!actualNodeIds.has(expectedId)) {
      issues.push(`缺失节点 ${expectedId}：拓扑要求该节点存在，但生成结果中没有找到。`);
    }
  }
  for (const actualId of actualNodeIds) {
    if (!expectedIds.has(actualId)) {
      issues.push(`多余节点 ${actualId}：拓扑里没有该 id，模型擅自加了节点或改了 id。`);
    }
  }

  const expectedLayerById = {};
  for (const node of topology.nodes) expectedLayerById[node.id] = node.layer;
  for (const node of actualNodes) {
    if (!node || !expectedIds.has(node.id)) continue;
    const expectedLayer = expectedLayerById[node.id];
    if (expectedLayer != null && Number(node.layer) !== expectedLayer) {
      issues.push(`节点 ${node.id} 的层级应为 ${expectedLayer}，实际为 ${node.layer}。`);
    }
  }

  const expectedOutgoing = {};
  for (const node of topology.nodes) expectedOutgoing[node.id] = new Set(node.outgoingTargets);
  for (const node of actualNodes) {
    if (!node || !expectedIds.has(node.id)) continue;
    const expectedSet = expectedOutgoing[node.id] || new Set();
    const actualSet = new Set(Array.isArray(node.next) ? node.next : []);
    for (const target of expectedSet) {
      if (!actualSet.has(target)) issues.push(`节点 ${node.id} 应有 next → ${target}，实际缺失。`);
    }
    for (const target of actualSet) {
      if (!expectedSet.has(target)) issues.push(`节点 ${node.id} 多了 next → ${target}，拓扑里没有这条出边。`);
    }
  }

  const expectedEdgeKeys = new Set(topology.edges.map(edge => `${edge.from}->${edge.to}`));
  const actualEdges = Array.isArray(story.edges) ? story.edges : [];
  const actualEdgeKeys = new Set(actualEdges.map(edge => edge ? `${edge.from}->${edge.to}` : "").filter(Boolean));
  for (const key of expectedEdgeKeys) {
    if (!actualEdgeKeys.has(key)) issues.push(`缺失边 ${key}：拓扑要求该连接存在，生成结果里没有。`);
  }
  for (const key of actualEdgeKeys) {
    if (!expectedEdgeKeys.has(key)) issues.push(`多余边 ${key}：拓扑里没有这条连接。`);
  }

  for (const node of topology.nodes) {
    if (node.role !== "ending") continue;
    const actualNode = actualNodes.find(n => n && n.id === node.id);
    if (actualNode) {
      const nextArr = Array.isArray(actualNode.next) ? actualNode.next : [];
      if (nextArr.length > 0) issues.push(`结局节点 ${node.id} 的 next 应为空，实际为 [${nextArr.join(", ")}]。`);
    }
  }

  if (issues.length > 0) {
    console.warn(`[topology-check] 结构 ${structureLabel || ""} 校验未通过，共 ${issues.length} 项：`);
    for (const issue of issues) console.warn(`  - ${issue}`);
  } else {
    console.log(`[topology-check] 结构 ${structureLabel || ""} 校验通过。`);
  }

  return {
    ok: issues.length === 0,
    issues,
    expected: {
      nodeIds: topology.nodeIds,
      edges: topology.edges
    },
    actual: {
      nodeIds: Array.from(actualNodeIds),
      edges: Array.from(actualEdgeKeys).map(key => {
        const [from, to] = key.split("->");
        return { from, to };
      })
    }
  };
}

async function readStructures() {
  const entries = await fs.readdir(STRUCTURE_DIR, { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const structures = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(STRUCTURE_DIR, file.name), "utf8");
    structures.push({
      id: path.basename(file.name, ".txt"),
      file: file.name,
      content,
      topology: parseStructureTopology(content)
    });
  }
  return structures;
}

async function readLevelData() {
  const [npcsText, itemsText, buildingsText] = await Promise.all([
    fs.readFile(path.join(LEVEL_AI_DIR, "NPC.csv"), "utf8"),
    fs.readFile(path.join(LEVEL_AI_DIR, "Item.csv"), "utf8"),
    fs.readFile(path.join(LEVEL_AI_DIR, "Building.csv"), "utf8")
  ]);

  return {
    relativePath: path.relative(ROOT, LEVEL_AI_DIR) || ".",
    npcs: parseCsv(npcsText).map(row => ({
      name: row.npc_name,
      type: row.npc_type,
      state: row.current_state,
      affinity: row.current_affinity,
      background: row.npc_background,
      importance: (row.npc_importance || "").toLowerCase().trim() === "important" ? "important" : (row.npc_importance ? "secondary" : ""),
      personality: row.npc_personality || "",
      archetype: row.npc_archetype || "",
      speakingStyle: row.npc_speaking_style || "",
      speakingExamples: (row.npc_speaking_examples || "")
        .split("|")
        .map(line => line.trim())
        .filter(Boolean),
      emotionalArc: row.npc_emotional_arc || "",
      coreMotivation: row.npc_core_motivation || ""
    })).filter(row => row.name),
    items: parseCsv(itemsText).map(row => ({
      name: row.item_name,
      resource: row.item_resource,
      description: row.item_description
    })).filter(row => row.name),
    buildings: parseCsv(buildingsText).map(row => ({
      name: row.building_name,
      resource: row.building_resouce,
      description: row.building_description
    })).filter(row => row.name)
  };
}

function structureGuide() {
  return [
    {
      id: "1",
      name: "双线分支交错汇合",
      bestFor: "故事从一个开端分成两种做法或两个立场，中段互相影响并产生三种局部变化，最后逐步汇合到共同结果。",
      avoidWhen: "故事的重点不是两条路线互相影响，而是单次关键判定、中心枢纽探索或多个结局。"
    },
    {
      id: "2",
      name: "双线交叉推进",
      bestFor: "故事有两条路线、两个阵营、两种身份或两组线索，并且一条路线的行动会交叉影响另一条路线。",
      avoidWhen: "故事没有明显的交叉错位关系，只是多个平级选择或单一路线推进。"
    },
    {
      id: "3",
      name: "中心 HUB 多路线",
      bestFor: "故事有一个明确的中心地点、中心事件或任务枢纽，多个平级路线都从这里出发并回到这里，例如调查、招募、筹备或谈判。",
      avoidWhen: "故事虽然有多个选择，但没有中心枢纽，或分支更像交叉推进、条件判定、多结局。"
    },
    {
      id: "4",
      name: "关键条件分流",
      bestFor: "故事核心在一次关键条件检查，例如证据、关系、资源、阵营态度或道德选择，不同条件导致不同后果。",
      avoidWhen: "故事重点是长期多线探索、交叉路线或多个最终结局，而不是一个关键分流点。"
    },
    {
      id: "5",
      name: "多结局分支",
      bestFor: "故事需要多个明确结局，前中期选择会影响最终走向，例如和解、牺牲、失败、公开胜利或秘密胜利。",
      avoidWhen: "故事最终应汇合到一个共同结果，只是过程有不同路线。"
    }
  ];
}

async function callOpenAI(apiKey, payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data.error?.message || data.raw || `OpenAI request failed with ${response.status}.`;
    throw new Error(message);
  }

  return data;
}

function extractText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n");
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model response was not valid JSON.");
  }
}

function normalizeApiKey(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "");
}

function validateApiKey(apiKey) {
  if (!apiKey) {
    return "API key is required.";
  }
  if (!/^[\x21-\x7E]+$/.test(apiKey)) {
    return "API key 只能包含英文、数字和符号，请确认没有粘贴中文、空格或说明文字。";
  }
  if (!apiKey.startsWith("sk-")) {
    return "API key 格式看起来不对，通常应以 sk- 开头。";
  }
  return "";
}

function storySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["selectedStructure", "reason", "adaptation", "storyContext", "designDeck", "expandedStory", "layerNotes", "nodes", "edges"],
    properties: {
      selectedStructure: {
        type: "object",
        additionalProperties: false,
        required: ["id", "file", "name"],
        properties: {
          id: { type: "string" },
          file: { type: "string" },
          name: { type: "string" }
        }
      },
      reason: { type: "string" },
      adaptation: {
        type: "object",
        additionalProperties: false,
        required: ["sourceTheme", "keptSpirit", "changedSurface", "newAdventurePromise"],
        properties: {
          sourceTheme: { type: "string" },
          keptSpirit: { type: "string" },
          changedSurface: { type: "string" },
          newAdventurePromise: { type: "string" }
        }
      },
      storyContext: {
        type: "object",
        additionalProperties: false,
        required: ["playerRole", "mainConflict", "priorIncident", "stakes"],
        properties: {
          playerRole: { type: "string" },
          mainConflict: { type: "string" },
          priorIncident: { type: "string" },
          stakes: { type: "string" }
        }
      },
      designDeck: {
        type: "object",
        additionalProperties: false,
        required: [
          "premiseCard",
          "conflictCard",
          "locationCard",
          "npcCards",
          "itemCards",
          "twistCard",
          "costCard",
          "resolutionCard"
        ],
        properties: {
          premiseCard: { type: "string" },
          conflictCard: { type: "string" },
          locationCard: { type: "string" },
          npcCards: { type: "array", items: { type: "string" } },
          itemCards: { type: "array", items: { type: "string" } },
          twistCard: { type: "string" },
          costCard: { type: "string" },
          resolutionCard: { type: "string" }
        }
      },
      expandedStory: { type: "string" },
      layerNotes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["layer", "purpose", "peerRule"],
          properties: {
            layer: { type: "integer" },
            purpose: { type: "string" },
            peerRule: { type: "string" }
          }
        }
      },
      nodes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "layer",
            "title",
            "nodePurpose",
            "startState",
            "plot",
            "keyDialogue",
            "keyActions",
            "nodeOutcome",
            "npcs",
            "items",
            "locations",
            "completionCondition",
            "completionLogic",
            "next"
          ],
          properties: {
            id: { type: "string" },
            layer: { type: "integer" },
            title: { type: "string" },
            nodePurpose: { type: "string" },
            startState: { type: "string" },
            plot: { type: "string" },
            keyDialogue: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["speaker", "line", "intent"],
                properties: {
                  speaker: { type: "string" },
                  line: { type: "string" },
                  intent: { type: "string" }
                }
              }
            },
            keyActions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["actor", "action", "intent"],
                properties: {
                  actor: { type: "string" },
                  action: { type: "string" },
                  intent: { type: "string" }
                }
              }
            },
            nodeOutcome: { type: "string" },
            npcs: { type: "array", items: { type: "string" } },
            items: { type: "array", items: { type: "string" } },
            locations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 1 },
            completionCondition: { type: "string" },
            completionLogic: {
              type: "object",
              additionalProperties: false,
              required: ["type", "summary", "expression", "objectives", "results", "resultBranches"],
              properties: {
                type: { type: "string" },
                summary: { type: "string" },
                expression: { type: "string" },
                objectives: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "kind", "target", "operator", "value", "text"],
                    properties: {
                      id: { type: "string" },
                      kind: { type: "string" },
                      target: { type: "string" },
                      operator: { type: "string" },
                      value: { type: "string" },
                      text: { type: "string" }
                    }
                  }
                },
                results: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["kind", "target", "change", "delta", "text"],
                    properties: {
                      kind: { type: "string" },
                      target: { type: "string" },
                      change: { type: "string" },
                      delta: { type: "string" },
                      text: { type: "string" }
                    }
                  }
                },
                resultBranches: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["branchId", "appliesWhen", "to", "results"],
                    properties: {
                      branchId: { type: "string" },
                      appliesWhen: { type: "string" },
                      to: { type: "array", items: { type: "string" } },
                      results: {
                        type: "array",
                        items: {
                          type: "object",
                          additionalProperties: false,
                          required: ["kind", "target", "change", "delta", "text"],
                          properties: {
                            kind: { type: "string" },
                            target: { type: "string" },
                            change: { type: "string" },
                            delta: { type: "string" },
                            text: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            next: { type: "array", items: { type: "string" } }
          }
        }
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to", "label", "transition", "carriedResults"],
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            label: { type: "string" },
            transition: { type: "string" },
            carriedResults: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  };
}

function storyFoundationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["adaptation", "storyContext", "designDeck", "expandedStory", "layerNotes"],
    properties: {
      adaptation: storySchema().properties.adaptation,
      storyContext: storySchema().properties.storyContext,
      designDeck: storySchema().properties.designDeck,
      expandedStory: { type: "string" },
      layerNotes: storySchema().properties.layerNotes
    }
  };
}

function nodeBlueprintSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["nodes", "edges"],
    properties: {
      nodes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "layer", "title", "nodePurpose", "storyMoment", "stateFocus", "conditionIdea", "next"],
          properties: {
            id: { type: "string" },
            layer: { type: "integer" },
            title: { type: "string" },
            nodePurpose: { type: "string" },
            storyMoment: { type: "string" },
            stateFocus: { type: "string" },
            conditionIdea: { type: "string" },
            next: { type: "array", items: { type: "string" } }
          }
        }
      },
      edges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to", "label", "expectedCarriedResults"],
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            label: { type: "string" },
            expectedCarriedResults: { type: "array", items: { type: "string" } }
          }
        }
      }
    }
  };
}

function narrativeSystemPrompt() {
  return [
    "You are a senior game narrative designer for a node-based RPG story system.",
    "Write in Simplified Chinese.",
    "Use only NPCs, items, and locations from the provided Level_AI data.",
    "",
    "## Story adaptation",
    "If the user gives a famous story, myth, historical scene, or literary plot, do not mechanically reskin its surface. First extract its durable dramatic theme, then adapt that theme into a new story using the available NPCs, items, and locations.",
    "For example, 桃园结义 should become a story about three like-minded people choosing sworn fellowship and a shared adventure under pressure. It should not require Liu Bei, Guan Yu, Zhang Fei, a literal peach garden, or the exact original events.",
    "The adaptation must preserve the emotional engine: why these people need each other, what risk makes the vow meaningful, what future adventure the vow opens, and what playable actions prove the bond.",
    "",
    "## Story foundation",
    "Before writing nodes, define storyContext: playerRole, mainConflict, priorIncident, and stakes. These are the facts the player must understand to role-play well.",
    "Use a Fabula-like and tabletop DND-like card deal before writing: premise card, conflict card, location card, NPC face cards, item clue/cost cards, twist card, cost card, and resolution card. Put the final deal into designDeck.",
    "Keep the story straightforward. Use one main conflict, one main opposition force, and one clear goal. Branches should be different ways to solve the same main problem, not new subplots.",
    "Avoid unnecessary twists, fake clues, hidden debts, extra witnesses, or bait plans when a simpler cause-and-effect path works.",
    "",
    "## Cast and structure discipline",
    "Treat the selected structure as layers. Nodes in the same layer are peer narrative options, not main/sub branches. They must have comparable length, stakes, usefulness, and dramatic weight.",
    "Do not let same-layer nodes repeat the same scene with renamed NPCs. Each peer node should express a different method, risk, moral angle, or information route.",
    "The Level_AI npcs already split the cast into important characters (importance = 'important') and secondary characters (importance = 'secondary').",
    "Build the main story around the important characters. Every layer should feature at least one important character on stage. The main antagonist and the key supporter must each appear in multiple nodes.",
    "Secondary characters fill out specific scenes — a vendor, a witness, a guard, a gossiper, an atmosphere NPC. Use them for color and small services, but do not let a secondary character carry the main conflict.",
    "Limit the core props to 3 to 5 important items across the story. Do not mention many items just because they exist in Level_AI data.",
    "Each node should usually contain no more than 3 named NPCs and 2 important items. If more appear, they must have a direct role in that node.",
    "Each node MUST contain EXACTLY ONE location. The `locations` array MUST have length 1, never 0 and never 2+. Pick the single place where this scene physically happens — the spot the camera would be on if you filmed the scene. The location name MUST come from `levelData.buildings` (do not invent or rename a place). If two places feel relevant, pick the one where the dialogue and key actions happen, and reference the other place verbally inside keyDialogue or plot prose instead of adding it to `locations`. Two consecutive nodes MAY share the same location, but a single node MUST NOT span two locations.",
    "Avoid nested choices inside a branch. A branch may have steps, but it should not split into another mini-branch unless the selected structure explicitly requires it.",
    "Avoid stacking several condition words in one paragraph, such as 若选择..., 若选择..., 若已有..., 若已有.... Put choices into separate labeled branch sections.",
    "",
    "## Selected structure topology — STRICT, NON-NEGOTIABLE",
    "The selected structure is provided as `selectedStructure`, which includes both the human-readable structure file (`selectedStructure.content`) and a parsed topology (`selectedStructure.topology`). Treat the topology as the binding contract.",
    "`selectedStructure.topology.nodeIds` lists the EXACT node ids you must use. You MUST output exactly these ids — same spelling, same casing — as the `id` of each node. Do not rename them (no `node_1`, `start`, `n2a` lowercase, `Hub`, `End1`, etc.). Do not add new ids beyond this list. Do not omit any id from this list. The number of nodes in your output MUST equal the number in `nodeIds`.",
    "`selectedStructure.topology.edges` lists the EXACT directed edges. You MUST reproduce every edge with matching `from` and `to`. Do not add edges. Do not remove edges. Do not flip directions. Do not redirect a target.",
    "`selectedStructure.topology.layerBuckets` defines which layer each node belongs to. Each generated node's `layer` MUST equal the layer specified there.",
    "Each node's `next` array MUST equal that node's `outgoingTargets` from the topology, in the same order as listed there.",
    "If the topology provides no outgoing edge for a node (e.g. the final node, or any node with role='ending'), that node's `next` MUST be `[]` and there MUST be no edge whose `from` equals that node's id.",
    "If the topology marks a node with role='hub' (e.g. `HUB`), that node MUST be implemented as a hub: its completionLogic.type MUST be `exclusive_choice`, and the player visibly returns to it between branches. Its id MUST stay exactly `HUB` (uppercase).",
    "If the topology marks a node with role='condition' (e.g. `N3` in 关键条件分流), that node is the single critical condition gate. Its completionLogic.type MUST be `success_or_fail_branch` when the topology gives it 2 outgoing targets, or `exclusive_choice` when it gives it 3+ outgoing targets. The branch outcomes must map 1:1 to those outgoing targets.",
    "If the topology marks nodes with role='ending' (e.g. `E1`, `E2`, `E3`), each ending node MUST be terminal: `next=[]`, no outgoing edges, completionLogic.type='single_path_gate', and resultBranches=[]. The story content of each ending must be a distinct final outcome — different consequences, different player position, different state. Do not collapse two endings into the same outcome.",
    "Convergence nodes that have multiple incoming edges from different branches MUST acknowledge both incoming states in `startState`, written as conditional alternatives (e.g. 如果玩家走的是 N3A 路线... / 如果玩家走的是 N3B 路线...).",
    "When the topology has crossing edges (e.g. structure 2's `N2A → N3B` and `N2B → N3A`), preserve the cross exactly. The whole point of that structure is that the line started in one route ends up in the scene of the other route.",
    "Do not invent extra layers, intermediate nodes, sub-branches, or shortcut paths. The topology is the entire shape of the story.",
    "",
    "## Character dossier — read before writing any line",
    "Some NPC entries include a richer profile: importance, archetype, personality, speakingStyle, speakingExamples, emotionalArc, coreMotivation. When these fields are present and non-empty, treat them as binding constraints, not flavor text. When they are missing or empty (e.g. local NPC data without a profile), fall back to the NPC's state and background.",
    "If an NPC has importance = 'important' with profile fields, build the main story around that NPC. Every layer should feature at least one important NPC on stage; the main antagonist and the key supporter must each appear in multiple nodes.",
    "If an NPC has importance = 'secondary', use them for color, small services, atmosphere, or single-fact delivery. Do not let a secondary NPC carry the main conflict, and do not invent detailed archetype-driven motives for them.",
    "When writing keyDialogue for an important NPC with speakingExamples, the new line must sound like those examples: same rhythm, same vocabulary range, same attitude. Do not give two different important NPCs interchangeable lines.",
    "When writing keyActions for an important NPC with archetype + personality + coreMotivation, the action must be consistent with all three. 冒险型 tends to take risks and move first; 治愈型 protects, calms, or restores; 学术型 tests evidence and asks precise questions; do not flip these without a story reason.",
    "Across nodes, each important NPC's emotional state must move along their emotionalArc, reacting to what the player and other NPCs do. Do not reset their attitude back to the start state in later nodes once it has shifted.",
    "Each important NPC's coreMotivation must visibly drive at least one keyDialogue or keyAction in any node where they appear. The player should be able to infer what this NPC wants from how they speak and act.",
    "",
    "## NPC-driven scene writing — this is the most important rule",
    "The player understands the story almost entirely through what NPCs say and do, plus visible items and locations. Background facts must enter the scene through NPC behavior, not through narrator exposition.",
    "Each node is a small playable scene. Write it like an RPG cutscene: who is here, who walks where, what is on the table, who speaks first, what they say, how others react.",
    "Use plain words, short sentences, and concrete actions: who walks toward whom, who picks up an object, who blocks a door, who looks away, who slams coins down.",
    "Do not write ornate prose. Do not summarize emotion in narrator voice. Show emotion through action and dialogue.",
    "Do not erase the player. Use optional wording such as 玩家可以..., 若玩家..., 玩家能通过..., 可由玩家选择..., instead of stating the action already happened.",
    "Do not narrate optional player behavior as already completed in expandedStory, plot, startState, or nodeOutcome. Avoid sentences like 玩家已经..., 玩家先做了..., 玩家发现了... unless framed as an option or condition.",
    "Do not output separate playerOptions or contextFacts fields. Player-facing actions belong in completionCondition, completionLogic, edge labels, and transitions.",
    "",
    "## Required structured fields per node: keyDialogue and keyActions",
    "Every node with at least one NPC must produce a generous, scene-length record of NPC speech and behavior, not a sparse summary.",
    "keyDialogue: 6 to 12 entries. Treat dialogue as full beats — question + answer, accusation + denial, demand + condition, plea + refusal, threat + counter. The same NPC can speak multiple times in a beat, and different NPCs should react to each other.",
    "keyActions: at least 4 entries, ideally 5 to 7, up to 9 if more NPCs are present. Spread the actions across the scene — entering, reacting, escalating, retreating — not all bunched at one moment.",
    "keyDialogue items: { speaker: NPC name from Level_AI; line: a direct quote in Chinese; intent: one sentence explaining what fact, motive, pressure, or reaction this line delivers to the player }.",
    "keyActions items: { actor: NPC name from Level_AI; action: a concrete physical action in Chinese, e.g. 把铜币塞进袖筒、走向火炉、拦在门口、把酒瓶推到玩家面前; intent: one sentence explaining what this action signals or sets up }.",
    "keyActions must describe NPC behavior only. Do not put player actions there. Player choices belong in completionLogic.objectives.",
    "Together, keyDialogue and keyActions must cover: (1) the cause of the conflict and any prior incident, (2) who blocks the goal and why, (3) the visible stakes and pressure on the player, (4) at least two distinct hooks the player can act on, (5) the emotional reaction of NPCs to the unfolding situation.",
    "Order keyDialogue and keyActions roughly in the chronological order they occur in the scene, so the reader can follow the beat-by-beat flow.",
    "",
    "## Dialogue richness — anti-fragmentation rules (CRITICAL)",
    "Lines must be self-explanatory in context. The player should NEVER see a cryptic line whose meaning depends on knowledge they do not have. If a line refers to a prior event, a person, a debt, or a promise, that referent must be either named in the same line, named in the previous 1-2 lines from another speaker, OR fully captured in the line's `intent` field.",
    "Replace fragmented one-shot lines with full beats. A beat is question + answer, accusation + denial, demand + condition, plea + refusal. Every beat must close: do not leave dangling references that no other line picks up.",
    "Per-line length: 12 to 50 Chinese characters is the target zone. Up to 80 characters is allowed when an NPC must explain a cause or set the stakes. Lines under 8 characters are only allowed as immediate emotional reactions to a longer explanatory line directly before them.",
    "Cause-with-action rule: when an NPC asks for something, threatens, refuses, or blocks the player, the same NPC (or another NPC in the same beat) MUST give the reason within the same scene — preferably embedded in the same line, or in the next line. Examples of a complete causal line: '钱先放下。这酒馆去年被抢过两次，新面孔我都得收押金。' / '我不能作证。三个月前作证的老何，第二天就在港口溺死了，他家人现在还不敢回话。' / '别信他。他三天前刚收了我表哥三十金币要送货，今天东西全没了，他人却照样在这里喝。'",
    "Continuity-of-thread rule: once a fact is introduced (a debt, a betrayal, a missing item, a past death, a vow), at least one later keyDialogue line OR keyAction must reference it again before the scene ends. Do not abandon hooks.",
    "Forbidden output styles — DO NOT generate these:",
    "  (a) Lone interjections like '唔。', '哼。', '哦？' standing alone without a substantive line right next to them from the same speaker.",
    "  (b) Elliptical lines like '你应该懂的。' / '不该问的别问。' as the ONLY content from a speaker — they must be followed by an explanatory line in the same beat that says what they are talking about.",
    "  (c) Lines that name an unnamed prior incident such as '那件事' / '上次那回' / '老规矩' without ever explaining what the event was elsewhere in keyDialogue or keyActions.",
    "  (d) Decorative atmosphere lines that carry no fact, motive, or reaction — every line must do narrative work.",
    "Opening rule — within the FIRST 3 keyDialogue entries, an NPC must concretely state (i) what the immediate situation is, (ii) what they want from the player or what is being denied, and (iii) WHY now (the prior incident or the time pressure). This may be split across speakers if more than one NPC is on stage. Use 'intent' to fill any context the spoken line cannot carry by itself.",
    "Closing rule — within the LAST 2 keyDialogue entries, an NPC must clearly leave the player a hook: state a price (具体金额、具体道具、具体名誉门槛), name the option, or pose a yes/no question. The player must walk away from the scene knowing exactly what to attempt next, not guessing.",
    "Backstory leak rule — for every important NPC on stage, at least ONE keyDialogue line must let the NPC reveal a fragment of their personal background or motivation that explains their current stance. Use the NPC's known background, coreMotivation, and emotionalArc as source material; do not invent contradictory backstory.",
    "Examples of useful explanatory dialogue (use this richness, not less):",
    "  - '他三天前收了我十金币要带的话，转头就把信卖给了对面阵营，所以我们今天才会在这里对峙。'",
    "  - '这瓶酒不是吧台的，是他从袖子里拿出来的；老榆酒馆去年才换过老板，他根本没资格碰库房。'",
    "  - '我不敢作证，因为上次作证的老何半夜被人塞进河里，第二天才被人发现。我女儿还在镇上读书。'",
    "  - '把徽章交出来，否则天亮前你出不了这扇门。这是镇议事会三个月前贴的告示，店主一指认就生效。'",
    "Every important dialogue line should be paired with surrounding context — either the dialogue's intent field, an adjacent keyAction, or the plot prose — so the player understands what the line refers to and why it matters.",
    "Plot prose must remain consistent with keyDialogue and keyActions. Do not introduce contradictory dialogue or actions in plot that are not represented in those structured fields.",
    "",
    "## plot, startState, and nodeOutcome",
    "startState means the world and NPC situation when this node becomes available. It is not a dramatic hook and must not prescribe player behavior. For non-start nodes, it must clearly connect to at least one incoming edge transition.",
    "plot is a 6 to 10 sentence scene narration that ties together the keyDialogue and keyActions. It should describe where the scene is, who is doing what, and how the situation moves toward the completion objectives. It must mention or use at least one relevant item or location and reference the NPC behavior captured in keyActions.",
    "Each node plot should feel like a complete small scene: opening situation, NPC conflict or pressure, important visible action, choice pressure on the player, and the state that points toward the completion condition.",
    "nodeOutcome means what has changed when the node condition is satisfied, written as a state change rather than a guaranteed player action. 2 to 3 plain sentences. It must prepare the next node's startState.",
    "Maintain continuity across nodes. If an NPC, item, threat, promise, or clue appears in one node and matters later, carry it forward explicitly instead of resetting the scene.",
    "",
    "## Player advancement through tasks, not narration",
    "The player advances the story by making choices and completing tasks: 筹集金钱、获得道具、把道具交给某 NPC、说服某 NPC（让其成为朋友/伙伴或同意做某事）、击败某 NPC、与某 NPC 成为朋友/伙伴、提升好感度、提升名誉、避免成为某人敌人、为某 NPC 出面作证 等。",
    "Each node's completionCondition must read like an obvious quest objective, not like dramatic narration. Players must know what they need to do to leave the node.",
    "completionLogic.summary should be one short sentence summarizing the player's current task in the scene, e.g. 帮 Alice 筹齐 100 金币并说服 Borin 成为伙伴.",
    "completionLogic.expression must use AND/OR/NOT explicitly and stay readable. Examples: friend:Alice AND money >= 100; item:黑玻苦啤 AND affinity:Raven >= 6; companion:Torin OR companion:Raven; defeated:Darius AND NOT enemy:Alice.",
    "",
    "## Task patterns — every node MUST pick exactly ONE of these three patterns",
    "Every node's completionLogic.type MUST be EXACTLY one of: 'single_path_gate', 'success_or_fail_branch', or 'exclusive_choice'. Never invent other type values; never leave it free-form.",
    "Pick the pattern from the player's actual choice space at this node, then build objectives, results, resultBranches, node.next, and outgoing edges to match.",
    "",
    "### Pattern 1 — single_path_gate (必须通关)",
    "Use when the player MUST satisfy a hard requirement before they can continue, with NO alternate failure path. If they fail, they stay stuck at this node and can retry. This also covers 'parallel collect' (multiple objectives joined by AND).",
    "Typical examples: 战胜守门怪物才能通过, 凑齐 100 金币才能进城, 同时拿到证人和物证才能开庭.",
    "Required shape:",
    "  - completionLogic.type = 'single_path_gate'",
    "  - completionLogic.objectives: 1 or more required objectives, AND-combined. Use expression like 'defeated:Darius' or 'item:黑玻苦啤 AND money >= 100'.",
    "  - completionLogic.results: world-state changes that ALWAYS fire on completion (no alternate outcomes here).",
    "  - completionLogic.resultBranches: MUST be an empty array [].",
    "  - node.next: EXACTLY ONE downstream id, e.g. ['N3'].",
    "  - Outgoing edges: EXACTLY ONE edge from this node, label like '继续推进', '通过此关', '进入下一阶段'.",
    "",
    "### Pattern 2 — success_or_fail_branch (成败分流)",
    "Use when ONE critical attempt has a binary outcome and the story continues either way along DIFFERENT downstream nodes.",
    "Typical examples: 说服 Alice 成功走和解线, 失败走对抗线; 战胜 Darius 走胜利线, 战败走被囚禁线.",
    "Required shape:",
    "  - completionLogic.type = 'success_or_fail_branch'",
    "  - completionLogic.objectives: list ONLY the success-side check (e.g. friend:Alice or defeated:Darius). The branch decides which side fires.",
    "  - completionLogic.results: empty [], OR only results that fire regardless of outcome (rare).",
    "  - completionLogic.resultBranches: EXACTLY 2 entries.",
    "      branchId='success', appliesWhen='玩家成功 ...', to=[N成功], results=[正面结果]",
    "      branchId='failure', appliesWhen='玩家未能 ...', to=[N失败], results=[负面结果或代价，例如 enemy/affinity 下降/money 损失]",
    "  - The two branches' .to arrays MUST point to DIFFERENT downstream node ids; success and failure must NOT converge to the same node here.",
    "  - node.next: EXACTLY two ids, success first then failure, e.g. ['N3A','N3B'].",
    "  - Outgoing edges: EXACTLY two edges from this node, e.g. label='说服成功' / label='说服失败' or label='击败 Darius' / label='败给 Darius'.",
    "",
    "### Pattern 3 — exclusive_choice (互斥多选)",
    "Use when the player has 2 to 4 mutually exclusive options at this node; choosing one closes the others.",
    "Typical examples: 与 Alice / Borin / Selene 三人之一成为朋友, 把徽章交给 Alice 或交给 Borin, 接下 X 阵营或 Y 阵营的委托.",
    "Required shape:",
    "  - completionLogic.type = 'exclusive_choice'",
    "  - completionLogic.objectives: list each possible choice as a SEPARATE objective (one per option). They are OR-combined in expression. Example expression: 'friend:Alice OR friend:Borin OR friend:Selene'.",
    "  - completionLogic.results: empty []. All consequences are per-branch.",
    "  - completionLogic.resultBranches: 2 to 4 entries — ONE branch per choice. Each branch.to MUST contain a SINGLE downstream node id, and the .to arrays across branches MUST NOT overlap.",
    "  - Each branch.results MUST encode mutual exclusion: include BOTH (a) the chosen relation/state becoming true (e.g. friend:Alice set true) AND (b) results that close the other choices (e.g. route 'Borin 友谊线' close, route 'Selene 友谊线' close, OR affinity:Borin -2, etc.). Use route close, friend set false, or affinity decrease as the closing mechanism.",
    "  - node.next: list every downstream id once, in branch order, e.g. ['N3A','N3B','N3C'].",
    "  - Outgoing edges: ONE edge per choice; labels reference the choice itself, e.g. '选择 Alice', '选择 Borin', '选择 Selene' or '把徽章交给 Alice', '把徽章交给 Borin'.",
    "",
    "## Pattern selection rules",
    "- A 'gate that must be passed before continuing' → single_path_gate.",
    "- The same checkable attempt branching the story into two different downstream lines → success_or_fail_branch.",
    "- The player picks among 2 or more identifiable, comparable options that close each other → exclusive_choice.",
    "- A node has EXACTLY ONE pattern. Do not mix.",
    "- Convergence (汇合) nodes are typically single_path_gate — players just need to arrive with carried state.",
    "- Terminal endings have no outgoing edges and no next; treat the final layer as single_path_gate with node.next=[] and resultBranches=[]; this is the only legal way to end.",
    "- Pattern choice must be consistent with the selected node structure. For 双线分支交错汇合 (1) and 关键条件分流 (4), success_or_fail_branch and exclusive_choice are common; for 中心 HUB 多路线 (3), exclusive_choice belongs at the hub; for 多结局分支 (5), use exclusive_choice or success_or_fail_branch at the divergence point.",
    "",
    "## Branching condition vocabulary — RESTRICTED to 5 categories (HARD RULE)",
    "Definition: a node is a 'branching node' iff its completionLogic.type is `success_or_fail_branch` or `exclusive_choice`, OR it is the topology condition gate (role='condition', e.g. N3 in 关键条件分流). Every condition that decides which downstream branch fires at a branching node is a 'branching condition'.",
    "Branching conditions MUST be built ONLY from the 5 atomic categories below. No other objective.kind values may appear in a branching node's `completionLogic.objectives`, in any branchId.appliesWhen, or in any conditionIdea. In particular, the kinds `defeated`, `enemy`, `not_enemy`, `fame_min`, `fame_max`, `item_lost`, `item_delivered`, `money_spent`, `story_flag` are NOT permitted as branching conditions. (They are still allowed in `single_path_gate` task nodes' objectives — those are non-branching task gates — except `story_flag` which is forbidden in ALL conditions; see next rule.)",
    "",
    "### The 5 atomic categories",
    "  1. 金钱条件 — kind='money_at_least', target='player', operator='>=', value 必须是具体数字。意思: 玩家累计持有的金币达到 N。",
    "  2. 道具条件 — kind='item_obtained', target 必须出自 levelData.items 的 name 列表（不得编造、不得用列表外的道具名）, operator='=', value='true'。意思: 玩家拥有该道具。",
    "  3. 好感度条件 — kind='affinity_min', target 必须出自 levelData.npcs 的 name 列表, operator='>=', value 必须是具体数字。意思: 玩家与该 NPC 的好感度达到 N。",
    "  4. 朋友条件 — kind='friend', target 必须出自 levelData.npcs 的 name 列表, operator='=', value='true'。意思: 玩家与该 NPC 已成为朋友。",
    "  5. 说服条件 — kind='companion', target 必须出自 levelData.npcs 的 name 列表, operator='=', value='true'。意思: 玩家通过对话说服了该 NPC 加入成为伙伴/同伴/亲密同行者（例如 '说服 Torin 成为伙伴'、'说服安娜跟玩家一起走'）。注意: 第 5 类**不再使用 story_flag**；如果故事需要的'说服'结果不是'成为伙伴'，请改写故事让它落到这 5 类中的另一类（例如改成 friend），或把该判定从 branching 节点移走，放到非分支位置。",
    "",
    "### story_flag is FORBIDDEN as a condition (anywhere)",
    "story_flag 不允许出现在任何 condition 表达里——包括：(a) 任意节点（无论 type 是 single_path_gate / success_or_fail_branch / exclusive_choice）的 `completionLogic.objectives`；(b) 任意 `resultBranches[].appliesWhen`；(c) blueprint 的 `conditionIdea`。换句话说，story_flag 不能用来'门槛检查'。",
    "story_flag 仍然允许出现在 `completionLogic.results` 与 `resultBranches[].results` 里（即'结果/状态变化'），用于把'XX 已经发生'这种叙事性事件写入世界状态供游戏引擎引用。例: results 里可以写 { kind:'story_flag', target:'Borin 已签下证词', change:'set true', delta:'成立', text:'Borin 当众签下证词' }；但任何后续节点都不得用 story_flag:Borin 已签下证词 当成判定门槛。",
    "如果剧情需要把'某事已发生'当成后续节点的检查，请改用其它 kind（例如 friend / companion / item_obtained / affinity_min），或者重写故事，把该判定移除。",
    "",
    "### How to combine these 5 atoms",
    "Branching conditions can ONLY be Boolean combinations of the 5 atoms above, using ONLY these connectors:",
    "  - 单条件: 一个原子即可，例: 'item_obtained:黑玻苦啤=true'。",
    "  - AND（同时满足）: 例: 'item_obtained:黑玻苦啤=true AND affinity_min:Alice>=4'。",
    "  - OR（任一满足）: 例: 'friend:Alice=true OR friend:Borin=true'。",
    "  - NOT（某条件未满足）: 用于表达 '没收集到 / 没成为朋友 / 没说服成功 / 好感度没达到' 等取反语义。例: 'NOT(item_obtained:破灯笼=true)'（玩家没有破灯笼）、'NOT(friend:Darius=true)'（与 Darius 没成为朋友）、'NOT(money_at_least:player>=100)'（金币不足 100）。",
    "可以混合使用，例: '(money_at_least:player>=50 AND friend:Alice=true) OR companion:Torin=true'。但每一项原子都必须严格属于上述 5 类，target 必须真实存在（道具来自 levelData.items，NPC 来自 levelData.npcs）。",
    "",
    "### Applying combinations to each branching pattern",
    "  - role='condition' 关键条件分流节点（结构 4 的 N3 等）: completionLogic.objectives 列出涉及到的全部原子条件；每条 resultBranches[].appliesWhen 必须是上述 5 类原子的 AND/OR/NOT 组合；不同分支的 appliesWhen 必须互斥（任意输入最多命中一条）；ELSE 分支等价于'前面所有 IF 取 NOT 后再 AND'。",
    "  - success_or_fail_branch: success 分支的 appliesWhen 必须是 5 类原子的组合；failure 分支的 appliesWhen 必须是 success 的逻辑取反，不得引入额外原子。",
    "  - exclusive_choice: 每个 branch.appliesWhen 必须命中不同的 target（不同 NPC、不同道具、不同金额）；不得让两个分支检查同一个对象。",
    "",
    "### Forbidden branching conditions",
    "下列写法绝对不允许出现在任何 branching 节点的 objectives / appliesWhen / conditionIdea 中: '玩家心境平和'、'真相被揭开'、'气氛缓和'、'守卫被说服'（→ 改写成 friend / companion；不允许 story_flag）、'玩家有勇气'、'玩家选择正义'、'玩家走和解线'、'剧情合适'、'若玩家了解内情'、'击败 X'（→ branching 不允许 defeated；战斗结果走 single_path_gate）、'名誉达到 N'（→ branching 不允许 fame）、'与 X 成为敌人'（→ branching 不允许 enemy；改用 NOT(friend:X=true)）、任何 'story_flag:...' 形式的检查（→ story_flag 只能在 results 里出现，绝不能用于条件判定）。",
    "如果你想到的条件无法翻译成上述 5 类原子的 AND/OR/NOT 组合，说明它不是合格的分支条件，必须改写为这 5 类的组合，或干脆改写故事，把该判定移出 branching 节点。",
    "",
    "### Branch ↔ Node 一一对应（必须清晰可读）",
    "branching 节点的每个分支必须显式回答'完成哪个条件 → 走哪个下游节点'。具体要求：",
    "  - completionLogic.summary 必须用一行人话写出 1:1 的映射。例: '完成条件1（玩家持有 黑玻苦啤 AND Alice 好感度 ≥ 4）→ N4A；完成条件2（玩家持有 破灯笼 AND NOT(friend:Alice=true)）→ N4B；其它情况 → N4C。'",
    "  - 每条 resultBranches[] 的 appliesWhen 都必须**只对应 1 个下游节点**（branch.to 数组长度恰好为 1），不允许一个分支同时通向多个下游。",
    "  - 不同分支的 appliesWhen 必须互斥：任何一种玩家状态最多命中一条（除 ELSE 之外），ELSE 等价于'前面所有 IF 取 NOT 后再 AND'。",
    "  - 不同分支的 branch.to 不得指向同一个下游节点（即不同条件不能殊途同归到同一个节点；如果你想让多条线汇合，应该靠下一层的汇合节点处理）。",
    "  - branch.to 必须是 selectedStructure.topology 中由该 gate 节点的 outgoingTargets 列出的目标 id；不要编造下游 id。",
    "  - completionLogic.objectives 中列出的全部原子，必须能把所有 resultBranches 的 appliesWhen 拼出来；不要在 appliesWhen 里引用未在 objectives 中出现的原子。",
    "",
    "## Story–condition coupling — branching conditions MUST be voiced as story (HARD RULE)",
    "分支条件不只是机器检查项，它同时是 NPC 当面提出来的请求/秘密/承诺/门槛。玩家应该是听 NPC 说话才知道'要做什么'，而不是从 UI 里去猜。",
    "对每一个出现在任意 branching 节点中的 atomic 条件（gate 节点的 objectives 与 resultBranches[].appliesWhen 里出现的全部原子，去重后），故事里 MUST 至少有一条 keyDialogue 把这个条件用自然中文讲出来。讲出条件的位置可以是：(a) gate 节点本身的 keyDialogue，(b) gate 之前的某个上游节点（更推荐，让玩家有时间去做）。两者至少要有一处。",
    "",
    "### How each category should be voiced in keyDialogue",
    "  1. 金钱条件: NPC 直接开价，必须念出具体数字。例: '帮我凑齐 100 金币吧，我才付得起赎金。' / '少于 50 金币，这事我不接。'",
    "  2. 道具条件: NPC 点名要哪件东西，必须念出 levelData.items 里的具体道具名。例: '你得先把 黑玻苦啤 给我，没那瓶酒老乐手不肯开口。' / '没拿到 带血手帕，就别再来找我。'",
    "  3. 好感度条件: NPC 暗示需要更亲近的关系，不要求直读数字，但要让玩家听出'现在还不够'、'多打几次交道'。例: '我们才认识不久，再多走动几次我才肯松口。' / '你不是我熟人，这种话我对你说不出口。'",
    "  4. 朋友条件: NPC 把'朋友'当门槛。例: '有一个秘密我只告诉我最好的朋友。' / '只有真正的朋友才会知道这条暗道在哪儿。' / '你要是真把我当朋友，今晚就来后院。'",
    "  5. 说服条件: NPC 把'让某人加入'这件事当面交给玩家，必须念出被说服者的具体名字。例: '你能说服安娜跟我们一起走吗？' / '帮我说服 Torin 加入我们的小队。' / '没有 Raven 同行，这趟我去不了；你帮我把她劝过来。' （第 5 类只能落到 companion，所以台词要点出'加入/同行/同伴'这层意思，不要写成'让 X 作证 / 让 X 放行 / 让 X 签字'之类没法对应到 companion 的请求。）",
    "",
    "### Voicing NOT conditions",
    "用 NOT 包起来的原子，对应的台词是'反向暗示'，告诉玩家'某事一旦发生，机会就没了'。例: 'NOT(item_obtained:破灯笼=true)' → '你要是真带着 破灯笼 来，我可不接你这茬。' / 'NOT(friend:Darius=true)' → '我可不跟 Darius 的朋友说真话，你最好别和他混在一起。'",
    "",
    "### Coupling rules",
    "  - 每条 voicing 台词 MUST 含具体数值（金币数、好感度档次描述）、具体道具名（来自 levelData.items）或具体 NPC 名（来自 levelData.npcs）。'帮我个忙'、'证明你的诚意'、'拿点东西过来' 这类没指名道姓的台词不算数。",
    "  - 一条台词内只表达一个原子；如果 gate 同时检查多个原子，分别用多条 keyDialogue 表达，不要把所有条件压进一句话里。",
    "  - voicing 台词的 NPC 应当是该条件的'受益者'或'把关者'（例如要钱的就是收钱人，要被说服的对象就是任务发布者）；不要让无关 NPC 念条件。",
    "  - voicing 还要在 plot 里被一句话点明，让玩家从场景描写也能看出'这个条件存在'。",
    "  - 同一原子若在多个 branching 节点重复出现（例如串联门槛），可以在多个节点里重复 voicing，每次贴合当下情境换一种说法，不要照搬同一句台词。",
    "",
    "### Item & NPC reference rule (重申)",
    "branching 条件里出现的任何道具名 MUST 严格出自 levelData.items 的 name 字段；任何 NPC 名 MUST 严格出自 levelData.npcs 的 name 字段。对应的 voicing 台词里念出来的名字也必须用同样的名字，不能用别名、外号或缩写。",
    "When the structure is 关键条件分流 (4) and has the role='condition' node, the conditionIdea / completionLogic.summary MUST clearly state which 5-category combination the gate checks, e.g. '检查 (item_obtained:带血手帕=true AND affinity_min:Alice>=4) → N4A; (item_obtained:破灯笼=true AND NOT(friend:Alice=true)) → N4B; ELSE → N4C'.",
    "",
    "## Objective format (player-side tasks)",
    "completionLogic.objectives lists each visible task as a separate item. Each objective has: id, kind, target, operator, value, text.",
    "Use only these objective.kind values: affinity_min, affinity_max, friend, companion, enemy, not_enemy, defeated, item_obtained, item_lost, item_delivered, money_at_least, money_spent, fame_min, fame_max. Note: story_flag is NOT a permitted objective.kind — it may only appear in results / resultBranches[].results (world-state changes), never in conditions.",
    "objective.target is the NPC name, item name, or flag id. objective.operator is one of >=, <=, =, !=, true, false. objective.value is a string number, true/false, or item/flag id.",
    "objective.text is the human-readable quest objective in Chinese, written like an in-game task line. It must be a concrete checkable RPG state.",
    "",
    "## Strict rule: tasks must be machine-checkable",
    "Every objective MUST be an unambiguous RPG state check that the engine can evaluate against numbers, inventory, NPC relations, or binary flags. Avoid any objective whose success or failure depends on subjective judgment.",
    "FORBIDDEN vague objective texts (do NOT generate these): 理解 Alice 的处境, 感受到 Borin 的压力, 与村民建立信任, 完成调查, 揭开真相, 体会 Raven 的牺牲, 让玩家有所成长, 思考是否值得.",
    "REQUIRED concrete objective patterns (use these forms):",
    "  - 筹集金钱: kind=money_at_least, target=player, operator='>=', value 是具体数字, text='筹集 N 金币'",
    "  - 获得道具: kind=item_obtained, target 是具体道具名, operator='=', value='true', text='获得 <道具名>'",
    "  - 交付道具: kind=item_delivered, target='<道具名>->NPC名', operator='=', value='true', text='把 <道具名> 交给 <NPC>'",
    "  - 说服成为朋友: kind=friend, target=NPC, operator='=', value='true', text='说服 <NPC> 成为朋友'",
    "  - 说服成为伙伴: kind=companion, target=NPC, operator='=', value='true', text='说服 <NPC> 成为伙伴'",
    "  - 提升好感度: kind=affinity_min, target=NPC, operator='>=', value 是具体数字, text='<NPC> 好感度达到 N'",
    "  - 击败某人: kind=defeated, target=NPC, operator='=', value='true', text='击败 <NPC>'",
    "  - 避免敌对: kind=not_enemy, target=NPC, operator='=', value='true', text='避免让 <NPC> 把玩家视为敌人'",
    "  - 提升名誉: kind=fame_min, target=player, operator='>=', value 是具体数字, text='名誉达到 N'",
    "  - 花费金钱: kind=money_spent, target=player, operator='>=', value 是具体数字, text='付出 N 金币'",
    "story_flag is FORBIDDEN as an objective.kind in any node, regardless of the node's completionLogic.type. story_flag is only allowed in `results` / `resultBranches[].results` (世界状态变化), never in `objectives`. If the story needs '某事已发生' as a future check, model it via friend / companion / item_obtained / affinity_min / money_at_least, or restructure to remove the check.",
    "Every objective.text must reference at least one of: a specific number (金币、好感、名誉数值), a specific named NPC, or a specific named item. If you cannot point to one of these, the objective is too vague — rewrite it.",
    "Concrete kind/target/operator/value/text examples (note: no story_flag here — it is only allowed in results):",
    "  - { kind: 'friend', target: 'Alice', operator: '=', value: 'true', text: '说服 Alice 成为朋友' }",
    "  - { kind: 'companion', target: 'Torin', operator: '=', value: 'true', text: '说服 Torin 成为伙伴' }",
    "  - { kind: 'affinity_min', target: 'Raven', operator: '>=', value: '6', text: 'Raven 好感度达到 6' }",
    "  - { kind: 'money_at_least', target: 'player', operator: '>=', value: '100', text: '筹集 100 金币' }",
    "  - { kind: 'money_spent', target: 'player', operator: '>=', value: '50', text: '付给 Borin 50 金币' }",
    "  - { kind: 'item_obtained', target: '黑玻苦啤', operator: '=', value: 'true', text: '获得 黑玻苦啤' }",
    "  - { kind: 'item_delivered', target: '黑玻苦啤->Alice', operator: '=', value: 'true', text: '把 黑玻苦啤 交给 Alice' }",
    "  - { kind: 'defeated', target: 'Darius', operator: '=', value: 'true', text: '击败 Darius' }",
    "  - { kind: 'not_enemy', target: 'Darius', operator: '=', value: 'true', text: '避免让 Darius 把玩家视为敌人' }",
    "  - { kind: 'fame_min', target: 'player', operator: '>=', value: '4', text: '名誉达到 4' }",
    "",
    "## Result format (world-state changes)",
    "Completion results are world-state changes, not decorative notes. Later nodes must respect them in startState, plot, nodeOutcome, edge transitions, and future completionLogic.",
    "Use only these result.kind values: affinity, friend, enemy, companion, defeated, money, item, fame, route, story_flag.",
    "Each result has: kind, target, change, delta, text.",
    "  - change is the canonical state change in short tokens. Allowed forms: '+N' / '-N' for numbers, 'set true' / 'set false' for boolean states, 'gain' / 'lose' for items, 'open' / 'close' for routes.",
    "  - delta is a short signed string used purely for UI rendering: e.g. '+2', '-3', '+100', '-50', '获得', '失去', '开启', '关闭', '成立', '解除'. It must agree with change.",
    "  - text is the human-readable consequence in Chinese, e.g. 'Alice 好感度 +2，把玩家当作可信的朋友', 'Darius 把玩家视为敌人，好感度变为 0', '玩家失去 100 金币，因为这笔钱交给 Alice'.",
    "Concrete result examples:",
    "  - { kind: 'affinity', target: 'Alice', change: '+2', delta: '+2', text: 'Alice 好感度 +2' }",
    "  - { kind: 'friend', target: 'Alice', change: 'set true', delta: '成立', text: 'Alice 成为玩家的朋友' }",
    "  - { kind: 'enemy', target: 'Darius', change: 'set true', delta: '成立', text: 'Darius 把玩家视为敌人' }",
    "  - { kind: 'companion', target: 'Torin', change: 'set true', delta: '成立', text: 'Torin 加入玩家成为伙伴' }",
    "  - { kind: 'defeated', target: 'Darius', change: 'set true', delta: '击败', text: '玩家击败 Darius，他被赶出酒馆，无法再阻挠' }",
    "  - { kind: 'money', target: 'player', change: '-100', delta: '-100', text: '玩家失去 100 金币，交给 Alice' }",
    "  - { kind: 'item', target: '黑玻苦啤', change: 'gain', delta: '获得', text: '玩家获得 黑玻苦啤' }",
    "  - { kind: 'item', target: '银扣短刀', change: 'lose', delta: '失去', text: '玩家把 银扣短刀 交给 Borin' }",
    "  - { kind: 'fame', target: 'player', change: '+1', delta: '+1', text: '名誉 +1，村里的人开始信任玩家' }",
    "  - { kind: 'route', target: 'Alice 同伴线', change: 'close', delta: '关闭', text: '关闭 Alice 同伴线' }",
    "",
    "## Shared vs branch-specific results",
    "completionLogic.results is only for results shared by every completion path. If different branches have different outcomes, put those outcomes in completionLogic.resultBranches instead of merging them.",
    "completionLogic.resultBranches must describe branch-specific results when the node has multiple outgoing edges, OR objectives, mutually exclusive choices, or different factions/NPCs to support. Each branch must name which condition it applies to, which target nodes it can lead to, and the results for that branch.",
    "Branch-specific results should be meaningfully different. Example: branch 帮助 Alice → { Alice affinity +2, friend:Alice set true, Darius enemy set true }; branch 帮助 Darius → { Darius affinity +2, money +50, Alice affinity -3, route Alice 同伴线 close }.",
    "If money is collected for someone, include the cost result. Example: objective 筹集 100 金币; result kind='money', change='-100', delta='-100', text='玩家失去 100 金币，交给 Alice'.",
    "Support mutual exclusion when appropriate. Example: if becoming friends with Alice makes Darius hostile, add result kind='enemy', target='Darius', change='set true', delta='成立', text='Darius 把玩家视为敌人'.",
    "When the structure branches, each branch should have distinct completion results. Do not write later nodes as if all branches produced the same state. If incoming paths have different results, either write the target node's startState to acknowledge both possible states, or use separate target nodes when the selected structure allows it.",
    "",
    "## Edges — must align with the task pattern",
    "The number and shape of outgoing edges from a node MUST match its completionLogic.type:",
    "  - single_path_gate → exactly 1 outgoing edge.",
    "  - success_or_fail_branch → exactly 2 outgoing edges; one corresponds to branchId='success', the other to branchId='failure'. The edge label must say so plainly (e.g. '说服成功' / '说服失败', '击败 Darius' / '败给 Darius').",
    "  - exclusive_choice → exactly N outgoing edges where N equals the number of resultBranches. Each edge corresponds to one choice. The edge label must name the choice (e.g. '选择 Alice', '把徽章交给 Borin').",
    "Edge.from + edge.to MUST match a (sourceNode, branch.to[0]) pair. Do not produce edges that are not represented in the source node's resultBranches (or, for single_path_gate, in the source node's results).",
    "Edge.transition (1 to 2 clear sentences) must reference the concrete state change that fired in the source node, e.g. '因为玩家成功说服 Alice 出庭，议事会愿意听她的证词' or '因为玩家败给 Darius，被关进酒馆地下室等待审讯'. Avoid vague transitions like 然后进入下一节点.",
    "Each edge MUST include carriedResults: a short list of world-state results from the source node that matter to the target node. For success_or_fail_branch and exclusive_choice, carriedResults must mirror that branch's results (only that branch — not the whole node).",
    "If the source node is single_path_gate, carriedResults mirrors completionLogic.results.",
    "Do not add edges between nodes that no pattern would produce (e.g. an edge with no matching branch). Do not duplicate edges to the same target.",
    "",
    "Return only JSON."
  ].join("\n");
}

function generatedLevelDataSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["npcs", "buildings"],
    properties: {
      npcs: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "type",
            "state",
            "affinity",
            "background",
            "importance",
            "personality",
            "archetype",
            "speakingStyle",
            "speakingExamples",
            "emotionalArc",
            "coreMotivation"
          ],
          properties: {
            name: { type: "string" },
            type: { type: "string" },
            state: { type: "string" },
            affinity: { type: "string" },
            background: { type: "string" },
            importance: { type: "string", enum: ["important", "secondary"] },
            personality: { type: "string" },
            archetype: { type: "string", enum: ["冒险型", "艺术型", "实用型", "治愈型", "学术型", "社交型", "神秘型", ""] },
            speakingStyle: { type: "string" },
            speakingExamples: { type: "array", items: { type: "string" } },
            emotionalArc: { type: "string" },
            coreMotivation: { type: "string" }
          }
        }
      },
      buildings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "resource", "description"],
          properties: {
            name: { type: "string" },
            resource: { type: "string" },
            description: { type: "string" }
          }
        }
      }
    }
  };
}

function outdoorTestModeInstruction(isEnabled) {
  if (!isEnabled) return "";
  return [
    "## Test mode location rule",
    "Test mode is ON. Every generated building/location must be an outdoor place.",
    "Prefer village or small-town outdoor spaces: village square, town gate, outside a tavern, outside a shop, outside a shrine, beside a building, near a well, roadside stall, bridgehead, field edge, forest path, or beside the woods.",
    "Do not generate indoor places or underground/interior spaces. Forbidden examples: 酒馆内, 客房, 地下室, 神殿内部, 议事厅内, 仓库内, 室内房间.",
    "The location name, resource tag, and description must all make the outdoor nature obvious."
  ].join("\n");
}

async function generateLevelDataWithAI(apiKey, model, storyPrompt, items, options = {}) {
  const testModeInstruction = outdoorTestModeInstruction(options.testMode === true);
  const response = await callOpenAI(apiKey, {
    model,
    input: [
      {
        role: "system",
        content: [
          "You generate NPCs and locations for a node-based RPG, fully derived from the user's story prompt.",
          "Write in Simplified Chinese.",
          "Output only JSON that satisfies the provided schema.",
          "Generate 6 to 10 NPCs and 3 to 5 buildings/locations that are coherent with the story.",
          "",
          "## Cast tiering — do this first",
          "Before writing any NPC, decide who is important (重要角色) and who is secondary (次要角色).",
          "Pick 3 to 5 important NPCs. They are the dramatic engine: protagonist allies, the main antagonist, the key supporter, the moral foil. The remaining NPCs are secondary — they fill the world but do not drive the central conflict.",
          "Important characters MUST include at least one clear antagonist or opposition force, at least one helper-friendly NPC, and at least one ambiguous NPC whose stance can shift depending on the player's actions.",
          "Secondary characters must still be useful: side quest givers, witnesses, vendors, gossip sources, atmosphere NPCs. They should not duplicate the role of an important character.",
          "",
          "## Common NPC fields (every NPC, important or secondary)",
          "  - name: short Chinese name that fits the setting (e.g. 老木匠周延、林姑娘、孙德海、铁匠张).",
          "  - type: a short role tag, examples: 村民、商人、铁匠、酒馆老板、祭司、守卫、领主、佣兵、盗贼、学徒、吟游诗人、医者、贵族、长老、孤儿、流浪者、信使.",
          "  - state: 1 short Chinese sentence describing the NPC's current situation when the story begins (what they are doing, what they want, what they fear).",
          "  - affinity: a small integer string from -3 to 5, representing the NPC's initial attitude toward the player. Use '0' for neutral strangers.",
          "  - importance: 'important' for the 3-5 dramatic-engine NPCs, 'secondary' for everyone else. Use exactly these two values.",
          "",
          "## Important character profile (importance = 'important')",
          "Every important NPC MUST fill a complete character dossier:",
          "  - archetype: choose exactly one of 冒险型, 艺术型, 实用型, 治愈型, 学术型, 社交型, 神秘型.",
          "  - personality: 1 to 2 Chinese sentences describing the NPC's personality traits, paired with the archetype. Mention dominant traits, quirks, and how they typically deal with pressure.",
          "  - speakingStyle: 1 short Chinese sentence describing how this NPC talks — vocabulary, rhythm, tone, attitude (e.g. 短句、直白、爱用反问；客套委婉，回避正面冲突；夹杂行话与脏话).",
          "  - speakingExamples: an array of 3 to 5 short, direct Chinese quotes (under 25 characters each) that this NPC could plausibly say. They must clearly demonstrate the speakingStyle and personality. Avoid generic lines; bake in the NPC's stance, rhythm, and verbal tics.",
          "  - emotionalArc: 1 to 2 Chinese sentences describing how this NPC's emotional state is expected to move across the story (e.g. 起：戒备 → 中：动摇 → 末：托付 / 决裂). Tie it to the player's possible actions.",
          "  - coreMotivation: 1 short Chinese sentence stating what this NPC fundamentally wants and what they fear losing. This must be specific to this story, not a generic trait.",
          "  - background: 2 to 3 Chinese sentences explaining the NPC's relevant backstory and how it hooks into the story conflict. Mention any past incident that explains their current stance.",
          "",
          "## Secondary character profile (importance = 'secondary')",
          "Secondary NPCs use a leaner profile. They MUST still satisfy the schema, but the 'important-only' fields stay short or empty:",
          "  - personality: 1 short Chinese phrase describing them in plain words (e.g. 温吞守旧, 爱占便宜的滑头, 沉默寡言的工匠).",
          "  - background: 1 short Chinese sentence with their relevant backstory. Keep it tight; no inner monologue, no long history.",
          "  - archetype: empty string ''.",
          "  - speakingStyle: empty string ''.",
          "  - speakingExamples: empty array [].",
          "  - emotionalArc: empty string ''.",
          "  - coreMotivation: empty string ''.",
          "",
          "## Building fields",
          "  - name: short Chinese place name (e.g. 老榆酒馆、北门码头、雾湾灯塔、神殿地下、镇议事厅).",
          "  - resource: a short style/material tag, e.g. 石砌酒馆、木屋集市、古旧神殿、铁匠铺、狭窄码头、地下室、林间帐篷.",
          "  - description: 1 to 2 short Chinese sentences describing the place's atmosphere and what role it plays in the story.",
          "Cover at least one location per main act of the conflict (where it begins, where it escalates, where it resolves).",
          testModeInstruction,
          "",
          "## General rules",
          "Make NPC names varied: do not give every NPC the same surname, do not repeat archetypes.",
          "If the user provided items, you may reference item names inside NPC backgrounds or building descriptions, but do not create or rename items.",
          "Make sure the cast can sustain the kinds of objectives the player will face: 筹集金钱、说服 NPC、获得道具、击败某 NPC、与某 NPC 成为朋友/伙伴.",
          "Important characters' coreMotivation, emotionalArc, and speakingExamples must stay consistent with their archetype + personality and with the story's main conflict.",
          "Return only JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Generate NPCs and buildings consistent with this story.",
          story: storyPrompt,
          items,
          testMode: options.testMode === true
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "level_data_generation",
        strict: true,
        schema: generatedLevelDataSchema()
      }
    }
  });

  return tryParseJson(extractText(response));
}

async function handleValidateKey(req, res) {
  const body = JSON.parse(await readRequestBody(req) || "{}");
  const apiKey = normalizeApiKey(body.apiKey);
  const apiKeyError = validateApiKey(apiKey);
  if (apiKeyError) {
    sendJson(res, 400, { ok: false, error: apiKeyError });
    return;
  }

  await callOpenAI(apiKey, {
    model: "gpt-4o",
    input: "Reply with exactly: ok",
    max_output_tokens: 16
  });
  sendJson(res, 200, { ok: true });
}

async function handleGenerateStory(req, res) {
  const body = JSON.parse(await readRequestBody(req) || "{}");
  const apiKey = normalizeApiKey(body.apiKey);
  const storyPrompt = (body.story || "").trim();
  const apiKeyError = validateApiKey(apiKey);

  if (apiKeyError) {
    sendJson(res, 400, { ok: false, error: apiKeyError });
    return;
  }
  if (!storyPrompt) {
    sendJson(res, 400, { ok: false, error: "Story prompt is required." });
    return;
  }

  const models = {
    structure: body.models?.structure || "gpt-4o",
    foundation: body.models?.foundation || "gpt-5.5",
    blueprint: body.models?.blueprint || "gpt-4o",
    detail: body.models?.detail || body.model || "gpt-5.5"
  };

  const useLocalCharacters = body.useLocalCharacters !== false;
  const testMode = body.testMode === true && !useLocalCharacters;
  const locationModeInstruction = outdoorTestModeInstruction(testMode);

  const [structures, localData] = await Promise.all([readStructures(), readLevelData()]);

  const levelDataPromise = useLocalCharacters
    ? Promise.resolve({ data: localData, source: "local" })
    : generateLevelDataWithAI(apiKey, models.foundation, storyPrompt, localData.items, { testMode })
      .then(generated => ({
        data: {
          relativePath: localData.relativePath,
          npcs: Array.isArray(generated.npcs) ? generated.npcs : [],
          items: localData.items,
          buildings: Array.isArray(generated.buildings) ? generated.buildings : []
        },
        source: "ai",
        model: models.foundation
      }));

  const selectionResponse = await callOpenAI(apiKey, {
    model: models.structure,
    input: [
      {
        role: "system",
        content: [
          "You choose the best node narrative structure.",
          "Use the structure guide to judge which topology best fits the user's story.",
          "Score every structure against the story's dramatic movement before choosing.",
          "Prefer the structure whose topology matches the story's real dramatic movement, not the one that is easiest to fill.",
          "Return only JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "Select one structure for this natural-language story. Consider whether the story needs interwoven branches, crossed routes, hub exploration, condition gates, or multiple endings.",
          story: storyPrompt,
          structures,
          structureGuide: structureGuide()
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "structure_selection",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["selectedStructureId", "reason", "structureName", "scores"],
          properties: {
            selectedStructureId: { type: "string" },
            reason: { type: "string" },
            structureName: { type: "string" },
            scores: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "score", "reason"],
                properties: {
                  id: { type: "string" },
                  score: { type: "integer" },
                  reason: { type: "string" }
                }
              }
            }
          }
        }
      }
    }
  });

  const selection = tryParseJson(extractText(selectionResponse));
  const selectedStructure = structures.find(item => item.id === selection.selectedStructureId) || structures[0];

  const levelDataResolved = await levelDataPromise;
  const levelData = levelDataResolved.data;
  const levelDataSource = levelDataResolved.source;

  const topology = selectedStructure.topology || parseStructureTopology(selectedStructure.content || "");
  const topologySummary = topology.summary || "";

  const foundationResponse = await callOpenAI(apiKey, {
    model: models.foundation,
    input: [
      {
        role: "system",
        content: [
          narrativeSystemPrompt(),
          "This stage writes only the complete story foundation and high-level narrative preparation.",
          "Do not write node details yet. Do not expose explicit branch labels in expandedStory.",
          "",
          "## Selected structure topology (binding for later stages)",
          "The downstream blueprint and detail stages will be required to use the EXACT node ids and edges below. Plan your foundation so that each topology node has a clear narrative purpose to fill, and so that the special node roles (hub / condition / ending) are dramatically supported. Make sure your `layerNotes` cover every layer listed below; do not add layers beyond this list.",
          topologySummary,
          locationModeInstruction,
          "Return only JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          originalStory: storyPrompt,
          selectedByGpt4o: selection,
          selectedStructure,
          structureTopology: topology,
          levelData,
          testMode
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "story_foundation",
        strict: true,
        schema: storyFoundationSchema()
      }
    }
  });

  const foundation = tryParseJson(extractText(foundationResponse));

  const blueprintResponse = await callOpenAI(apiKey, {
    model: models.blueprint,
    input: [
      {
        role: "system",
        content: [
          "You split a story foundation into a node blueprint for a game narrative system.",
          "Write in Simplified Chinese.",
          "Do not write full node prose. Create concise node purposes, state focus, condition ideas, and edge carried results.",
          "Use only NPCs, items, and locations from the provided Level_AI data.",
          "",
          "## Selected structure topology — STRICT 1:1 MAPPING",
          "The blueprint MUST be a 1:1 mapping of `structureTopology`:",
          "  - Output exactly one blueprint node per topology node, using IDENTICAL ids (same spelling, same casing, including special ids like HUB, E1, E2, E3).",
          "  - The number of blueprint nodes MUST equal the number of topology nodes. Do not add or remove nodes.",
          "  - Each blueprint node's `layer` MUST equal the topology layer.",
          "  - Each blueprint node's `next` MUST equal that node's `outgoingTargets` from the topology (same ids, same order).",
          "  - Output exactly one blueprint edge per topology edge, with `from` and `to` matching exactly. Do not add or remove edges. Do not flip directions.",
          "  - Topology nodes with role='ending' MUST have `next=[]` and MUST NOT appear as `from` of any edge.",
          "  - Topology nodes with role='hub' (e.g. HUB) MUST keep that exact id and act as the central junction.",
          "  - Topology nodes with role='condition' MUST be treated as the single critical gate; describe the gate in `conditionIdea`.",
          "",
          "## Branching condition vocabulary — RESTRICTED to 5 categories",
          "Whenever a blueprint node represents a branching point — i.e. it has 2+ entries in `next` (success_or_fail_branch / exclusive_choice / role='condition' gate) — the `conditionIdea` MUST be expressed using ONLY these 5 atomic categories, combined with AND/OR/NOT only:",
          "  1. 金钱条件: money_at_least:player>=N（N 是具体数字）。",
          "  2. 道具条件: item_obtained:<道具名>=true（道具名必须严格来自 levelData.items 的 name 字段，不得编造、不得改名）。",
          "  3. 好感度条件: affinity_min:<NPC>>=N（NPC 必须来自 levelData.npcs，N 是具体数字）。",
          "  4. 朋友条件: friend:<NPC>=true（NPC 必须来自 levelData.npcs）。",
          "  5. 说服条件: 仅允许 companion:<NPC>=true（说服 NPC 加入成为伙伴/同伴/同行者）。**禁止使用 story_flag 当条件**——如果剧情想要的'说服'结果不是'成为伙伴'，请改写故事让它落到这 5 类中的另一类，或把该判定移出 branching 节点。",
          "组合规则: 单条件、AND、OR、NOT(...) 四种连接方式即可；NOT 用来表达'没收集到 / 没成为朋友 / 没说服 / 好感度未达到'。例: 'item_obtained:黑玻苦啤=true AND NOT(friend:Darius=true)'。",
          "禁止把 defeated / enemy / not_enemy / fame_min / fame_max / item_lost / item_delivered / money_spent / story_flag 写进任何 branching 节点的 conditionIdea。story_flag 在所有 conditionIdea 中都被禁止（无论节点 type 是什么）。",
          "Forbidden conditionIdea phrasings: '玩家选择正义'、'气氛缓和'、'真相浮现'、'剧情合适'、'守卫被说服'（→ 改写成 friend / companion）、'击败 X'、'名誉达到 N'、任何 'story_flag:...' 形式的检查。如果一个条件无法翻译成上面 5 类原子的 AND/OR/NOT 组合，说明它不合格，必须改写。",
          "For role='condition' nodes (e.g. N3 in 关键条件分流), conditionIdea MUST explicitly enumerate the 5-category combination per downstream branch, e.g. 'IF (item_obtained:带血手帕=true AND affinity_min:Alice>=4) → N4A; IF (item_obtained:破灯笼=true AND NOT(friend:Alice=true)) → N4B; ELSE → N4C'. 不同 IF 之间互斥（任意输入最多命中一条）；ELSE 等价于前面所有 IF 取 NOT 后再 AND。每个 IF 必须严格 1:1 对应一个下游节点（同一节点不能被两个 IF 同时命中）。",
          "Story–condition coupling: 每个 branching 原子条件最终都要在 detail 阶段被一句 NPC 台词讲出来（例如 NPC 当面要 100 金币、当面点名要某道具、当面让玩家说服某 NPC 加入）。在 blueprint 的 storyMoment 字段里应当为每个 branching 节点写明：'该节点至少有一句 NPC 台词把条件念出来'，并简短描述谁会说、说什么意思。",
          "",
          "Below is the topology you must follow exactly:",
          topologySummary,
          locationModeInstruction,
          "Return only JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          selectedStructure,
          structureTopology: topology,
          foundation,
          levelData,
          testMode
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "node_blueprint",
        strict: true,
        schema: nodeBlueprintSchema()
      }
    }
  });

  const blueprint = tryParseJson(extractText(blueprintResponse));

  const generationResponse = await callOpenAI(apiKey, {
    model: models.detail,
    input: [
      {
        role: "system",
        content: [
          narrativeSystemPrompt(),
          "This final stage writes detailed nodes and edges from the approved story foundation and node blueprint.",
          "Keep the foundation fields consistent with the story foundation. Respect the blueprint ids, layers, next links, and intended carried results.",
          "",
          "## Selected structure topology — STRICT, NON-NEGOTIABLE",
          "The final story MUST mirror the topology exactly. Use only these ids; reproduce only these edges; respect the layer of each node; honor the special roles. Reuse the blueprint ids and connections verbatim — they were already aligned to the topology in the previous stage. If the blueprint contradicts the topology in any way, follow the topology, not the blueprint.",
          topologySummary,
          locationModeInstruction,
          "Return the complete final node story JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          originalStory: storyPrompt,
          selectedByGpt4o: selection,
          selectedStructure,
          structureTopology: topology,
          foundation,
          blueprint,
          levelData,
          testMode
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "node_story",
        strict: true,
        schema: storySchema()
      }
    }
  });

  const story = tryParseJson(extractText(generationResponse));
  story.selectedStructure = {
    id: selectedStructure.id,
    file: selectedStructure.file,
    name: story.selectedStructure?.name || selection.structureName || `结构 ${selectedStructure.id}`
  };

  const structureLabel = `${selectedStructure.id}（${story.selectedStructure.name}）`;
  const topologyCheck = validateStoryAgainstTopology(story, topology, structureLabel);
  const conditionCheck = validateStoryConditions(story, topology, structureLabel);
  story.topologyCheck = topologyCheck;
  story.conditionCheck = conditionCheck;

  story.cast = (levelData.npcs || []).map(npc => ({
    name: npc.name || "",
    type: npc.type || "",
    state: npc.state || "",
    affinity: npc.affinity ?? "",
    background: npc.background || "",
    importance: (npc.importance || "").toLowerCase() === "important" ? "important" : "secondary",
    personality: npc.personality || "",
    archetype: npc.archetype || "",
    speakingStyle: npc.speakingStyle || "",
    speakingExamples: Array.isArray(npc.speakingExamples) ? npc.speakingExamples : [],
    emotionalArc: npc.emotionalArc || "",
    coreMotivation: npc.coreMotivation || ""
  }));
  story.locations = (levelData.buildings || []).map(b => ({
    name: b.name || "",
    resource: b.resource || "",
    description: b.description || ""
  }));
  story.items = (levelData.items || []).map(item => ({
    name: item.name || "",
    resource: item.resource || "",
    description: item.description || ""
  }));
  story.castSource = levelDataSource;

  const generationStages = [];
  if (levelDataSource === "ai") {
    generationStages.push({ stage: "level", label: "NPC/地点生成", model: models.foundation });
  }
  generationStages.push(
    { stage: "structure", label: "结构选择", model: models.structure },
    { stage: "foundation", label: "故事底稿", model: models.foundation },
    { stage: "blueprint", label: "节点蓝图", model: models.blueprint },
    { stage: "detail", label: "节点细写", model: models.detail }
  );

  sendJson(res, 200, {
    ok: true,
    selection,
    structure: selectedStructure,
    levelDataSummary: {
      relativePath: levelData.relativePath,
      npcCount: levelData.npcs.length,
      itemCount: levelData.items.length,
      buildingCount: levelData.buildings.length,
      npcSource: levelDataSource,
      buildingSource: levelDataSource,
      itemSource: "local",
      testMode
    },
    levelData: levelDataSource === "ai" ? {
      npcs: levelData.npcs,
      buildings: levelData.buildings
    } : null,
    generationStages,
    story
  });
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { ok: false, error: "Forbidden." });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
    res.end(content);
  } catch {
    sendJson(res, 404, { ok: false, error: "Not found." });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url.startsWith("/api/context")) {
      const [structures, levelData] = await Promise.all([readStructures(), readLevelData()]);
      sendJson(res, 200, { ok: true, structures, levelData });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/validate-key")) {
      await handleValidateKey(req, res);
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/generate-story")) {
      await handleGenerateStory(req, res);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Unexpected server error." });
  }
});

server.listen(PORT, () => {
  console.log(`NodeStory is running at http://localhost:${PORT}`);
  console.log(`Reading Level_AI data from ${path.relative(ROOT, LEVEL_AI_DIR)}`);
});
