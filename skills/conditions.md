---
id: conditions
name: 分支条件五类原子 + 剧情耦合
description: branching 节点的条件只能从 5 类原子中组合（金钱 / 道具 / 好感度 / 朋友 / 说服），并且每个条件必须由 NPC 台词当面讲出来
scope: [blueprint, detail]
order: 60
---

## Branching condition vocabulary — RESTRICTED to 5 categories (HARD RULE)

Definition: a node is a 'branching node' iff its `completionLogic.type` is `success_or_fail_branch` or `exclusive_choice`, OR it is the topology condition gate (role='condition', e.g. N3 in 关键条件分流). Every condition that decides which downstream branch fires at a branching node is a 'branching condition'.

Branching conditions MUST be built ONLY from the 5 atomic categories below. No other `objective.kind` values may appear in a branching node's `completionLogic.objectives`, in any `branchId.appliesWhen`, or in any `conditionIdea`. In particular, the kinds `defeated`, `enemy`, `not_enemy`, `fame_min`, `fame_max`, `item_lost`, `item_delivered`, `money_spent`, `story_flag` are NOT permitted as branching conditions. (They are still allowed in `single_path_gate` task nodes' objectives — those are non-branching task gates — except `story_flag` which is forbidden in ALL conditions; see next rule.)

### The 5 atomic categories

  1. 金钱条件 — `kind='money_at_least'`, `target='player'`, `operator='>='`, `value` 必须是具体数字。意思: 玩家累计持有的金币达到 N。
  2. 道具条件 — `kind='item_obtained'`, `target` 必须出自 `levelData.items` 的 name 列表（不得编造、不得用列表外的道具名）, `operator='='`, `value='true'`。意思: 玩家拥有该道具。
  3. 好感度条件 — `kind='affinity_min'`, `target` 必须出自 `levelData.npcs` 的 name 列表, `operator='>='`, `value` 必须是具体数字。意思: 玩家与该 NPC 的好感度达到 N。
  4. 朋友条件 — `kind='friend'`, `target` 必须出自 `levelData.npcs` 的 name 列表, `operator='='`, `value='true'`。意思: 玩家与该 NPC 已成为朋友。
  5. 说服条件 — `kind='companion'`, `target` 必须出自 `levelData.npcs` 的 name 列表, `operator='='`, `value='true'`。意思: 玩家通过对话说服了该 NPC 加入成为伙伴/同伴/亲密同行者。注意: 第 5 类**不再使用 story_flag**；如果故事需要的'说服'结果不是'成为伙伴'，请改写故事让它落到这 5 类中的另一类（例如改成 friend），或把该判定从 branching 节点移走。

### story_flag is FORBIDDEN as a condition (anywhere)

`story_flag` 不允许出现在任何 condition 表达里——包括：(a) 任意节点（无论 type 是 `single_path_gate` / `success_or_fail_branch` / `exclusive_choice`）的 `completionLogic.objectives`；(b) 任意 `resultBranches[].appliesWhen`；(c) blueprint 的 `conditionIdea`。换句话说，`story_flag` 不能用来'门槛检查'。

`story_flag` 仍然允许出现在 `completionLogic.results` 与 `resultBranches[].results` 里（即'结果/状态变化'），用于把'XX 已经发生'这种叙事性事件写入世界状态供游戏引擎引用。例: results 里可以写 `{ kind:'story_flag', target:'Borin 已签下证词', change:'set true', delta:'成立', text:'Borin 当众签下证词' }`；但任何后续节点都不得用 `story_flag:Borin 已签下证词` 当成判定门槛。

如果剧情需要把'某事已发生'当成后续节点的检查，请改用其它 kind（例如 friend / companion / item_obtained / affinity_min），或者重写故事，把该判定移除。

### How to combine these 5 atoms

