# NodeStory

节点化叙事生成器，用于从自然语言故事生成可视化的分支节点剧情。

## 功能

- 在页面输入 OpenAI API key，并通过 `gpt-4o` 验证。
- 在页面下拉菜单中选择"推理模型"（用于结构选择和节点蓝图）和"写作模型"（用于故事底稿和节点细写），可选 `gpt-4o`、`gpt-4o-mini`、`gpt-4.1`、`gpt-5.1`、`gpt-5.4-mini`、`gpt-5.4`、`gpt-5.5`，选择会保存到本地。
- 读取 `NodeStructure/*.txt` 中的五种节点结构。
- 自动向上查找 `Doc/Level_AI` 下的素材：
  - `NPC.csv`
  - `Item.csv`
  - `Building.csv`
- 在"素材来源"勾选框可选择是否载入本地 NPC 和地点：
  - 勾选（默认）：使用本地 `NPC.csv` 和 `Building.csv`，与 `Item.csv` 一起送入生成。
  - 取消勾选：写作模型根据故事提示自动生成 6–10 个 NPC 和 3–5 个地点，字段结构与本地 CSV 解析后的数据一致（NPC：name/type/state/affinity/background；地点：name/resource/description）。
  - 道具始终从本地 `Item.csv` 读取，不会被替换。
- 使用分阶段生成：`gpt-4o` 选择结构，`gpt-5.5` 写故事底稿，`gpt-4o` 拆节点蓝图，`gpt-5.5` 细写节点与分支结果。
- 如果输入的是经典故事、历史桥段或文学母题，会先提炼核心精神，再用当前 NPC、道具和地点改编，而不是机械替换表层元素。
- 结构选择会根据五种结构的适用场景逐一评分，再选择最匹配故事运动方式的结构。
- 使用类似 Fabula / DND 发牌的叙事准备法，生成前提牌、冲突牌、地点牌、NPC 牌、道具牌、转折牌、代价牌和结局牌。
- 将同一层节点视为平级叙事选项，保证它们有接近的篇幅、风险、价值和戏剧重量。
- 故事保持直接清楚：一个主冲突、一个清晰目标，分支是解决同一问题的不同方式，而不是不断扩散的新支线。
- 默认控制核心 NPC 和核心道具数量，避免把素材表里的角色和物品都塞进同一个故事。
- 节点剧情以 NPC 对白和动作为主：每个有 NPC 的节点都会输出至少 5 条 `keyDialogue`（说话人 + 直接引语 + 这句话揭露的剧情意图，理想 6–8 条，最多 10 条）和至少 4 条 `keyActions`（NPC + 具体动作 + 动作含义，理想 5–7 条，最多 9 条），玩家通过 NPC 的多轮台词与可见行为理解剧情来龙去脉。
- 玩家通过具体任务推进剧情：筹集金钱、获得道具、把道具交付给某 NPC、说服某 NPC 成为朋友/伙伴、击败某 NPC、好感达到具体数值、避免成为某人敌人、提升名誉等，都会作为节点完成目标显式列出。
- 任务必须是机器可判定的具体 RPG 状态：禁止「理解 X 的处境」「与某人建立信任」「完成调查」这类无法直接验证的模糊条件；每条目标都必须指向一个具体数值、具名 NPC、具名道具或具体二值标记。
- 节点完成条件以直观任务目标呈现，主要由好感值、朋友关系、伙伴关系、敌对关系、击败状态、道具持有/交付、金钱、名誉组合而成；目标可用 AND / OR / NOT 组合，并带有完成结果。
- 任务目标用统一的字段结构：`kind`（affinity_min / affinity_max / friend / companion / enemy / not_enemy / defeated / item_obtained / item_lost / item_delivered / money_at_least / money_spent / fame_min / fame_max / story_flag）、`target`、`operator`、`value` 和易读的中文 `text`。
- 完成结果用统一的字段结构：`kind`（affinity / friend / enemy / companion / defeated / money / item / fame / route / story_flag）、`target`、`change`（如 +2 / -100 / set true / gain / close）、用于 UI 渲染的 `delta`（+2、-100、获得、击败、关闭、成立等）和易读的中文 `text`。
- 如果节点存在多个分支，完成结果会按分支分别列出，例如帮 Alice 和帮 Darius 会产生不同的好感、金钱、伙伴或敌对结果。
- 分支结果会作为后续节点的世界状态输入，例如帮 Alice 会影响 Darius 的态度，帮 Darius 会影响 Alice 的后续反应。
- 完整故事底稿会先写成一个顺畅的故事，不直接列出分支，但会保留后续可拆成节点和分支的关键决策点。
- 输出结构图、节点卡片和可导出的 JSON。

## 运行

```powershell
npm start
```

打开：

```text
http://localhost:4173
```

也可以双击：

```text
启动NodeStory.bat
```

## 路径说明

当前项目路径：

```text
F:\ChronicleForge\LLM_AI\NodeStory\NodeStory
```

素材目录当前位于：

```text
F:\ChronicleForge\Doc\Level_AI
```

程序会从当前项目目录开始，逐级向上查找 `Doc/Level_AI`。如果云端路径不同，也可以设置环境变量 `LEVEL_AI_DIR` 指向素材目录。

## 输出内容

整体故事包含：

- 生成阶段与每阶段使用的模型
- 自动选择的结构
- 选择理由
- 五种结构的选择评分
- 改编原则
- 故事上下文，包括玩家身份、主冲突、事发前因、失败代价
- 叙事发牌结果
- 完整故事底稿，作为后续节点拆分的详细基础
- 每层节点的平级规则
- 节点结构图

每个节点包含：

- 层级
- 节点作用
- 节点开始状态
- 节点剧情场景描述（plot）
- `keyDialogue`：NPC 对白条目（至少 5 条，理想 6–8 条），每条包含说话人、直接引语和这句话要传达的剧情意图
- `keyActions`：NPC 动作条目（至少 4 条，理想 5–7 条），每条包含动作发出者、具体动作描述和动作含义
- 节点结果，并为下一节点的开始状态做铺垫
- 出现的 NPC
- 出现的道具
- 故事发生地点
- 完成节点并开启下一节点的条件
- 任务目标列表，每条都是机器可判定的具体 RPG 状态（每条都有 kind / target / operator / value / text，例如 `friend:Alice = true`「说服 Alice 成为朋友」、`money_at_least:player >= 100`「筹集 100 金币」、`affinity_min:Raven >= 6`「Raven 好感度达到 6」、`defeated:Darius = true`「击败 Darius」、`item_delivered:黑玻苦啤->Alice = true`「把 黑玻苦啤 交给 Alice」）
- 通用完成结果与分支完成结果（每条都有 kind / target / change / delta / text，例如好感 +2、成为朋友、击败、成为敌人、金钱 -100、获得道具、名誉 +1、关闭某条路线）
- 后续节点

每条边包含：

- 短标签
- 自然衔接说明，说明上一节点改变了什么，以及为什么下一节点变得可进入
- 继承结果，说明上一节点哪些完成结果会影响下一节点
