const http = require("http");
const fsSync = require("fs");
const fs = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const STRUCTURE_DIR = path.join(ROOT, "NodeStructure");
const SKILLS_DIR = path.join(ROOT, "skills");
const LEVEL_AI_DIR = findLevelAiDir(ROOT);

const SKILL_REGISTRY = [];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function loadUndici() {
  try {
    return require("undici");
  } catch {
    return null;
  }
}

function resolveOptionalProxyUrl() {
  const fromEnv = (
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    ""
  ).trim();
  if (fromEnv) return fromEnv;
  if (String(process.env.NODE_STORY_CLASH_PROXY || "").trim() === "1") {
    return "http://127.0.0.1:7890";
  }
  return "";
}

async function openAiHttpsFetch(apiKey, bodyString) {
  const url = "https://api.openai.com/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };

  const proxyUrl = resolveOptionalProxyUrl();
  const undici = loadUndici();
  const undiciFetch = undici && typeof undici.fetch === "function" ? undici.fetch : null;

  if (proxyUrl) {
    if (!undiciFetch || !undici.ProxyAgent) {
      throw new Error(
        "检测到代理环境变量但无法加载 undici（或缺少 ProxyAgent）。请 npm install undici，或取消 HTTPS_PROXY，或升级到 Node 18+ 且无代理。"
      );
    }
    try {
      const dispatcher = new undici.ProxyAgent(proxyUrl);
      return await undiciFetch(url, { method: "POST", headers, body: bodyString, dispatcher });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      throw new Error(
        `经由代理访问 OpenAI 失败：${msg}（代理：${proxyUrl}）。若不需代理请清空 HTTPS_PROXY / HTTP_PROXY，或改用直连。`
      );
    }
  }

  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch(url, { method: "POST", headers, body: bodyString });
  }
  if (undiciFetch) {
    return undiciFetch(url, { method: "POST", headers, body: bodyString });
  }
  throw new Error("无法发起 HTTPS 请求：当前 Node 无全局 fetch，且未安装 undici。请升级到 Node 18+ 或安装 undici（npm install undici）。");
}

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

const VALID_SKILL_STAGES = new Set(["foundation", "blueprint", "detail"]);

function parseSkillFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/);
  if (!match) return null;
  const headerText = match[1];
  const body = match[2];

  const meta = {};
  for (const rawLine of headerText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let valueText = line.slice(idx + 1).trim();

    if (valueText.startsWith("[") && valueText.endsWith("]")) {
      const inner = valueText.slice(1, -1).trim();
      meta[key] = inner
        ? inner.split(",").map(item => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
        : [];
      continue;
    }

    if ((valueText.startsWith("\"") && valueText.endsWith("\"")) || (valueText.startsWith("'") && valueText.endsWith("'"))) {
      valueText = valueText.slice(1, -1);
    }

    if (/^-?\d+$/.test(valueText)) {
      meta[key] = Number(valueText);
    } else if (valueText === "true" || valueText === "false") {
      meta[key] = valueText === "true";
    } else {
      meta[key] = valueText;
    }
  }

  return { meta, body };
}

function loadAllSkills() {
  SKILL_REGISTRY.length = 0;
  if (!fsSync.existsSync(SKILLS_DIR)) {
    console.warn(`[skills] Skills directory not found: ${SKILLS_DIR}`);
    return;
  }

  const entries = fsSync.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const seenIds = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    if (entry.name.toLowerCase() === "readme.md") continue;

    const filepath = path.join(SKILLS_DIR, entry.name);
    const text = fsSync.readFileSync(filepath, "utf8");
    const parsed = parseSkillFrontmatter(text);
    if (!parsed) {
      console.warn(`[skills] ${entry.name}: missing or malformed frontmatter, skipping.`);
      continue;
    }

    const { meta, body } = parsed;
    if (!meta.id || typeof meta.id !== "string") {
      console.warn(`[skills] ${entry.name}: missing 'id' in frontmatter, skipping.`);
      continue;
    }

    const scope = Array.isArray(meta.scope)
      ? meta.scope.filter(stage => VALID_SKILL_STAGES.has(stage))
      : [];
    if (scope.length === 0) {
      console.warn(`[skills] ${entry.name} (id=${meta.id}): empty or invalid 'scope', skipping.`);
      continue;
    }

    if (seenIds.has(meta.id)) {
      console.warn(`[skills] duplicate id '${meta.id}' in ${entry.name} (already loaded from ${seenIds.get(meta.id)}); the later file will overwrite the earlier one.`);
    }
    seenIds.set(meta.id, entry.name);

    SKILL_REGISTRY.push({
      id: String(meta.id),
      name: typeof meta.name === "string" && meta.name ? meta.name : meta.id,
      description: typeof meta.description === "string" ? meta.description : "",
      scope,
      order: typeof meta.order === "number" ? meta.order : 100,
      file: entry.name,
      body: body.trim()
    });
  }

  SKILL_REGISTRY.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  console.log(`[skills] loaded ${SKILL_REGISTRY.length} skill(s): ${SKILL_REGISTRY.map(s => s.id).join(", ")}`);
}

