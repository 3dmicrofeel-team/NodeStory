---
id: structure-topology
name: 节点结构拓扑约束
description: 强制使用 selectedStructure.topology 中的节点 id、层级、边连接，特殊节点角色（HUB / condition / ending）必须保留
scope: [foundation, blueprint, detail]
order: 30
---

## Selected structure topology — STRICT, NON-NEGOTIABLE

The selected structure is provided as `selectedStructure`, which includes both the human-readable structure file (`selectedStructure.content`) and a parsed topology (`selectedStructure.topology`). Treat the topology as the binding contract.

`selectedStructure.topology.nodeIds` lists the EXACT node ids you must use. You MUST output exactly these ids — same spelling, same casing — as the `id` of each node. Do not rename them (no `node_1`, `start`, `n2a` lowercase, `Hub`, `End1`, etc.). Do not add new ids beyond this list. Do not omit any id from this list. The number of nodes in your output MUST equal the number in `nodeIds`.

`selectedStructure.topology.edges` lists the EXACT directed edges. You MUST reproduce every edge with matching `from` and `to`. Do not add edges. Do not remove edges. Do not flip directions. Do not redirect a target.

`selectedStructure.topology.layerBuckets` defines which layer each node belongs to. Each generated node's `layer` MUST equal the layer specified there.

Each node's `next` array MUST equal that node's `outgoingTargets` from the topology, in the same order as listed there.

If the topology provides no outgoing edge for a node (e.g. the final node, or any node with role='ending'), that node's `next` MUST be `[]` and there MUST be no edge whose `from` equals that node's id.

If the topology marks a node with role='hub' (e.g. `HUB`), that node MUST be implemented as a hub: its completionLogic.type MUST be `exclusive_choice`, and the player visibly returns to it between branches. Its id MUST stay exactly `HUB` (uppercase).

If the topology marks a node with role='condition' (e.g. `N3` in 关键条件分流), that node is the single critical condition gate. Its completionLogic.type MUST be `success_or_fail_branch` when the topology gives it 2 outgoing targets, or `exclusive_choice` when it gives it 3+ outgoing targets. The branch outcomes must map 1:1 to those outgoing targets.

If the topology marks nodes with role='ending' (e.g. `E1`, `E2`, `E3`), each ending node MUST be terminal: `next=[]`, no outgoing edges, completionLogic.type='single_path_gate', and resultBranches=[]. The story content of each ending must be a distinct final outcome — different consequences, different player position, different state. Do not collapse two endings into the same outcome.

Convergence nodes that have multiple incoming edges from different branches MUST acknowledge both incoming states in `startState`, written as conditional alternatives (e.g. 如果玩家走的是 N3A 路线... / 如果玩家走的是 N3B 路线...).

When the topology has crossing edges (e.g. structure 2's `N2A → N3B` and `N2B → N3A`), preserve the cross exactly. The whole point of that structure is that the line started in one route ends up in the scene of the other route.

Do not invent extra layers, intermediate nodes, sub-branches, or shortcut paths. The topology is the entire shape of the story.

## Topology summary (current selection)

The following topology summary is the binding contract for THIS story. Reproduce it exactly:

{{topologySummary}}
