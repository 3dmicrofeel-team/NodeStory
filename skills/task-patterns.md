---
id: task-patterns
name: 任务模式与边
description: 三种 completionLogic.type（single_path_gate / success_or_fail_branch / exclusive_choice），以及每种 pattern 对应的 edges 形态
scope: [blueprint, detail]
order: 50
---

## Player advancement through tasks, not narration

The player advances the story by making choices and completing tasks: 筹集金钱、获得道具、把道具交给某 NPC、说服某 NPC（让其成为朋友/伙伴或同意做某事）、击败某 NPC、与某 NPC 成为朋友/伙伴、提升好感度、提升名誉、避免成为某人敌人、为某 NPC 出面作证 等。

Each node's `completionCondition` must read like an obvious quest objective, not like dramatic narration. Players must know what they need to do to leave the node.

`completionLogic.summary` should be one short sentence summarizing the player's current task in the scene, e.g. 帮 Alice 筹齐 100 金币并说服 Borin 成为伙伴.

`completionLogic.expression` must use AND/OR/NOT explicitly and stay readable. The kinds you may reference depend on the node's `completionLogic.type`:
  - `single_path_gate` 节点：可以使用 objectives-and-results 中列出的全部 kind（包括 `defeated`、`enemy`、`fame_min`、`item_delivered` 等）。例: `defeated:Darius`、`item_obtained:黑玻苦啤 AND money_at_least:player>=100`、`fame_min:player>=4`。
  - `success_or_fail_branch` / `exclusive_choice` 节点（即 branching 节点）：expression 只能由 conditions skill 列出的 5 类原子（`money_at_least` / `item_obtained` / `affinity_min` / `friend` / `companion`）的 AND/OR/NOT 组合构成。例: `friend:Alice AND money_at_least:player>=100`、`item_obtained:黑玻苦啤 AND affinity_min:Raven>=6`、`companion:Torin OR companion:Raven`、`friend:Alice AND NOT(item_obtained:破灯笼=true)`。具体规则与 forbidden 清单见 conditions skill。

## Task patterns — every node MUST pick exactly ONE of these three patterns

Every node's `completionLogic.type` MUST be EXACTLY one of: `single_path_gate`, `success_or_fail_branch`, or `exclusive_choice`. Never invent other type values; never leave it free-form.

Pick the pattern from the player's actual choice space at this node, then build objectives, results, resultBranches, node.next, and outgoing edges to match.

### Pattern 1 — single_path_gate (必须通关)

Use when the player MUST satisfy a hard requirement before they can continue, with NO alternate failure path. If they fail, they stay stuck at this node and can retry. This also covers 'parallel collect' (multiple objectives joined by AND).

Typical examples: 战胜守门怪物才能通过, 凑齐 100 金币才能进城, 同时拿到证人和物证才能开庭.

Required shape:
  - `completionLogic.type` = `single_path_gate`
  - `completionLogic.objectives`: 1 or more required objectives, AND-combined（每条 objective 的字段格式见 objectives-and-results skill）。expression 的 AND-合取示例: `defeated:Darius`、`item_obtained:黑玻苦啤 AND money_at_least:player>=100`、`item_delivered:带血手帕->Alice`。
  - `completionLogic.results`: world-state changes that ALWAYS fire on completion (no alternate outcomes here).
  - `completionLogic.resultBranches`: MUST be an empty array `[]`.
  - `node.next`: EXACTLY ONE downstream id, e.g. `['N3']`.
  - Outgoing edges: EXACTLY ONE edge from this node, label like '继续推进', '通过此关', '进入下一阶段'.

### Pattern 2 — success_or_fail_branch (成败分流)

Use when ONE critical attempt has a binary outcome and the story continues either way along DIFFERENT downstream nodes.

Typical examples: 说服 Alice 成功走和解线, 失败走对抗线; 凑齐 100 金币按时还债走信任线, 没凑够走逃亡线。

注意: 战斗胜败不适合放在 `success_or_fail_branch`——`defeated` 不属于 conditions skill 的 5 类原子，因此战斗结果应走 `single_path_gate`（必须打赢才能继续），或者把战斗改写成说服 / 立约的二选一。

Required shape:
  - `completionLogic.type` = `success_or_fail_branch`
  - `completionLogic.objectives`: list ONLY the success-side check（必须用 conditions skill 的 5 类原子，例: `friend:Alice`、`companion:Torin`、`item_obtained:黑玻苦啤 AND affinity_min:Alice>=4`）。The branch decides which side fires。注意: `defeated` 不在 5 类原子里，所以"战斗胜败"不能写成 `success_or_fail_branch`——战斗结果走 `single_path_gate`，或重写为说服线。
  - `completionLogic.results`: empty `[]`, OR only results that fire regardless of outcome (rare).
  - `completionLogic.resultBranches`: EXACTLY 2 entries.
      - `branchId='success'`, `appliesWhen='玩家成功 ...'`, `to=[N成功]`, `results=[正面结果]`
      - `branchId='failure'`, `appliesWhen='玩家未能 ...'`, `to=[N失败]`, `results=[负面结果或代价，例如 enemy/affinity 下降/money 损失]`
  - The two branches' `.to` arrays MUST point to DIFFERENT downstream node ids; success and failure must NOT converge to the same node here.
  - `node.next`: EXACTLY two ids, success first then failure, e.g. `['N3A','N3B']`.
  - Outgoing edges: EXACTLY two edges from this node, e.g. label='说服成功' / label='说服失败' or label='击败 Darius' / label='败给 Darius'.

