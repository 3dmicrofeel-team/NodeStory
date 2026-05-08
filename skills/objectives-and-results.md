---
id: objectives-and-results
name: 目标与结果字段格式
description: completionLogic.objectives / completionLogic.results / resultBranches[].results 的字段写法与示例
scope: [detail]
order: 70
---

## Objective format (player-side tasks)

`completionLogic.objectives` lists each visible task as a separate item. Each objective has: `id`, `kind`, `target`, `operator`, `value`, `text`.

Use only these `objective.kind` values: `affinity_min`, `affinity_max`, `friend`, `companion`, `enemy`, `not_enemy`, `defeated`, `item_obtained`, `item_lost`, `item_delivered`, `money_at_least`, `money_spent`, `fame_min`, `fame_max`. Note: `story_flag` is NOT a permitted `objective.kind` — it may only appear in `results` / `resultBranches[].results` (world-state changes), never in conditions.

`objective.target` is the NPC name, item name, or flag id. `objective.operator` is one of `>=`, `<=`, `=`, `!=`, `true`, `false`. `objective.value` is a string number, true/false, or item/flag id.

`objective.text` is the human-readable quest objective in Chinese, written like an in-game task line. It must be a concrete checkable RPG state.

## Strict rule: tasks must be machine-checkable

Every objective MUST be an unambiguous RPG state check that the engine can evaluate against numbers, inventory, NPC relations, or binary flags. Avoid any objective whose success or failure depends on subjective judgment.

FORBIDDEN vague objective texts (do NOT generate these): 理解 Alice 的处境, 感受到 Borin 的压力, 与村民建立信任, 完成调查, 揭开真相, 体会 Raven 的牺牲, 让玩家有所成长, 思考是否值得.

REQUIRED concrete objective patterns (use these forms):
  - 筹集金钱: `kind=money_at_least`, `target=player`, `operator='>='`, `value` 是具体数字, `text='筹集 N 金币'`
  - 获得道具: `kind=item_obtained`, `target` 是具体道具名, `operator='='`, `value='true'`, `text='获得 <道具名>'`
  - 交付道具: `kind=item_delivered`, `target='<道具名>->NPC名'`, `operator='='`, `value='true'`, `text='把 <道具名> 交给 <NPC>'`
  - 说服成为朋友: `kind=friend`, `target=NPC`, `operator='='`, `value='true'`, `text='说服 <NPC> 成为朋友'`
  - 说服成为伙伴: `kind=companion`, `target=NPC`, `operator='='`, `value='true'`, `text='说服 <NPC> 成为伙伴'`
  - 提升好感度: `kind=affinity_min`, `target=NPC`, `operator='>='`, `value` 是具体数字, `text='<NPC> 好感度达到 N'`
  - 击败某人: `kind=defeated`, `target=NPC`, `operator='='`, `value='true'`, `text='击败 <NPC>'`
  - 避免敌对: `kind=not_enemy`, `target=NPC`, `operator='='`, `value='true'`, `text='避免让 <NPC> 把玩家视为敌人'`
  - 提升名誉: `kind=fame_min`, `target=player`, `operator='>='`, `value` 是具体数字, `text='名誉达到 N'`
  - 花费金钱: `kind=money_spent`, `target=player`, `operator='>='`, `value` 是具体数字, `text='付出 N 金币'`

`story_flag` is FORBIDDEN as an `objective.kind` in any node, regardless of the node's `completionLogic.type`. `story_flag` is only allowed in `results` / `resultBranches[].results` (世界状态变化), never in `objectives`. If the story needs '某事已发生' as a future check, model it via friend / companion / item_obtained / affinity_min / money_at_least, or restructure to remove the check.

Every `objective.text` must reference at least one of: a specific number (金币、好感、名誉数值), a specific named NPC, or a specific named item. If you cannot point to one of these, the objective is too vague — rewrite it.

Concrete kind/target/operator/value/text examples (note: no `story_flag` here — it is only allowed in results):
  - `{ kind: 'friend', target: 'Alice', operator: '=', value: 'true', text: '说服 Alice 成为朋友' }`
  - `{ kind: 'companion', target: 'Torin', operator: '=', value: 'true', text: '说服 Torin 成为伙伴' }`
  - `{ kind: 'affinity_min', target: 'Raven', operator: '>=', value: '6', text: 'Raven 好感度达到 6' }`
  - `{ kind: 'money_at_least', target: 'player', operator: '>=', value: '100', text: '筹集 100 金币' }`
  - `{ kind: 'money_spent', target: 'player', operator: '>=', value: '50', text: '付给 Borin 50 金币' }`
  - `{ kind: 'item_obtained', target: '黑玻苦啤', operator: '=', value: 'true', text: '获得 黑玻苦啤' }`
  - `{ kind: 'item_delivered', target: '黑玻苦啤->Alice', operator: '=', value: 'true', text: '把 黑玻苦啤 交给 Alice' }`
  - `{ kind: 'defeated', target: 'Darius', operator: '=', value: 'true', text: '击败 Darius' }`
  - `{ kind: 'not_enemy', target: 'Darius', operator: '=', value: 'true', text: '避免让 Darius 把玩家视为敌人' }`
  - `{ kind: 'fame_min', target: 'player', operator: '>=', value: '4', text: '名誉达到 4' }`

