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
            locations: { type: "array", items: { type: "string" } },
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
    "Limit the core cast to 3 to 5 important NPCs across the story unless the selected structure truly requires more. Other NPCs may be omitted.",
    "Limit the core props to 3 to 5 important items across the story. Do not mention many items just because they exist in Level_AI data.",
    "Each node should usually contain no more than 3 named NPCs and 2 important items. If more appear, they must have a direct role in that node.",
    "Avoid nested choices inside a branch. A branch may have steps, but it should not split into another mini-branch unless the selected structure explicitly requires it.",
    "Avoid stacking several condition words in one paragraph, such as 若选择..., 若选择..., 若已有..., 若已有.... Put choices into separate labeled branch sections.",
    "Respect the selected node structure exactly.",
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
    "keyDialogue: at least 5 entries, ideally 6 to 8, up to 10 if the scene has many NPCs or back-and-forth pressure. Treat dialogue as turns of conversation: question and answer, accusation and reply, plea and refusal, threat and counter, etc. The same NPC can speak multiple times, and different NPCs should react to each other.",
    "keyActions: at least 4 entries, ideally 5 to 7, up to 9 if more NPCs are present. Spread the actions across the scene — entering, reacting, escalating, retreating — not all bunched at one moment.",
    "keyDialogue items: { speaker: NPC name from Level_AI; line: a short direct quote in Chinese, ideally under 30 characters; intent: one sentence explaining what fact, motive, or pressure this line delivers to the player }.",
    "keyActions items: { actor: NPC name from Level_AI; action: a concrete physical action in Chinese, e.g. 把铜币塞进袖筒、走向火炉、拦在门口、把酒瓶推到玩家面前; intent: one sentence explaining what this action signals or sets up }.",
    "keyActions must describe NPC behavior only. Do not put player actions there. Player choices belong in completionLogic.objectives.",
    "Together, keyDialogue and keyActions must cover: (1) the cause of the conflict and any prior incident, (2) who blocks the goal and why, (3) the visible stakes and pressure on the player, (4) at least two distinct hooks the player can act on, (5) the emotional reaction of NPCs to the unfolding situation.",
    "Order keyDialogue and keyActions roughly in the chronological order they occur in the scene, so the reader can follow the beat-by-beat flow.",
    "Examples of useful explanatory dialogue: '他三天前收了我的钱却卖了我', '这瓶酒不是吧台的，是他从袖子里拿出来的', '我不敢作证，因为上次作证的人失踪了'.",
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
    "## Objective format (player-side tasks)",
    "completionLogic.objectives lists each visible task as a separate item. Each objective has: id, kind, target, operator, value, text.",
    "Use only these objective.kind values: affinity_min, affinity_max, friend, companion, enemy, not_enemy, defeated, item_obtained, item_lost, item_delivered, money_at_least, money_spent, fame_min, fame_max, story_flag.",
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
    "story_flag is allowed ONLY for binary outcomes that cannot be expressed by the kinds above and are externally verifiable, e.g. 'Borin 已签下证词'、'已护送 Eli 到神殿'、'村长已公开支持玩家'. Never use story_flag for emotional or relational states (use friend/affinity instead) or for vague progress markers.",
    "Every objective.text must reference at least one of: a specific number (金币、好感、名誉数值), a specific named NPC, a specific named item, or a specific binary flag. If you cannot point to one of these, the objective is too vague — rewrite it.",
    "Concrete kind/target/operator/value/text examples:",
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
    "  - { kind: 'story_flag', target: 'Borin 已签下证词', operator: '=', value: 'true', text: '让 Borin 当众签下证词' }",
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
    "## Edges",
    "Edge transitions must mention the relevant result that carries forward. Example: 因为 Alice 已成为伙伴，Darius 开始针对玩家; or 因为玩家收下 Darius 的钱，Alice 不再主动提供帮助.",
    "Each edge must include carriedResults: a short list of world-state results from the source node that matter to the target node. These should match the source node completionLogic.results when possible.",
    "Every edge transition should be 1 to 2 clear sentences. It must mention what changed in the source node and why the target node becomes available. Avoid vague transitions like 然后进入下一节点.",
    "",
    "Return only JSON."
  ].join("\n");
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

  const [structures, levelData] = await Promise.all([readStructures(), readLevelData()]);

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

  const foundationResponse = await callOpenAI(apiKey, {
    model: models.foundation,
    input: [
      {
        role: "system",
        content: [
          narrativeSystemPrompt(),
          "This stage writes only the complete story foundation and high-level narrative preparation.",
          "Do not write node details yet. Do not expose explicit branch labels in expandedStory.",
          "Return only JSON."
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
          "Respect the selected node structure exactly.",
          "Do not write full node prose. Create concise node purposes, state focus, condition ideas, and edge carried results.",
          "Use only NPCs, items, and locations from the provided Level_AI data.",
          "Return only JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          selectedStructure,
          foundation,
          levelData
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
          "Return the complete final node story JSON."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          originalStory: storyPrompt,
          selectedByGpt4o: selection,
          selectedStructure,
          foundation,
          blueprint,
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
    generationStages: [
      { stage: "structure", label: "结构选择", model: models.structure },
      { stage: "foundation", label: "故事底稿", model: models.foundation },
      { stage: "blueprint", label: "节点蓝图", model: models.blueprint },
      { stage: "detail", label: "节点细写", model: models.detail }
    ],
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
