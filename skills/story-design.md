---
id: story-design
name: 故事改编与底稿
description: 把用户输入的故事抽象成可玩剧情，并铺出故事底稿（adaptation / storyContext / designDeck / expandedStory / layerNotes）
scope: [foundation, detail]
order: 10
---

## 故事改编 (adaptation)

如果用户给的是知名故事、神话、历史场景或文学情节，**不要机械换皮**。先抽出它持久的戏剧主题，再用当前关卡的可用 NPC、道具、地点把这个主题改编成新故事。

例：桃园结义 → 抽出"三个志同道合的人在压力下选择结拜并共赴冒险"这个主题。**不要保留原作的具体人名、地名、原始事件**——不需要刘备、关羽、张飞，不需要真的桃园，不需要黄巾起义。新故事的人名 MUST 来自 `levelData.npcs`，地点 MUST 来自 `levelData.buildings`，道具 MUST 来自 `levelData.items`。

改编必须保留情感引擎：这些人为什么彼此需要、什么风险让誓言/结盟有分量、誓言之后开启了什么冒险、什么可玩动作能证明这份联结。

## 故事底稿字段

写节点之前，先填好下面这些底稿字段。它们是后续所有节点共享的事实基础。

### `storyContext`（故事背景）

四个子字段，每个一两句中文：
- `playerRole`：玩家在这个故事里是什么人、当前处境是什么。
- `mainConflict`：核心冲突是什么——谁和谁因为什么对立。
- `priorIncident`：故事开始之前刚发生过什么，让现在变得紧迫。
- `stakes`：如果玩家什么都不做，会失去什么。

这四项是玩家代入角色所必须知道的事实。

### `designDeck`（设计牌组）

写节点之前像 Fabula / 桌游 DM 那样发一手牌：premise card（前提）、conflict card（冲突）、location card（主场景）、NPC face cards（重要 NPC 各一张）、item clue/cost cards（关键道具：作为线索的、作为代价的）、twist card（一处反转，可选）、cost card（玩家要付出的代价）、resolution card（理想收束方式）。

把最终发出来的牌组写进 `designDeck` 字段，每张牌一行简要说明。这不是对玩家展示的内容，是给生成节点时的备忘。

### `expandedStory`（扩写故事）

8–15 句中文叙事，把 storyContext 和 designDeck 串成一个完整的故事缩写。从前情写到收束，让人读完知道整个关卡讲什么。不要写成大纲式的"先 A 然后 B 接着 C"——要有场景感。

`expandedStory` 不规定玩家具体行为；用"玩家可能…"、"玩家如果选择…"这种表述。

### `layerNotes`（分层备注）

为 `selectedStructure.topology.layerBuckets` 里每一层写一句话备注：这一层在故事里负责什么阶段（开场 / 冲突展开 / 关键抉择 / 收束）、玩家在这层的核心任务大致是什么。这是后面写节点时的层级路标。

## 简洁原则

保持故事直接。一个主冲突、一个主对立力量、一个清晰目标。分支应该是解决同一主问题的不同方法，不是新的副线。

不要在简单因果路径就能成立时，硬塞反转、假线索、隐藏债务、额外证人或诱饵计划。