## Result format (world-state changes)

Completion results are world-state changes, not decorative notes. Later nodes must respect them in `startState`, `plot`, `nodeOutcome`, edge transitions, and future `completionLogic`.

Use only these `result.kind` values: `affinity`, `friend`, `enemy`, `companion`, `defeated`, `money`, `item`, `fame`, `route`, `story_flag`.

Each result has: `kind`, `target`, `change`, `delta`, `text`.
  - `change` is the canonical state change in short tokens. Allowed forms: `+N` / `-N` for numbers, `set true` / `set false` for boolean states, `gain` / `lose` for items, `open` / `close` for routes.
  - `delta` is a short signed string used purely for UI rendering: e.g. `+2`, `-3`, `+100`, `-50`, `获得`, `失去`, `开启`, `关闭`, `成立`, `解除`. It must agree with `change`.
  - `text` is the human-readable consequence in Chinese, e.g. 'Alice 好感度 +2，把玩家当作可信的朋友', 'Darius 把玩家视为敌人，好感度变为 0', '玩家失去 100 金币，因为这笔钱交给 Alice'.

Concrete result examples:
  - `{ kind: 'affinity', target: 'Alice', change: '+2', delta: '+2', text: 'Alice 好感度 +2' }`
  - `{ kind: 'friend', target: 'Alice', change: 'set true', delta: '成立', text: 'Alice 成为玩家的朋友' }`
  - `{ kind: 'enemy', target: 'Darius', change: 'set true', delta: '成立', text: 'Darius 把玩家视为敌人' }`
  - `{ kind: 'companion', target: 'Torin', change: 'set true', delta: '成立', text: 'Torin 加入玩家成为伙伴' }`
  - `{ kind: 'defeated', target: 'Darius', change: 'set true', delta: '击败', text: '玩家击败 Darius，他被赶出酒馆，无法再阻挠' }`
  - `{ kind: 'money', target: 'player', change: '-100', delta: '-100', text: '玩家失去 100 金币，交给 Alice' }`
  - `{ kind: 'item', target: '黑玻苦啤', change: 'gain', delta: '获得', text: '玩家获得 黑玻苦啤' }`
  - `{ kind: 'item', target: '银扣短刀', change: 'lose', delta: '失去', text: '玩家把 银扣短刀 交给 Borin' }`
  - `{ kind: 'fame', target: 'player', change: '+1', delta: '+1', text: '名誉 +1，村里的人开始信任玩家' }`
  - `{ kind: 'route', target: 'Alice 同伴线', change: 'close', delta: '关闭', text: '关闭 Alice 同伴线' }`

## Shared vs branch-specific results

`completionLogic.results` is only for results shared by every completion path. If different branches have different outcomes, put those outcomes in `completionLogic.resultBranches` instead of merging them.

`completionLogic.resultBranches` must describe branch-specific results when the node has multiple outgoing edges, OR objectives, mutually exclusive choices, or different factions/NPCs to support. Each branch must name which condition it applies to, which target nodes it can lead to, and the results for that branch.

Branch-specific results should be meaningfully different. Example: branch 帮助 Alice → `{ Alice affinity +2, friend:Alice set true, Darius enemy set true }`; branch 帮助 Darius → `{ Darius affinity +2, money +50, Alice affinity -3, route Alice 同伴线 close }`.

If money is collected for someone, include the cost result. Example: objective 筹集 100 金币; result `kind='money'`, `change='-100'`, `delta='-100'`, `text='玩家失去 100 金币，交给 Alice'`.

Support mutual exclusion when appropriate. Example: if becoming friends with Alice makes Darius hostile, add result `kind='enemy'`, `target='Darius'`, `change='set true'`, `delta='成立'`, `text='Darius 把玩家视为敌人'`.

When the structure branches, each branch should have distinct completion results. Do not write later nodes as if all branches produced the same state. If incoming paths have different results, either write the target node's `startState` to acknowledge both possible states, or use separate target nodes when the selected structure allows it.