### Pattern 3 — exclusive_choice (互斥多选)

Use when the player has 2 to 4 mutually exclusive options at this node; choosing one closes the others.

Typical examples: 与 Alice / Borin / Selene 三人之一成为朋友; 说服 Torin 或 Raven 之一加入伙伴; 把好感度推到 Alice ≥ 6 或 Borin ≥ 6 之一。

注意: "把徽章交给 X 或交给 Y"这种 `item_delivered` 选择不能直接做成 `exclusive_choice`——`item_delivered` 不在 5 类原子里。要么改写为"和 X 结为朋友 / 和 Y 结为朋友"等价的 friend 二选一，要么把交付动作放在下游节点的 `single_path_gate` 里。

Required shape:
  - `completionLogic.type` = `exclusive_choice`
  - `completionLogic.objectives`: list each possible choice as a SEPARATE objective (one per option). They are OR-combined in expression. Example expression: `friend:Alice OR friend:Borin OR friend:Selene`.
  - `completionLogic.results`: empty `[]`. All consequences are per-branch.
  - `completionLogic.resultBranches`: 2 to 4 entries — ONE branch per choice. Each `branch.to` MUST contain a SINGLE downstream node id, and the `.to` arrays across branches MUST NOT overlap.
  - Each `branch.results` MUST encode mutual exclusion: include BOTH (a) the chosen relation/state becoming true (e.g. `friend:Alice` set true) AND (b) results that close the other choices (e.g. route 'Borin 友谊线' close, route 'Selene 友谊线' close, OR `affinity:Borin -2`, etc.). Use route close, friend set false, or affinity decrease as the closing mechanism.
  - `node.next`: list every downstream id once, in branch order, e.g. `['N3A','N3B','N3C']`.
  - Outgoing edges: ONE edge per choice; labels reference the choice itself, e.g. '选择 Alice', '选择 Borin', '选择 Selene' 或 '说服 Torin 加入', '说服 Raven 加入'.

## Pattern selection rules

- A 'gate that must be passed before continuing' → `single_path_gate`.
- The same checkable attempt branching the story into two different downstream lines → `success_or_fail_branch`.
- The player picks among 2 or more identifiable, comparable options that close each other → `exclusive_choice`.
- A node has EXACTLY ONE pattern. Do not mix.
- Convergence (汇合) nodes are typically `single_path_gate` — players just need to arrive with carried state.
- Terminal endings have no outgoing edges and no next; treat the final layer as `single_path_gate` with `node.next=[]` and `resultBranches=[]`; this is the only legal way to end.
- Pattern choice must be consistent with the selected node structure. For 双线分支交错汇合 (1) and 关键条件分流 (4), `success_or_fail_branch` and `exclusive_choice` are common; for 中心 HUB 多路线 (3), `exclusive_choice` belongs at the hub; for 多结局分支 (5), use `exclusive_choice` or `success_or_fail_branch` at the divergence point.

## Edges — must align with the task pattern

The number and shape of outgoing edges from a node MUST match its `completionLogic.type`:
  - `single_path_gate` → exactly 1 outgoing edge.
  - `success_or_fail_branch` → exactly 2 outgoing edges; one corresponds to `branchId='success'`, the other to `branchId='failure'`. The edge label must say so plainly (e.g. '说服成功' / '说服失败', '击败 Darius' / '败给 Darius').
  - `exclusive_choice` → exactly N outgoing edges where N equals the number of resultBranches. Each edge corresponds to one choice. The edge label must name the choice (e.g. '选择 Alice', '把徽章交给 Borin').

`edge.from` + `edge.to` MUST match a (sourceNode, branch.to[0]) pair. Do not produce edges that are not represented in the source node's resultBranches (or, for `single_path_gate`, in the source node's results).

`edge.transition` (1 to 2 clear sentences) must reference the concrete state change that fired in the source node, e.g. '因为玩家成功说服 Alice 出庭，议事会愿意听她的证词' or '因为玩家败给 Darius，被关进酒馆地下室等待审讯'. Avoid vague transitions like 然后进入下一节点.

Each edge MUST include `carriedResults`: a short list of world-state results from the source node that matter to the target node. For `success_or_fail_branch` and `exclusive_choice`, `carriedResults` must mirror that branch's results (only that branch — not the whole node).

If the source node is `single_path_gate`, `carriedResults` mirrors `completionLogic.results`.

Do not add edges between nodes that no pattern would produce (e.g. an edge with no matching branch). Do not duplicate edges to the same target.
