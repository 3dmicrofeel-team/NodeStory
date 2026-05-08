---
id: cast-and-characters
name: 角色档案与重要角色规则
description: 重要角色 / 次要角色分层、character dossier、单节点 NPC 与道具数量、单节点单地点
scope: [foundation, blueprint, detail]
order: 20
---

## 同层节点纪律

把所选 structure 看成层级。同一层的节点是平行的叙事选项，不是主线/支线关系。同层节点必须有可比的篇幅、风险、有用度和戏剧分量。

不要让同层节点变成换名 NPC 的同一场戏。每个平行节点要表达不同的方法、风险、道德角度或信息路径。

不要在分支内部嵌套子选择。一条分支可以有多个步骤，但不要再分裂出小分支，除非所选 structure 明确要求。

避免在一段话里堆叠多个条件词，比如"若选择…，若选择…，若已有…，若已有…"。把选择拆成独立的标签段落。

## Important vs secondary 角色

`Level_AI.npcs` 的 `importance` 字段已经把人物分成两层：`important` 和 `secondary`。

**important 角色**：主线围绕他们展开。每一层至少有一个 important NPC 在场。主对手和关键支持者必须在多个节点出现。

**secondary 角色**：用于点缀场景——商贩、证人、守卫、传话人、气氛 NPC。给他们小服务和单条事实传递的戏份就行，不要让 secondary 角色承担主冲突，也不要给他们编出 archetype 驱动的复杂动机。

## 单节点容量限制

每个节点通常**最多 3 个具名 NPC** 和 **最多 2 个重要道具**。超出必须每个都在该节点有直接戏份。

每个节点 **MUST 恰好包含 1 个地点**。`locations` 数组长度必须为 1，不能是 0，也不能是 2+。
- 选择该场景物理上发生的那一个地方——如果你在拍这场戏，摄像机会架在哪里。
- 地点名 MUST 来自 `levelData.buildings`（不要发明地名，不要改名）。
- 如果两个地方都觉得相关，挑对话和关键动作发生的那一个，另一个用 keyDialogue 或 plot 提及，不要塞进 `locations`。
- 相邻两个节点可以共用同一地点，但单个节点不能跨两个地点。

把核心道具控制在全故事 3–5 件。不要因为 Level_AI 数据里列出了某些道具就提到它们。

## Character dossier — 写台词前必读

部分 NPC 包含更详细的档案字段：`importance`、`archetype`、`personality`、`speakingStyle`、`speakingExamples`、`emotionalArc`、`coreMotivation`。当这些字段存在且非空时，把它们当作硬约束，不是风味文字；当它们缺失或为空时，回退到 NPC 的 state 和 background。

**说话风格**：为有 `speakingExamples` 的 important NPC 写 keyDialogue 时，新台词要听起来像那些示例——同样的节奏、同样的词汇范围、同样的态度。两个不同的 important NPC 不能写出可互换的台词。

**动作一致性**：为有 `archetype` + `personality` + `coreMotivation` 的 important NPC 写 keyAction 时，动作必须和这三项一致。冒险型倾向冒险、抢先动手；治愈型保护、安抚、修复；学术型核查证据、问精确问题。没有故事理由不要翻转。

**情绪推进**：跨节点时，每个 important NPC 的情绪状态必须沿 `emotionalArc` 推进，对玩家和其他 NPC 的行为做出反应。一旦某节点里他们的态度发生了变化，后续节点不要重置回起始状态。

**动机可见**：每个 important NPC 的 `coreMotivation` 必须在他出场的任意节点里，至少驱动一条 keyDialogue 或 keyAction。玩家应该能从他怎么说话、怎么行动里推断出他想要什么。