Branching conditions can ONLY be Boolean combinations of the 5 atoms above, using ONLY these connectors:
  - 单条件: 一个原子即可，例: `item_obtained:黑玻苦啤=true`。
  - AND（同时满足）: 例: `item_obtained:黑玻苦啤=true AND affinity_min:Alice>=4`。
  - OR（任一满足）: 例: `friend:Alice=true OR friend:Borin=true`。
  - NOT（某条件未满足）: 用于表达 '没收集到 / 没成为朋友 / 没说服成功 / 好感度没达到' 等取反语义。例: `NOT(item_obtained:破灯笼=true)`（玩家没有破灯笼）、`NOT(friend:Darius=true)`（与 Darius 没成为朋友）、`NOT(money_at_least:player>=100)`（金币不足 100）。

可以混合使用，例: `(money_at_least:player>=50 AND friend:Alice=true) OR companion:Torin=true`。但每一项原子都必须严格属于上述 5 类，target 必须真实存在（道具来自 `levelData.items`，NPC 来自 `levelData.npcs`）。

### Applying combinations to each branching pattern

  - role='condition' 关键条件分流节点（结构 4 的 N3 等）: `completionLogic.objectives` 列出涉及到的全部原子条件；每条 `resultBranches[].appliesWhen` 必须是上述 5 类原子的 AND/OR/NOT 组合；不同分支的 appliesWhen 必须互斥（任意输入最多命中一条）；ELSE 分支等价于'前面所有 IF 取 NOT 后再 AND'。
  - `success_or_fail_branch`: success 分支的 appliesWhen 必须是 5 类原子的组合；failure 分支的 appliesWhen 必须是 success 的逻辑取反，不得引入额外原子。
  - `exclusive_choice`: 每个 `branch.appliesWhen` 必须命中不同的 target（不同 NPC、不同道具、不同金额）；不得让两个分支检查同一个对象。

### Forbidden branching conditions

下列写法绝对不允许出现在任何 branching 节点的 objectives / appliesWhen / conditionIdea 中: '玩家心境平和'、'真相被揭开'、'气氛缓和'、'守卫被说服'（→ 改写成 friend / companion；不允许 story_flag）、'玩家有勇气'、'玩家选择正义'、'玩家走和解线'、'剧情合适'、'若玩家了解内情'、'击败 X'（→ branching 不允许 defeated；战斗结果走 `single_path_gate`）、'名誉达到 N'（→ branching 不允许 fame）、'与 X 成为敌人'（→ branching 不允许 enemy；改用 `NOT(friend:X=true)`）、任何 `story_flag:...` 形式的检查（→ `story_flag` 只能在 results 里出现，绝不能用于条件判定）。

如果你想到的条件无法翻译成上述 5 类原子的 AND/OR/NOT 组合，说明它不是合格的分支条件，必须改写为这 5 类的组合，或干脆改写故事，把该判定移出 branching 节点。

### Branch ↔ Node 一一对应（必须清晰可读）

branching 节点的每个分支必须显式回答 '完成哪个条件 → 走哪个下游节点'。具体要求：
  - `completionLogic.summary` 必须用一行人话写出 1:1 的映射。例: '完成条件1（玩家持有 黑玻苦啤 AND Alice 好感度 ≥ 4）→ N4A；完成条件2（玩家持有 破灯笼 AND NOT(friend:Alice=true)）→ N4B；其它情况 → N4C。'
  - 每条 `resultBranches[]` 的 appliesWhen 都必须**只对应 1 个下游节点**（`branch.to` 数组长度恰好为 1），不允许一个分支同时通向多个下游。
  - 不同分支的 appliesWhen 必须互斥：任何一种玩家状态最多命中一条（除 ELSE 之外），ELSE 等价于'前面所有 IF 取 NOT 后再 AND'。
  - 不同分支的 `branch.to` 不得指向同一个下游节点（即不同条件不能殊途同归到同一个节点；如果你想让多条线汇合，应该靠下一层的汇合节点处理）。
  - `branch.to` 必须是 `selectedStructure.topology` 中由该 gate 节点的 `outgoingTargets` 列出的目标 id；不要编造下游 id。
  - `completionLogic.objectives` 中列出的全部原子，必须能把所有 resultBranches 的 appliesWhen 拼出来；不要在 appliesWhen 里引用未在 objectives 中出现的原子。

## Story–condition coupling — branching conditions MUST be voiced as story (HARD RULE)