function interpolateSkillBody(body, context) {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      const value = context[key];
      return value == null ? "" : String(value);
    }
    return "";
  });
}

function composeSystemPrompt(stage, context = {}) {
  if (!VALID_SKILL_STAGES.has(stage)) {
    throw new Error(`Unknown stage '${stage}'. Valid stages: ${[...VALID_SKILL_STAGES].join(", ")}.`);
  }

  const blocks = [];
  const usedSkills = [];
  for (const skill of SKILL_REGISTRY) {
    if (!skill.scope.includes(stage)) continue;
    const interpolated = interpolateSkillBody(skill.body, context);
    blocks.push(`# ${skill.name}\n\n${interpolated.trim()}`);
    usedSkills.push(skill.id);
  }

  if (Array.isArray(context.extraBlocks)) {
    for (const extra of context.extraBlocks) {
      if (typeof extra === "string" && extra.trim()) blocks.push(extra.trim());
    }
  }

  if (process.env.DEBUG_SKILLS) {
    console.log(`[skills] stage=${stage} → ${usedSkills.join(", ")}`);
  }

  return blocks.join("\n\n");
}

function listSkillsForApi() {
  const stages = { foundation: [], blueprint: [], detail: [] };
  const skills = SKILL_REGISTRY.map(skill => {
    for (const stage of skill.scope) {
      if (stages[stage]) stages[stage].push(skill.id);
    }
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      scope: skill.scope.slice(),
      order: skill.order,
      file: skill.file
    };
  });
  return { skills, stages };
}

loadAllSkills();

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
  const response = await openAiHttpsFetch(apiKey, JSON.stringify(payload));

  if (response == null || typeof response.text !== "function") {
    throw new Error(
      "OpenAI 请求响应异常（无法读取正文）。请确认网络连通、HTTPS_PROXY / 防火墙 / 网关未篡改响应。"
    );
  }

  let text;
  try {
    text = await response.text();
  } catch (err) {
    throw new Error(`读取 OpenAI 响应正文失败：${err.message || err}`);
  }
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
  return response.choices?.[0]?.message?.content || "";
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
    messages: [
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
          "  - speakingExamples: an array of 3 to 5 short, direct Chinese quotes (under 25 characters each) that this NPC could plausibly say. They must clearly demonstrate the speakingStyle and personality. Avoid generic lines; bake in the NPC's stance, rhythm, and verbal tics. 必须像真实游戏中 NPC 当面对玩家说的话，不允许写四字格 / 古汉语骈文 / 对仗排比 / 海报金句 / 旁白宣告（例如 '先 X 再 Y'、'井守满水桶'、'总算能开'、'压力过去'、'我替你们压住' 这类全部禁止）。优先写完整主谓宾的口语句，例: '你别在门口站着，往里走，第二张桌子是我的。' / '这把刀我不卖，但十金币我可以借你磨一晚。' / '走出北门往左拐，过了老桥就到。'",
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "level_data_generation",
        strict: true,
        schema: generatedLevelDataSchema()
      }
    }
  });

  return tryParseJson(extractText(response));
}

