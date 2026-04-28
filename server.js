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
      content
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
      background: row.npc_background
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
            nodeOutcome: { type: "string" },
            npcs: { type: "array", items: { type: "string" } },
            items: { type: "array", items: { type: "string" } },
            locations: { type: "array", items: { type: "string" } },
            completionCondition: { type: "string" },
            completionLogic: {
              type: "object",
              additionalProperties: false,
              required: ["type", "description", "expression", "rules", "effects"],
              properties: {
                type: { type: "string" },
                description: { type: "string" },
                expression: { type: "string" },
                rules: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["id", "kind", "target", "operator", "value", "source"],
                    properties: {
                      id: { type: "string" },
                      kind: { type: "string" },
                      target: { type: "string" },
                      operator: { type: "string" },
                      value: { type: "string" },
                      source: { type: "string" }
                    }
                  }
                },
                effects: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["trigger", "effect"],
                    properties: {
                      trigger: { type: "string" },
                      effect: { type: "string" }
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
          required: ["from", "to", "label", "transition"],
          properties: {
            from: { type: "string" },
            to: { type: "string" },
            label: { type: "string" },
            transition: { type: "string" }
          }
        }
      }
    }
  };
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

  const [structures, levelData] = await Promise.all([readStructures(), readLevelData()]);

  const selectionResponse = await callOpenAI(apiKey, {
    model: "gpt-4o",
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

  const generationResponse = await callOpenAI(apiKey, {
    model: body.model || "gpt-5.5",
    input: [
      {
        role: "system",
        content: [
          "You are a senior game narrative designer for a node-based story system.",
          "Write in Simplified Chinese.",
          "Use only NPCs, items, and locations from the provided Level_AI data.",
          "If the user gives a famous story, myth, historical scene, or literary plot, do not mechanically reskin its surface. First extract its durable dramatic theme, then adapt that theme into a new story using the available NPCs, items, and location.",
          "For example, 桃园结义 should become a story about three like-minded people choosing sworn fellowship and a shared adventure under pressure. It should not require Liu Bei, Guan Yu, Zhang Fei, a literal peach garden, or the exact original events.",
          "The adaptation must preserve the emotional engine: why these people need each other, what risk makes the vow meaningful, what future adventure the vow opens, and what playable actions prove the bond.",
          "Put this adaptation logic into the adaptation field before writing the story.",
          "Before writing nodes, define storyContext: playerRole, mainConflict, priorIncident, and stakes. These are the facts the player must understand to role-play well.",
          "Use a Fabula-like and tabletop DND-like card deal before writing: premise card, conflict card, location card, NPC face cards, item clue/cost cards, twist card, cost card, and resolution card. Put the final deal into designDeck.",
          "Treat the selected structure as layers. Nodes in the same layer are peer narrative options, not main/sub branches. They must have comparable length, stakes, usefulness, and dramatic weight.",
          "Do not let same-layer nodes repeat the same scene with renamed NPCs. Each peer node should express a different method, risk, moral angle, or information route.",
          "Keep the story straightforward. Use one main conflict, one main opposition force, and one clear goal. Branches should be different ways to solve the same main problem, not new subplots.",
          "For RPG readability, make the player's current objective obvious at every point. A player should understand who is in trouble, who blocks the goal, and what the next available choices are.",
          "Limit the core cast to 3 to 5 important NPCs across the story unless the selected structure truly requires more. Other NPCs may be omitted.",
          "Limit the core props to 3 to 5 important items across the story. Do not mention many items just because they exist in Level_AI data.",
          "Each node should usually contain no more than 3 named NPCs and 2 important items. If more appear, they must have a direct role in that node.",
          "Avoid nested choices inside a branch. A branch may have steps, but it should not split into another mini-branch unless the selected structure explicitly requires it.",
          "Avoid stacking several condition words in one paragraph, such as 若选择..., 若选择..., 若已有..., 若已有.... Put choices into separate labeled branch sections.",
          "Avoid unnecessary twists, fake clues, hidden debts, extra witnesses, or bait plans when a simpler cause-and-effect path works.",
          "Write like a clear playable scene outline, not like ornate fiction. Use plain words, short sentences, and concrete actions: what happens, who speaks, who walks toward whom, who moves an object, and what changes in the room.",
          "The plot can be rich without becoming complicated. Include NPC dialogue, NPC movement, small conflicts, reactions, and visible use of items or locations, but keep cause and effect easy to follow.",
          "The player must be present as an active possible driver of the scene. Include what the player can agree with, question, help with, refuse, give, reveal, protect, or persuade.",
          "Do not erase the player from expandedStory or node plots. Use optional wording such as 玩家可以..., 若玩家..., 玩家能通过..., 可由玩家选择..., instead of writing that the player already did the action.",
          "Do not output separate playerOptions or contextFacts fields. Player-facing actions belong in completionCondition, completionLogic, edge labels, and transitions.",
          "Facts the player needs to understand must be delivered inside the story text, especially through NPC dialogue. When a conflict depends on backstory, make an NPC state the cause in plain language.",
          "Examples of useful explanatory dialogue: '他三天前收了我的钱却卖了我', '这瓶酒不是吧台的，是他从袖子里拿出来的', '我不敢作证，因为上次作证的人失踪了'.",
          "Every important dialogue line should include or be surrounded by enough context to explain who is being accused, what happened before, and why the line matters.",
          "expandedStory must be a coherent story treatment that can later be split into nodes. Do not write meta commentary such as 这是一个从...抽取主题后的故事, 故事通过...结构展开, or 枢纽结构.",
          "expandedStory should read like one complete story foundation, not like an explicit branch list. Do not use labels such as 分支A, 分支B, HUB, N1, N2, or 条件路线 in expandedStory.",
          "While writing expandedStory, silently consider the selected structure and leave clear story moments that can become branches later: different NPC motives, competing solutions, important decisions, reversals, and convergence points.",
          "In expandedStory, focus on NPC speech, movement, player-facing interventions, conflict, and visible changes. Let possible alternatives exist inside the situation, but do not turn it into a menu list.",
          "expandedStory must make the player role understandable early. Explain why the player is present, why NPCs would listen to the player, and what the player can affect.",
          "expandedStory should explain important backstory through direct NPC lines or immediate evidence before it asks the player to judge the situation.",
          "expandedStory should be detailed and useful as the foundation for later node writing. Include enough events, NPC reactions, short dialogue, item usage, and state changes to support the later node structure.",
          "For expandedStory, write 700 to 1200 Chinese characters when the structure has many nodes. Keep paragraphs readable and cause-effect clear.",
          "Do not flatten the story into a simple linear quest. Include enough tension and decision points for later branching, but keep the presentation as a smooth story treatment.",
          "Do not narrate optional player behavior as already completed in expandedStory, plot, startState, or nodeOutcome. Avoid sentences like 玩家已经..., 玩家先做了..., 玩家发现了... unless the player action is written as an option, condition, or available intervention.",
          "NPCs may act without the player: for example Raven says a warning, Torin blocks the door, Alice walks to the fire, Borin hides coins, or Darius sends a threat.",
          "Player agency belongs in completionCondition, completionLogic, edge label, and transition. Use wording like 若玩家说服..., 如果获得..., 选择...后可进入..., rather than assuming the action happened.",
          "Make transitions clear: every edge label is a short playable trigger, and every edge transition explains the state change that unlocks the next node without forcing a single player route.",
          "Each node must include layer, nodePurpose, startState, plot, nodeOutcome, NPCs, items, locations, completionCondition, completionLogic, and next.",
          "Node completion is usually a condition gate. Use completionLogic.type='condition_gate' for these gates.",
          "Completion conditions can use affinity, companion status, money, item ownership from the provided item list, evidence, location state, or story flags.",
          "Use AND/OR/NOT explicitly in completionLogic.expression. Examples: (affinity:Alice >= 6 AND item:黑玻苦啤) OR companion:Torin; item:壁卫盾 AND money >= 100; companion:Raven OR companion:Alice; NOT flag:DariusEscaped.",
          "completionLogic.rules should list each atomic condition. Use kind values like affinity, companion, money, item, evidence, location_state, story_flag. Use operator values like >=, <=, =, has, not_has, true, false.",
          "completionLogic.effects should list consequences that happen when a condition is satisfied, especially relationship changes or mutually exclusive results.",
          "Support mutual exclusion when appropriate. Example: if the player becomes friend/companion with Alice, and Alice and Darius are enemies, add an effect such as trigger='companion:Alice' and effect='Darius affinity becomes 0 and Darius treats player as enemy'.",
          "completionCondition is the readable Chinese summary of completionLogic. It should be understandable to a designer without reading the rules.",
          "startState means the world and NPC situation when this node becomes available. It is not a dramatic hook and must not prescribe player behavior. For non-start nodes, it must clearly connect to at least one incoming edge transition.",
          "plot means the node's objective situation, NPC actions, background facts, and possible player interventions. It should be 5 to 8 plain sentences. Include at least two concrete NPC actions, one short direct speech line that explains cause or motive when NPCs are present, and one visible use or mention of a relevant item/location.",
          "Each node plot should feel like a complete small scene: beginning situation, NPC conflict or pressure, important action, choice pressure, and the state that points toward the completion condition.",
          "nodeOutcome means what has changed when the node condition is satisfied, written as a state change rather than a guaranteed player action. It should be 2 to 3 plain sentences and must prepare the next node's startState.",
          "Dialogue must be clear. When an NPC says something important, the line or the nearby sentence must explain what they are referring to, what happened before, and why it matters. Avoid cryptic lines that only sound dramatic.",
          "Every edge transition should be 1 to 2 clear sentences. It must mention what changed in the source node and why the target node becomes available. Avoid vague transitions like 然后进入下一节点.",
          "Maintain continuity across nodes. If an NPC, item, threat, promise, or clue appears in one node and matters later, carry it forward explicitly instead of resetting the scene.",
          "expandedStory should be detailed enough to support the main path and later branches, but written as a smooth story foundation instead of a branch outline.",
          "Respect the selected node structure exactly. Return only JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          originalStory: storyPrompt,
          selectedByGpt4o: selection,
          selectedStructure,
          levelData
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

  sendJson(res, 200, {
    ok: true,
    selection,
    structure: selectedStructure,
    levelDataSummary: {
      relativePath: levelData.relativePath,
      npcCount: levelData.npcs.length,
      itemCount: levelData.items.length,
      buildingCount: levelData.buildings.length
    },
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
