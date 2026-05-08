# NodeStory Skills

这个目录里每一个 `.md` 文件就是一个 **skill**——一份聚焦某个写作关注点的指令清单。生成故事时，服务器会按当前生成阶段（foundation / blueprint / detail）把相关的 skill 拼起来作为 system prompt。

## 为什么要分 skill

之前所有规则塞在一个巨型 system prompt 里，维护困难、阶段无关的规则也会被发到不需要它的阶段。拆成 skill 之后：

- 每个 skill 只管一件事（对白风格 / 条件规则 / 故事改编 / ...）
- 每个 skill 可以单独迭代而不影响其它部分
- 不同阶段可以挑不同 skill 组合
- 想加新 skill 直接写一个 `.md` 文件，重启服务器即可生效

## 文件格式

每个 skill 文件由两部分组成：YAML frontmatter + Markdown 主体。

```markdown
---
id: dialogue-voice
name: NPC 对话风格
description: 让 NPC 台词像游戏 NPC 而非诗人
scope: [detail]
order: 50
---

## Sentence shape
- 默认完整主谓宾...
- 一行只表达一件事...
```

### Frontmatter 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 全局唯一标识符（kebab-case） |
| `name` | 是 | 显示名（中文 OK） |
| `description` | 否 | 一句话描述这个 skill 管什么 |
| `scope` | 是 | 数组，标记哪些阶段需要这个 skill。可选值: `foundation` / `blueprint` / `detail` |
| `order` | 否 | 整数，越小越靠前；默认 100。一般用 0–100 区间 |

### 主体

主体就是普通 Markdown，会原样拼进 system prompt（`# {name}` 会自动作为该段标题）。

主体里允许使用 `{{占位符}}` 语法，目前支持：

- `{{topologySummary}}`：当前选中结构的拓扑摘要（节点列表、层级、边）

## 三个生成阶段

服务器会把每个阶段需要的 skill 按 `order` 排序后拼成 system prompt：

| 阶段 | 输出 | 一般包含的 skill |
|---|---|---|
| `foundation` | 故事底稿 / designDeck / layerNotes | 基础、故事改编、角色、结构拓扑 |
| `blueprint` | 节点蓝图（id / next / 简要 conditionIdea） | 基础、角色、结构拓扑、任务模式、分支条件 |
| `detail` | 完整节点（plot / keyDialogue / objectives / results / edges） | 全部 skill |

## 自检接口

服务器启动后，访问 `GET /api/skills` 可以看到当前加载到的 skill 列表（id / name / scope / order），方便确认有没有被正确拾取。

## 添加新 skill

1. 在 `skills/` 里新建一个 `.md` 文件，比如 `npc-emotion.md`
2. 写好 frontmatter + Markdown 主体
3. 重启 NodeStory 服务器
4. 检查 `/api/skills` 确认它被加载到了正确的阶段

## 注意事项

- `id` 不能和其它 skill 冲突，否则后加载的会覆盖先加载的
- `scope` 留空或不写则该 skill 不会被任何阶段加载
- 主体内容写得越具体（带例子、对照、禁词列表）效果越好；纯抽象指令模型容易飘