async function handleValidateKey(req, res) {
  let rawBody;
  try {
    rawBody = await readRequestBody(req);
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || "读取请求体失败。" });
    return;
  }
  let body;
  try {
    body = JSON.parse(rawBody || "{}");
  } catch {
    sendJson(res, 400, { ok: false, error: "请求 JSON 格式无效。" });
    return;
  }

  const apiKey = normalizeApiKey(body.apiKey);
  const apiKeyError = validateApiKey(apiKey);
  if (apiKeyError) {
    sendJson(res, 400, { ok: false, error: apiKeyError });
    return;
  }

  try {
    await callOpenAI(apiKey, {
      model: "gpt-4o",
      messages: [{ role: "user", content: "Reply with exactly: ok" }],
      max_tokens: 16
    });
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 502, { ok: false, error: err.message || "OpenAI API Key 验证失败（网络或服务端错误）。" });
  }
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

  levelDataPromise.catch(() => {});

  const selectionResponse = await callOpenAI(apiKey, {
    model: models.structure,
    messages: [
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
    response_format: {
      type: "json_schema",
      json_schema: {
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
    messages: [
      {
        role: "system",
        content: composeSystemPrompt("foundation", {
          topologySummary,
          extraBlocks: [
            "## Stage-specific instruction",
            "This stage writes only the complete story foundation and high-level narrative preparation.",
            "Do not write node details yet. Do not expose explicit branch labels in expandedStory.",
            "Plan the foundation so that each topology node has a clear narrative purpose to fill, and so that the special node roles (hub / condition / ending) are dramatically supported. Make sure your `layerNotes` cover every layer listed in the topology summary; do not add layers beyond this list.",
            locationModeInstruction
          ]
        })
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "story_foundation",
        strict: true,
        schema: storyFoundationSchema()
      }
    }
  });

  const foundation = tryParseJson(extractText(foundationResponse));

  const blueprintResponse = await callOpenAI(apiKey, {
    model: models.blueprint,
    messages: [
      {
        role: "system",
        content: composeSystemPrompt("blueprint", {
          topologySummary,
          extraBlocks: [
            "## Stage-specific instruction",
            "This stage splits the story foundation into a node blueprint. Do not write full node prose; create concise `nodePurpose`, `stateFocus`, `conditionIdea`, `storyMoment`, and edge carried results.",
            "Output exactly one blueprint node per topology node and exactly one blueprint edge per topology edge. Reuse identical ids (same spelling, same casing) and reproduce the topology exactly.",
            "For each branching node (any node with 2+ entries in `next`, including role='condition' gates), the `conditionIdea` MUST be expressed using ONLY combinations of the 5 atomic categories described in the conditions skill above, joined by AND / OR / NOT.",
            "For role='condition' nodes, `conditionIdea` MUST enumerate IF (atomic combination) → downstream id, with mutually exclusive IFs and an ELSE if needed.",
            "For each branching node, write `storyMoment` to explicitly note: '该节点至少有一句 NPC 台词把条件念出来'，并简短描述谁会说、说什么意思（这是为了让 detail 阶段把条件用台词讲出来）。",
            locationModeInstruction
          ]
        })
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "node_blueprint",
        strict: true,
        schema: nodeBlueprintSchema()
      }
    }
  });

  const blueprint = tryParseJson(extractText(blueprintResponse));

  const generationResponse = await callOpenAI(apiKey, {
    model: models.detail,
    messages: [
      {
        role: "system",
        content: composeSystemPrompt("detail", {
          topologySummary,
          extraBlocks: [
            "## Stage-specific instruction",
            "This final stage writes detailed nodes and edges from the approved story foundation and node blueprint.",
            "Keep foundation fields consistent with `foundation`. Reuse the blueprint ids, layers, next links, and intended carried results verbatim — they were already aligned to the topology in the previous stage.",
            "If the blueprint contradicts the topology in any way, follow the topology, not the blueprint.",
            locationModeInstruction,
            "Return the complete final node story JSON."
          ]
        })
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
    response_format: {
      type: "json_schema",
      json_schema: {
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

    if (req.method === "GET" && req.url.startsWith("/api/skills")) {
      sendJson(res, 200, { ok: true, ...listSkillsForApi() });
      return;
    }

    if (req.method === "POST" && req.url.startsWith("/api/skills/reload")) {
      try {
        loadAllSkills();
        sendJson(res, 200, { ok: true, ...listSkillsForApi() });
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message || "Failed to reload skills." });
      }
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
    console.error("[server] request handler error:", error);
    if (!res.headersSent) {
      try {
        sendJson(res, 500, { ok: false, error: error.message || "Unexpected server error." });
      } catch (sendErr) {
        console.error("[server] failed to send 500:", sendErr);
      }
    }
  }
});

process.on("unhandledRejection", reason => {
  console.error("[server] unhandledRejection:", reason && reason.stack || reason);
});
process.on("uncaughtException", err => {
  console.error("[server] uncaughtException:", err && err.stack || err);
});

server.listen(PORT, () => {
  console.log(`NodeStory is running at http://localhost:${PORT}`);
  console.log(`Reading Level_AI data from ${path.relative(ROOT, LEVEL_AI_DIR)}`);
  const p = resolveOptionalProxyUrl();
  if (p) {
    console.log(`OpenAI 请求将走代理：${p}`);
  } else {
    console.log("OpenAI 请求为直连。若使用 Clash：设置 HTTPS_PROXY=http://127.0.0.1:7890 或 NODE_STORY_CLASH_PROXY=1");
  }
});