分支条件不只是机器检查项，它同时是 NPC 当面提出来的请求/秘密/承诺/门槛。玩家应该是听 NPC 说话才知道'要做什么'，而不是从 UI 里去猜。

对每一个出现在任意 branching 节点中的 atomic 条件（gate 节点的 objectives 与 `resultBranches[].appliesWhen` 里出现的全部原子，去重后），故事里 MUST 至少有一条 keyDialogue 把这个条件用自然中文讲出来。讲出条件的位置可以是：(a) gate 节点本身的 keyDialogue，(b) gate 之前的某个上游节点（更推荐，让玩家有时间去做）。两者至少要有一处。

### How each category should be voiced in keyDialogue

  1. 金钱条件: NPC 直接开价，必须念出具体数字。例: '帮我凑齐 100 金币吧，我才付得起赎金。' / '少于 50 金币，这事我不接。'
  2. 道具条件: NPC 点名要哪件东西，必须念出 `levelData.items` 里的具体道具名。例: '你得先把 黑玻苦啤 给我，没那瓶酒老乐手不肯开口。' / '没拿到 带血手帕，就别再来找我。'
  3. 好感度条件: NPC 暗示需要更亲近的关系，不要求直读数字，但要让玩家听出'现在还不够'、'多打几次交道'。例: '我们才认识不久，再多走动几次我才肯松口。' / '你不是我熟人，这种话我对你说不出口。'
  4. 朋友条件: NPC 把'朋友'当门槛。例: '有一个秘密我只告诉我最好的朋友。' / '只有真正的朋友才会知道这条暗道在哪儿。' / '你要是真把我当朋友，今晚就来后院。'
  5. 说服条件: NPC 把'让某人加入'这件事当面交给玩家，必须念出被说服者的具体名字。例: '你能说服安娜跟我们一起走吗？' / '帮我说服 Torin 加入我们的小队。' / '没有 Raven 同行，这趟我去不了；你帮我把她劝过来。' （第 5 类只能落到 companion，所以台词要点出'加入/同行/同伴'这层意思，不要写成'让 X 作证 / 让 X 放行 / 让 X 签字'之类没法对应到 companion 的请求。）

### Voicing NOT conditions

用 NOT 包起来的原子，对应的台词是'反向暗示'，告诉玩家'某事一旦发生，机会就没了'。例: `NOT(item_obtained:破灯笼=true)` → '你要是真带着 破灯笼 来，我可不接你这茬。' / `NOT(friend:Darius=true)` → '我可不跟 Darius 的朋友说真话，你最好别和他混在一起。'

### Coupling rules

  - 每条 voicing 台词 MUST 含具体数值（金币数、好感度档次描述）、具体道具名（来自 `levelData.items`）或具体 NPC 名（来自 `levelData.npcs`）。'帮我个忙'、'证明你的诚意'、'拿点东西过来' 这类没指名道姓的台词不算数。
  - 一条台词内只表达一个原子；如果 gate 同时检查多个原子，分别用多条 keyDialogue 表达，不要把所有条件压进一句话里。
  - voicing 台词的 NPC 应当是该条件的'受益者'或'把关者'（例如要钱的就是收钱人，要被说服的对象就是任务发布者）；不要让无关 NPC 念条件。
  - voicing 还要在 plot 里被一句话点明，让玩家从场景描写也能看出'这个条件存在'。
  - 同一原子若在多个 branching 节点重复出现（例如串联门槛），可以在多个节点里重复 voicing，每次贴合当下情境换一种说法，不要照搬同一句台词。

### Item & NPC reference rule (重申)

branching 条件里出现的任何道具名 MUST 严格出自 `levelData.items` 的 name 字段；任何 NPC 名 MUST 严格出自 `levelData.npcs` 的 name 字段。对应的 voicing 台词里念出来的名字也必须用同样的名字，不能用别名、外号或缩写。

When the structure is 关键条件分流 (4) and has the role='condition' node, the `conditionIdea` / `completionLogic.summary` MUST clearly state which 5-category combination the gate checks, e.g. '检查 (item_obtained:带血手帕=true AND affinity_min:Alice>=4) → N4A; (item_obtained:破灯笼=true AND NOT(friend:Alice=true)) → N4B; ELSE → N4C'.
