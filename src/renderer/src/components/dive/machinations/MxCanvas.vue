<template>
  <div
    ref="rootRef"
    class="mx-canvas"
    :class="[
      `theme-${store.canvasTheme.value}`,
      { panning: !!panState, connecting: !!connectDrag, placing: isNodeTool }
    ]"
    tabindex="0"
    @keydown="onKeyDown"
    @click="closeMenus"
  >
    <svg
      ref="svgRef"
      class="mx-svg"
      @pointerdown="onBgPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointerleave="onPointerUp"
      @wheel.prevent="onWheel"
      @contextmenu.prevent="onCanvasContextMenu"
    >
      <defs>
        <pattern
          id="mx-grid"
          :width="20 * store.view.zoom"
          :height="20 * store.view.zoom"
          patternUnits="userSpaceOnUse"
          :x="store.view.x"
          :y="store.view.y"
        >
          <circle cx="1.2" cy="1.2" r="1.15" class="mx-grid-dot" />
        </pattern>
        <marker
          id="mx-arrow"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,1.2 L10,5 L0,8.8 z" fill="#94a3b8" />
        </marker>
        <marker
          id="mx-arrow-sel"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,1.2 L10,5 L0,8.8 z" fill="#3d8bfd" />
        </marker>
        <marker
          id="mx-arrow-state"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,1.2 L10,5 L0,8.8 z" fill="#38bdf8" />
        </marker>
        <marker
          id="mx-arrow-neg"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,1.2 L10,5 L0,8.8 z" fill="#f87171" />
        </marker>
      </defs>

      <rect class="mx-bg" x="0" y="0" width="100%" height="100%" fill="url(#mx-grid)" />

      <g :transform="`translate(${store.view.x}, ${store.view.y}) scale(${store.view.zoom})`">
        <!-- ══════════ 子系统分组容器层 (Subsystem Group Frames) ══════════ -->
        <g
          v-for="grp in store.doc.value.groups ?? []"
          :key="grp.id"
          class="mx-group"
          :transform="`translate(${grp.x}, ${grp.y})`"
          @pointerdown.stop="startGroupDrag(grp, $event)"
        >
          <rect
            x="0"
            y="0"
            :width="grp.width"
            :height="grp.height"
            rx="10"
            class="mx-group-bg"
            :style="{
              stroke: grp.color || '#3b82f6',
              fill: `color-mix(in srgb, ${grp.color || '#3b82f6'} 8%, transparent)`
            }"
          />
          <rect
            x="0"
            y="0"
            :width="grp.width"
            height="26"
            rx="10"
            class="mx-group-hdr"
            :style="{
              fill: `color-mix(in srgb, ${grp.color || '#3b82f6'} 22%, var(--mx-node-fill))`
            }"
          />
          <text x="12" y="17" class="mx-group-title" @dblclick.stop="startGroupLabelEdit(grp)">
            {{ grp.label }}
          </text>
          <g
            :transform="`translate(${grp.width - 16}, 13)`"
            class="mx-group-del"
            @pointerdown.stop="store.deleteGroup(grp.id)"
          >
            <circle r="8" fill="transparent" />
            <text text-anchor="middle" y="3.5" font-size="11" font-weight="700">×</text>
          </g>
          <!-- 右下角缩放手柄 -->
          <path
            :d="`M ${grp.width - 12},${grp.height - 3} L ${grp.width - 3},${grp.height - 12} M ${grp.width - 7},${grp.height - 3} L ${grp.width - 3},${grp.height - 7}`"
            class="mx-group-resize"
            :stroke="grp.color || '#3b82f6'"
            stroke-width="1.8"
            stroke-linecap="round"
            @pointerdown.stop="startGroupResize(grp, $event)"
          />
        </g>

        <!-- ══════════ 智能对齐辅助线 (Smart Alignment Guides) ══════════ -->
        <line
          v-for="(g, gi) in alignGuides"
          :key="`guide-${gi}`"
          :x1="g.x1"
          :y1="g.y1"
          :x2="g.x2"
          :y2="g.y2"
          class="mx-align-guide"
        />

        <!-- ══════════ 连线层 (Edges · 支持千级连线视口剔除) ══════════ -->
        <g
          v-for="geo in renderedEdgeGeometries"
          :key="geo.edge.id"
          class="mx-edge"
          :class="{
            'is-selected': isEdgeSelected(geo.edge.id),
            'is-drop-target': connectDrag?.hoverEdgeId === geo.edge.id
          }"
          @pointerdown.stop="onEdgePointerDown(geo.edge.id, $event)"
          @dblclick.stop="startEdgeEdit(geo.edge.id)"
          @contextmenu.prevent.stop="onEdgeContextMenu(geo.edge, $event)"
        >
          <path :d="geo.path" class="mx-edge-hit" />
          <!-- Sankey 流量热力发光底层 -->
          <path
            v-if="
              store.flowHeatmap.value &&
              geo.edge.kind === 'resource' &&
              (store.edgeCumulativeFlows.value[geo.edge.id]?.total ?? 0) > 0
            "
            :d="geo.path"
            fill="none"
            :stroke="geo.color"
            :stroke-width="3 + (store.edgeCumulativeFlows.value[geo.edge.id]?.share ?? 0) * 10"
            stroke-opacity="0.26"
            stroke-linecap="round"
          />
          <path
            :d="geo.path"
            fill="none"
            :stroke="geo.color"
            :stroke-width="
              isEdgeSelected(geo.edge.id)
                ? 2.8
                : store.flowHeatmap.value &&
                    geo.edge.kind === 'resource' &&
                    (store.edgeCumulativeFlows.value[geo.edge.id]?.total ?? 0) > 0
                  ? 1.8 + (store.edgeCumulativeFlows.value[geo.edge.id]?.share ?? 0) * 3.5
                  : (store.displayFlows.value[geo.edge.id] ?? 0) > 0
                    ? 2.3
                    : 1.75
            "
            :stroke-dasharray="geo.edge.kind === 'state' ? '6 4' : undefined"
            :marker-end="`url(#${geo.marker})`"
          />

          <!-- 激活资源连线的持续流动脉冲虚线流（仅在播放或单步触发动画期间显示） -->
          <path
            v-if="
              isFlowAnimating &&
              geo.edge.kind === 'resource' &&
              (store.displayFlows.value[geo.edge.id] ?? 0) > 0
            "
            :d="geo.path"
            fill="none"
            :stroke="geo.tokenColor"
            stroke-width="2.6"
            stroke-dasharray="7 9"
            stroke-linecap="round"
            :stroke-dashoffset="-streamPhase * 32"
            stroke-opacity="0.72"
          />

          <!-- 60fps 贝塞尔曲线真实飞行资源球 (Animated Flow Tokens · 运行结束后立即停止) -->
          <template
            v-if="
              isFlowAnimating &&
              geo.edge.kind === 'resource' &&
              (store.displayFlows.value[geo.edge.id] ?? 0) > 0
            "
          >
            <g
              v-for="(tok, tIdx) in edgeFlowTokens(geo)"
              :key="`tok-${geo.edge.id}-${tIdx}`"
              :transform="`translate(${tok.x}, ${tok.y})`"
              class="mx-flow-token"
            >
              <circle r="8.5" :fill="geo.tokenColor" fill-opacity="0.26" />
              <circle r="5.2" :fill="geo.tokenColor" stroke="#ffffff" stroke-width="1.5" />
              <circle cx="-1.5" cy="-1.5" r="1.5" fill="rgba(255,255,255,0.8)" />
              <text
                v-if="tIdx === 0"
                y="-8.5"
                text-anchor="middle"
                font-size="8.5"
                font-weight="800"
                :fill="geo.tokenColor"
                class="mx-token-amt"
              >
                +{{ formatValue(store.displayFlows.value[geo.edge.id] ?? 0) }}
              </text>
            </g>
          </template>

          <!-- 状态控制边触发时的信号脉冲光点 -->
          <g
            v-else-if="isFlowAnimating && geo.edge.kind === 'state' && firedIds.has(geo.edge.from)"
            :transform="`translate(${sampleEdgePoint(geo, streamPhase).x}, ${sampleEdgePoint(geo, streamPhase).y})`"
          >
            <polygon
              points="0,-4.5 4.5,0 0,4.5 -4.5,0"
              :fill="geo.color"
              stroke="#ffffff"
              stroke-width="1"
            />
          </g>

          <!-- 连线中点公式胶囊 (Formula Pill) -->
          <g class="mx-edge-pill" :transform="`translate(${geo.mid.x}, ${geo.mid.y})`">
            <rect
              :x="-geo.labelW / 2"
              y="-9.5"
              :width="geo.labelW"
              height="19"
              rx="9.5"
              class="mx-edge-pill-bg"
              :class="{
                'is-selected': isEdgeSelected(geo.edge.id),
                'is-state': geo.edge.kind === 'state',
                'is-drop': connectDrag?.hoverEdgeId === geo.edge.id
              }"
            />
            <text
              class="mx-edge-label"
              :class="{ 'is-state': geo.edge.kind === 'state' }"
              text-anchor="middle"
              y="3.8"
            >
              {{ geo.label }}
            </text>
            <!-- Sankey 累计总流量徽标 -->
            <text
              v-if="
                store.flowHeatmap.value &&
                geo.edge.kind === 'resource' &&
                (store.edgeCumulativeFlows.value[geo.edge.id]?.total ?? 0) > 0
              "
              text-anchor="middle"
              y="19"
              font-size="9"
              font-weight="700"
              :fill="geo.color"
            >
              ∑ {{ store.edgeCumulativeFlows.value[geo.edge.id]?.total }}
            </text>
          </g>

          <!-- 选中连线时的可拖拽弧度控制点 (Curvature Handle) -->
          <g
            v-if="isEdgeSelected(geo.edge.id) && !geo.edge.targetEdgeId"
            class="mx-bend-handle"
            :transform="`translate(${geo.mid.x}, ${geo.mid.y - 16})`"
            @pointerdown.stop="startBendDrag(geo.edge, $event)"
            @dblclick.stop="store.updateEdge(geo.edge.id, { bend: 0 })"
          >
            <circle r="5.5" />
            <title>{{ t('mx.canvas.bendHandleTip') }}</title>
          </g>
        </g>

        <!-- ══════════ 节点层 (Nodes · 支持千级节点视口剔除与 LOD 降级) ══════════ -->
        <g
          v-for="node in renderedNodes"
          :key="node.id"
          class="mx-node"
          :class="{
            selected: isNodeSelected(node.id),
            hovered: hoveredNodeId === node.id,
            'drop-target': connectDrag?.hoverNodeId === node.id,
            fired: isFlowAnimating && firedIds.has(node.id),
            locked: isLocked(node)
          }"
          :transform="`translate(${node.x}, ${node.y})`"
          @pointerenter="hoveredNodeId = node.id"
          @pointerleave="hoveredNodeId = hoveredNodeId === node.id ? '' : hoveredNodeId"
          @pointerdown.stop="onNodePointerDown(node, $event)"
          @dblclick.stop="onNodeDblClick(node)"
          @contextmenu.prevent.stop="onNodeContextMenu(node, $event)"
        >
          <!-- Note 便签节点 -->
          <template v-if="node.kind === 'note'">
            <rect
              :x="-(node.width ?? 160) / 2"
              :y="-(node.height ?? 80) / 2"
              :width="node.width ?? 160"
              :height="node.height ?? 80"
              rx="6"
              class="mx-note-rect"
              :class="{ selected: isNodeSelected(node.id) }"
            />
            <foreignObject
              :x="-(node.width ?? 160) / 2 + 8"
              :y="-(node.height ?? 80) / 2 + 6"
              :width="(node.width ?? 160) - 16"
              :height="(node.height ?? 80) - 12"
            >
              <div class="mx-note-text">{{ node.text || node.label }}</div>
            </foreignObject>
          </template>

          <!-- 标准 Machinations 图元节点 -->
          <template v-else>
            <!-- 透明连续指针热区（覆盖节点本体与四周 + / S 锚点，消除悬停间隙闪烁） -->
            <circle r="32" fill="transparent" class="mx-node-hit-area" />

            <!-- 选中/悬停/吸附光环 -->
            <circle
              v-if="isNodeSelected(node.id) || connectDrag?.hoverNodeId === node.id"
              r="29"
              class="mx-sel-halo"
              :class="{ 'is-snap': connectDrag?.hoverNodeId === node.id }"
            />

            <!-- Pool 容量进度外环 (Capacity Arc) -->
            <circle
              v-if="node.kind === 'pool' && node.capacity && node.capacity > 0"
              r="22.5"
              fill="none"
              stroke="rgba(148, 163, 184, 0.22)"
              stroke-width="2.5"
            />
            <circle
              v-if="node.kind === 'pool' && node.capacity && node.capacity > 0"
              r="22.5"
              fill="none"
              :stroke="nodeColor(node)"
              stroke-width="2.5"
              stroke-linecap="round"
              :stroke-dasharray="`${Math.min(1, Math.max(0, nodeValue(node) / node.capacity)) * 141.37} 141.37`"
              transform="rotate(-90)"
            />

            <!-- Interactive 双层外圈 -->
            <path
              v-if="node.trigger === 'interactive'"
              :d="shapePath(node.kind, 23)"
              fill="none"
              :stroke="nodeColor(node)"
              stroke-width="1.35"
            />

            <!-- 节点触发 / 资源入账时的向外扩散冲击波光环 (Node Fire / Receive Shockwave) -->
            <path
              v-if="isFlowAnimating && firedIds.has(node.id)"
              :d="shapePath(node.kind, Math.max(4, 18 + pulseWave * 14))"
              fill="none"
              :stroke="nodeColor(node)"
              :stroke-width="Math.max(0.5, 2.2 * (1 - pulseWave * 0.6))"
              :stroke-opacity="Math.max(0, (1 - pulseWave) * 0.78)"
              class="mx-node-shockwave"
            />

            <!-- 主体几何图形 -->
            <path
              :d="shapePath(node.kind, 18)"
              :fill="isFilled(node) ? nodeColor(node) : 'var(--mx-node-fill)'"
              :stroke="nodeColor(node)"
              stroke-width="2.3"
            />

            <!-- Pool 内部动态液面填充与浮动资源粒子 -->
            <g v-if="node.kind === 'pool' && nodeValue(node) > 0">
              <path :d="poolLiquidPath(node)" :fill="nodeColor(node)" fill-opacity="0.18" />
              <!-- 默认模式也在池底显示微缩动态资源球（千级大图或低倍率缩放时自动进入 LOD 轻量模式） -->
              <template
                v-if="!isLowDetailZoom || node.showAs === 'tokens' || node.showAs === 'both'"
              >
                <circle
                  v-for="(pt, ti) in tokenDots(Math.min(12, Math.floor(nodeValue(node))))"
                  :key="`ptok-${ti}`"
                  :cx="pt.x"
                  :cy="
                    (node.showAs === 'tokens' ? pt.y : pt.y * 0.55 + 8.5) +
                    (isFlowAnimating ? Math.sin(streamPhase * Math.PI * 2 + ti * 1.1) * 1.1 : 0)
                  "
                  :r="node.showAs === 'tokens' || node.showAs === 'both' ? 2.3 : 1.75"
                  :fill="nodeColor(node)"
                  :fill-opacity="node.showAs === 'tokens' || node.showAs === 'both' ? 0.95 : 0.55"
                />
              </template>
            </g>

            <!-- Source 产出资源时的核心放射脉冲 -->
            <circle
              v-if="isFlowAnimating && node.kind === 'source' && firedIds.has(node.id)"
              cx="0"
              cy="2"
              :r="Math.max(1, 3 + pulseWave * 7)"
              :fill="nodeColor(node)"
              :fill-opacity="Math.max(0, 0.75 * (1 - pulseWave))"
            />

            <!-- Drain 消耗资源时的向内坍缩漩涡环 -->
            <circle
              v-if="isFlowAnimating && node.kind === 'drain' && firedIds.has(node.id)"
              cx="0"
              cy="-2"
              :r="Math.max(2, 12 * (1 - pulseWave))"
              fill="none"
              :stroke="nodeColor(node)"
              stroke-width="1.8"
              :stroke-opacity="Math.max(0, 0.85 * pulseWave)"
            />

            <!-- Converter / Trader 合成转化时的内部穿梭光球 -->
            <circle
              v-if="
                isFlowAnimating &&
                (node.kind === 'converter' || node.kind === 'trader') &&
                firedIds.has(node.id)
              "
              :cx="-12 + pulseWave * 26"
              cy="0"
              r="3.8"
              :fill="converterOutputColor(node)"
              stroke="#ffffff"
              stroke-width="1.2"
            />

            <!-- Converter 右侧输出资源色条 -->
            <line
              v-if="node.kind === 'converter'"
              x1="18"
              y1="-16"
              x2="18"
              y2="16"
              :stroke="converterOutputColor(node)"
              stroke-width="3.4"
              stroke-linecap="round"
            />

            <!-- Pool / Register / Delay / Queue 中心数值 -->
            <text
              v-if="
                (node.kind === 'pool' && node.showAs !== 'tokens') ||
                node.kind === 'register' ||
                node.kind === 'delay' ||
                node.kind === 'queue'
              "
              class="mx-node-value"
              text-anchor="middle"
              :y="node.kind === 'pool' && node.showAs === 'both' ? -1 : 4"
              :fill="isFilled(node) ? '#ffffff' : nodeColor(node)"
            >
              {{ formatValue(nodeValue(node)) }}
            </text>

            <!-- Gate 中心符号 (% / 🎲) -->
            <text
              v-else-if="node.kind === 'gate'"
              class="mx-node-glyph"
              text-anchor="middle"
              y="3.5"
              :fill="nodeColor(node)"
            >
              {{ node.gateMode === 'deterministic' ? '⚖' : '%' }}
            </text>

            <!-- End 终止条件中心符号 -->
            <text
              v-else-if="node.kind === 'end'"
              class="mx-node-glyph"
              text-anchor="middle"
              y="3.5"
              fill="#ffffff"
            >
              ■
            </text>

            <!-- Pull Mode 角标 (p& / ps / ps&) -->
            <text
              v-if="node.pullMode && node.pullMode !== 'pull_any'"
              class="mx-node-pull-badge"
              x="-16"
              y="-13"
              :fill="nodeColor(node)"
            >
              {{ pullModeBadge(node.pullMode) }}
            </text>

            <!-- Trigger 角标 (* / e) 或 Artificial Agent 接管角标 -->
            <text
              v-if="node.trigger === 'automatic'"
              class="mx-node-star"
              x="15"
              y="-13"
              :fill="nodeColor(node)"
            >
              *
            </text>
            <text
              v-else-if="node.trigger === 'enabling'"
              class="mx-node-star"
              x="14"
              y="-13"
              :fill="nodeColor(node)"
            >
              e
            </text>
            <g
              v-else-if="node.trigger === 'interactive' && controllingAgentByNodeId.get(node.id)"
              transform="translate(17, -17)"
              class="mx-node-agent-badge"
            >
              <circle
                r="7.5"
                :fill="controllingAgentByNodeId.get(node.id)?.color || '#4f46e5'"
                stroke="var(--mx-node-fill)"
                stroke-width="1.4"
              />
              <text text-anchor="middle" y="3" fill="#ffffff" font-size="8.5" font-weight="800">
                🤖
              </text>
              <title>
                {{
                  t('mx.agents.controlledByTip', {
                    name: controllingAgentByNodeId.get(node.id)?.name ?? ''
                  })
                }}
              </title>
            </g>

            <!-- 单步数值变化浮动徽标 (+3 / -2) -->
            <g
              v-if="nodeStepDelta(node.id) !== 0"
              :transform="`translate(22, ${-18 - burstProgress * 7})`"
              class="mx-delta-badge"
            >
              <rect
                x="-14"
                y="-8"
                width="28"
                height="14"
                rx="7"
                :fill="nodeStepDelta(node.id) > 0 ? '#16a34a' : '#dc2626'"
              />
              <text text-anchor="middle" y="2.5" fill="#ffffff" font-size="8.5" font-weight="700">
                {{
                  nodeStepDelta(node.id) > 0
                    ? `+${formatValue(nodeStepDelta(node.id))}`
                    : formatValue(nodeStepDelta(node.id))
                }}
              </text>
            </g>

            <!-- 瓶颈告警徽标（Converter 饥饿阻塞 / Pool 爆仓 MAX / Pool 枯竭 0!） -->
            <g
              v-if="store.nodeBottlenecks.value[node.id]"
              transform="translate(-22, -20)"
              class="mx-bottleneck-badge"
            >
              <rect
                x="-17"
                y="-8"
                width="34"
                height="14"
                rx="7"
                :fill="
                  store.nodeBottlenecks.value[node.id]?.kind === 'blocked'
                    ? '#d97706'
                    : store.nodeBottlenecks.value[node.id]?.kind === 'capped'
                      ? '#db2777'
                      : '#dc2626'
                "
              />
              <text text-anchor="middle" y="2.5" fill="#ffffff" font-size="8" font-weight="800">
                {{ store.nodeBottlenecks.value[node.id]?.badge }}
              </text>
            </g>

            <!-- Interactive Register 画布步进微调按钮 (- / +) -->
            <g
              v-if="
                node.kind === 'register' &&
                (node.trigger === 'interactive' || !node.formula?.trim()) &&
                !isLocked(node)
              "
              class="mx-reg-stepper"
            >
              <g
                transform="translate(-26, 0)"
                class="mx-reg-step-btn"
                @pointerdown.stop="store.adjustRegisterValue(node.id, -1)"
              >
                <circle r="7.5" />
                <text text-anchor="middle" y="3" font-size="11" font-weight="800">−</text>
              </g>
              <g
                transform="translate(26, 0)"
                class="mx-reg-step-btn"
                @pointerdown.stop="store.adjustRegisterValue(node.id, 1)"
              >
                <circle r="7.5" />
                <text text-anchor="middle" y="3" font-size="11" font-weight="800">+</text>
              </g>
            </g>

            <!-- 节点主标题与副标签（双击主标题直接行内重命名） -->
            <text
              class="mx-node-label"
              text-anchor="middle"
              y="34"
              :class="{ sel: isNodeSelected(node.id) }"
              @dblclick.stop="startNodeLabelEdit(node)"
            >
              {{ node.label }}
            </text>
            <g v-if="nodeSubLabel(node)" :transform="'translate(0, 47)'">
              <rect
                :x="-subW(node) / 2"
                y="-7.5"
                :width="subW(node)"
                height="15"
                rx="7.5"
                class="mx-node-sub-pill"
              />
              <text class="mx-node-sub" text-anchor="middle" y="3">
                {{ nodeSubLabel(node) }}
              </text>
            </g>

            <!-- ══════════ 四向快捷连线端口 (Hover Connection Ports) ══════════ -->
            <g
              v-if="
                (hoveredNodeId === node.id ||
                  (isNodeSelected(node.id) && store.selection.nodes.length <= 12) ||
                  connectDrag?.from === node.id) &&
                (!connectDrag || connectDrag.from === node.id) &&
                !isLocked(node)
              "
              class="mx-node-ports"
            >
              <!-- 右/左/上/下 实线资源连线锚点 (点击或拖拽即连 Resource Edge) -->
              <g
                v-for="pt in portOffsets"
                :key="pt.dir"
                :transform="`translate(${pt.x}, ${pt.y})`"
                class="mx-port-dot is-resource"
                @pointerdown.stop="startPortConnect(node, 'resource', $event, pt.x, pt.y)"
              >
                <circle r="10" fill="transparent" class="mx-port-hit" />
                <circle r="5.5" class="mx-port-vis" />
                <path
                  d="M-2.2,0 H2.2 M0,-2.2 V2.2"
                  stroke="#ffffff"
                  stroke-width="1.35"
                  pointer-events="none"
                />
                <title>{{ t('mx.canvas.dragResourcePortTip') }}</title>
              </g>
              <!-- 右下角蓝色状态连线锚点 (点击或拖拽即连 State Edge) -->
              <g
                transform="translate(19, 19)"
                class="mx-port-dot is-state"
                @pointerdown.stop="startPortConnect(node, 'state', $event, 19, 19)"
              >
                <circle r="10" fill="transparent" class="mx-port-hit" />
                <circle r="5.5" class="mx-port-vis" />
                <text
                  text-anchor="middle"
                  y="2.8"
                  fill="#ffffff"
                  font-size="7.5"
                  font-weight="800"
                  pointer-events="none"
                >
                  S
                </text>
                <title>{{ t('mx.canvas.dragStatePortTip') }}</title>
              </g>
            </g>
          </template>
        </g>

        <!-- ══════════ 实时拖线预览曲线 (置于节点层上方，确保起点紧贴 + 号锚点且不被遮挡) ══════════ -->
        <g v-if="connectDrag" class="mx-connect-preview" pointer-events="none">
          <circle
            :cx="connectDrag.fromX"
            :cy="connectDrag.fromY"
            r="4"
            :fill="connectDrag.kind === 'state' ? '#38bdf8' : '#3d8bfd'"
            stroke="#ffffff"
            stroke-width="1.5"
          />
          <path
            :d="connectPreviewPath"
            fill="none"
            :stroke="connectDrag.kind === 'state' ? '#38bdf8' : '#3d8bfd'"
            stroke-width="2.4"
            :stroke-dasharray="connectDrag.kind === 'state' ? '6 4' : undefined"
            :marker-end="
              connectDrag.kind === 'state' ? 'url(#mx-arrow-state)' : 'url(#mx-arrow-sel)'
            "
          />
          <circle
            :cx="connectDrag.toX"
            :cy="connectDrag.toY"
            r="4.5"
            :fill="connectDrag.kind === 'state' ? '#38bdf8' : '#3d8bfd'"
            fill-opacity="0.35"
          />
        </g>
      </g>

      <!-- 框选矩形 (Marquee) -->
      <rect
        v-if="marquee"
        class="mx-marquee"
        :x="Math.min(marquee.x0, marquee.x1)"
        :y="Math.min(marquee.y0, marquee.y1)"
        :width="Math.abs(marquee.x1 - marquee.x0)"
        :height="Math.abs(marquee.y1 - marquee.y0)"
      />
    </svg>

    <!-- ══════════ 左上悬浮选择与 13 图元工具栏 ══════════ -->
    <div class="mx-toolbar">
      <button
        type="button"
        class="mx-tool"
        :class="{ active: store.tool.value === 'select' }"
        :title="t('mx.tool.select')"
        @click="store.tool.value = 'select'"
      >
        <svg viewBox="-12 -12 24 24" width="22" height="22" class="mx-tool-svg">
          <path
            d="M-5,-8 L-5,7 L-1.2,3.4 L2,9 L4.2,7.9 L1,2.2 L6,2.2 Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <div class="mx-tool-divider" />
      <button
        v-for="tb in toolButtons"
        :key="tb.id"
        type="button"
        class="mx-tool"
        :class="{ active: store.tool.value === tb.id }"
        :title="t(`mx.tool.${tb.id}`)"
        @click="store.tool.value = store.tool.value === tb.id ? 'select' : tb.id"
      >
        <svg viewBox="-12 -12 24 24" width="22" height="22" class="mx-tool-svg">
          <path
            v-if="tb.shape"
            :d="shapePath(tb.shape, 9)"
            :fill="tb.filled ? tb.color : 'none'"
            :stroke="tb.color"
            stroke-width="2"
            stroke-linejoin="round"
          />
          <g v-else>
            <line
              x1="-8"
              y1="7"
              x2="6"
              y2="-7"
              :stroke="tb.color"
              stroke-width="2.2"
              stroke-linecap="round"
              :stroke-dasharray="tb.id === 'state_edge' ? '3.5 2.5' : undefined"
            />
            <polygon points="8,-9 2,-8 7,-3" :fill="tb.color" />
          </g>
          <text
            v-if="tb.glyph"
            text-anchor="middle"
            y="3.5"
            font-size="9.5"
            :fill="tb.filled ? '#fff' : tb.color"
            font-weight="800"
          >
            {{ tb.glyph }}
          </text>
        </svg>
      </button>
    </div>

    <!-- ══════════ 右上视图与排版控制栏 ══════════ -->
    <div class="mx-viewbar">
      <button
        type="button"
        :class="{ 'is-on': store.snapToGrid.value }"
        :title="t('mx.canvas.snapGrid')"
        @click="store.snapToGrid.value = !store.snapToGrid.value"
      >
        ⊞
      </button>
      <button
        type="button"
        :class="{ 'is-on': store.flowHeatmap.value }"
        :title="t('mx.canvas.flowHeatmap')"
        @click="store.flowHeatmap.value = !store.flowHeatmap.value"
      >
        🔥
      </button>
      <button
        type="button"
        :title="t('mx.canvas.createGroup')"
        @click="store.createGroupFromSelection()"
      >
        ▣
      </button>
      <button
        type="button"
        :class="{ 'is-on': searchOpen }"
        :title="t('mx.canvas.searchNodes')"
        @click="toggleSearch"
      >
        🔍
      </button>
      <button type="button" :title="t('mx.canvas.autoLayout')" @click="onAutoLayout">✨</button>
      <button type="button" :title="t('mx.canvas.cycleTheme')" @click="cycleCanvasTheme">
        {{
          store.canvasTheme.value === 'light' ? '☀' : store.canvasTheme.value === 'dark' ? '☾' : '◐'
        }}
      </button>
      <span class="sep" />
      <button type="button" :title="t('mx.view.fit')" @click="fitView">⤢</button>
      <button type="button" :title="t('mx.view.center')" @click="resetZoom">◎</button>
      <span class="sep" />
      <button type="button" @click="zoomBy(1 / 1.2)">−</button>
      <span class="zoom">{{ Math.round(store.view.zoom * 100) }}%</span>
      <button type="button" @click="zoomBy(1.2)">+</button>
    </div>

    <!-- ══════════ 多选节点时的顶部悬浮对齐与等距排版工具栏 ══════════ -->
    <div
      v-if="store.selection.nodes.length >= 2 && !edgeEdit && !quickConnectMenu"
      class="mx-multiselect-bar"
      @pointerdown.stop
    >
      <span class="mx-ms-count">{{ store.selection.nodes.length }} selected</span>
      <span class="sep" />
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.alignLeft')"
        @click="store.alignSelection('left')"
      >
        ⫷
      </button>
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.alignCenterX')"
        @click="store.alignSelection('center_x')"
      >
        ⫿
      </button>
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.alignRight')"
        @click="store.alignSelection('right')"
      >
        ⫸
      </button>
      <span class="sep" />
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.alignTop')"
        @click="store.alignSelection('top')"
      >
        ⊤
      </button>
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.alignCenterY')"
        @click="store.alignSelection('center_y')"
      >
        ⊶
      </button>
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.alignBottom')"
        @click="store.alignSelection('bottom')"
      >
        ⊥
      </button>
      <span class="sep" />
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.distributeH')"
        @click="store.alignSelection('distribute_h')"
      >
        ⇔
      </button>
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.distributeV')"
        @click="store.alignSelection('distribute_v')"
      >
        ⇕
      </button>
      <span class="sep" />
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.createGroup')"
        @click="store.createGroupFromSelection()"
      >
        ▣ Group
      </button>
    </div>

    <!-- ══════════ 选中单个节点时的上方悬浮快捷操作栏 ══════════ -->
    <div
      v-if="selectedSingleNode && !edgeEdit && !quickConnectMenu"
      class="mx-node-floatbar"
      :style="selectedNodeFloatStyle"
      @pointerdown.stop
    >
      <button
        v-for="tr in ['passive', 'automatic', 'interactive', 'enabling'] as const"
        :key="tr"
        type="button"
        class="mx-nf-btn"
        :class="{ active: selectedSingleNode.trigger === tr }"
        :title="t(`mx.trigger.${tr}`)"
        @click="store.updateNode(selectedSingleNode.id, { trigger: tr })"
      >
        {{ tr === 'passive' ? '·' : tr === 'automatic' ? '*' : tr === 'interactive' ? '◉' : 'e' }}
      </button>
      <span class="sep" />
      <button
        type="button"
        class="mx-nf-btn is-fire"
        :title="t('mx.canvas.fireNodeNow')"
        @click="store.interact(selectedSingleNode.id)"
      >
        ⚡
      </button>
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.tool.resource_edge')"
        @pointerdown.stop="startPortConnect(selectedSingleNode, 'resource', $event)"
      >
        ──►
      </button>
      <button
        type="button"
        class="mx-nf-btn is-state"
        :title="t('mx.tool.state_edge')"
        @pointerdown.stop="startPortConnect(selectedSingleNode, 'state', $event)"
      >
        ╌╌►
      </button>
      <span class="sep" />
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.duplicate')"
        @click="store.duplicateSelection()"
      >
        ⧉
      </button>
      <button
        type="button"
        class="mx-nf-btn is-danger"
        :title="t('mx.inspector.deleteElement')"
        @click="store.deleteSelection()"
      >
        ×
      </button>
    </div>

    <!-- ══════════ 选中单条连线时的悬浮快捷操作栏 ══════════ -->
    <div
      v-if="selectedSingleEdgeGeo && !edgeEdit"
      class="mx-node-floatbar"
      :style="selectedEdgeFloatStyle"
      @pointerdown.stop
    >
      <button
        type="button"
        class="mx-nf-btn"
        :title="t('mx.inspector.edgeKind')"
        @click="store.toggleEdgeKind(selectedSingleEdgeGeo.edge.id)"
      >
        {{ selectedSingleEdgeGeo.edge.kind === 'state' ? '╌╌► State' : '──► Res' }}
      </button>
      <button
        v-if="!selectedSingleEdgeGeo.edge.targetEdgeId"
        type="button"
        class="mx-nf-btn"
        :title="t('mx.canvas.reverseEdge')"
        @click="store.reverseEdge(selectedSingleEdgeGeo.edge.id)"
      >
        ⇄
      </button>
      <span class="sep" />
      <button
        v-for="qf in selectedSingleEdgeGeo.edge.kind === 'state'
          ? ['+1', '-1', '*', '!', '>0', '<=0']
          : ['1', '2', 'D6', '50%', 'all']"
        :key="qf"
        type="button"
        class="mx-nf-chip"
        :class="{ active: selectedSingleEdgeGeo.edge.formula === qf }"
        @click="store.updateEdge(selectedSingleEdgeGeo.edge.id, { formula: qf })"
      >
        {{ qf }}
      </button>
      <span class="sep" />
      <button type="button" class="mx-nf-btn is-danger" @click="store.deleteSelection()">×</button>
    </div>

    <!-- ══════════ 拖线到空白处自动弹出的「快速新建并连线」面板 ══════════ -->
    <div
      v-if="quickConnectMenu"
      class="mx-quick-menu"
      :style="{ left: `${quickConnectMenu.sx}px`, top: `${quickConnectMenu.sy}px` }"
      @pointerdown.stop
      @click.stop
    >
      <div class="mx-qm-title">{{ t('mx.canvas.quickConnectTitle') }}</div>
      <div class="mx-qm-grid">
        <button
          v-for="qk in quickSpawnKinds"
          :key="qk.kind"
          type="button"
          class="mx-qm-item"
          @click="confirmQuickConnectSpawn(qk.kind)"
        >
          <span class="mx-qm-ico">{{ qk.icon }}</span>
          <span>{{ t(`mx.kind.${qk.kind}`) }}</span>
        </button>
      </div>
    </div>

    <!-- ══════════ 画布右键菜单 (Context Menu) ══════════ -->
    <div
      v-if="contextMenu"
      class="mx-ctx-menu"
      :style="{ left: `${contextMenu.sx}px`, top: `${contextMenu.sy}px` }"
      @pointerdown.stop
      @click.stop
    >
      <template v-if="contextMenu.targetType === 'canvas'">
        <div class="mx-qm-title">{{ t('mx.canvas.addNodeHere') }}</div>
        <div class="mx-qm-grid">
          <button
            v-for="qk in quickSpawnKinds"
            :key="qk.kind"
            type="button"
            class="mx-qm-item"
            @click="spawnNodeAtContext(qk.kind)"
          >
            <span class="mx-qm-ico">{{ qk.icon }}</span>
            <span>{{ t(`mx.kind.${qk.kind}`) }}</span>
          </button>
        </div>
        <hr />
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            onAutoLayout()
            closeMenus()
          "
        >
          ✨ {{ t('mx.canvas.autoLayout') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            store.pasteNodes()
            closeMenus()
          "
        >
          📋 {{ t('mx.canvas.paste') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            fitView()
            closeMenus()
          "
        >
          ⤢ {{ t('mx.view.fit') }}
        </button>
      </template>

      <template v-else-if="contextMenu.targetType === 'node'">
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            if (contextMenu.nodeId) store.interact(contextMenu.nodeId)
            closeMenus()
          "
        >
          ⚡ {{ t('mx.canvas.fireNodeNow') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            store.duplicateSelection()
            closeMenus()
          "
        >
          ⧉ {{ t('mx.canvas.duplicate') }}
        </button>
        <hr />
        <button
          type="button"
          class="mx-ctx-row is-danger"
          @click="
            store.deleteSelection()
            closeMenus()
          "
        >
          🗑 {{ t('mx.inspector.deleteElement') }}
        </button>
      </template>

      <template v-else-if="contextMenu.targetType === 'edge'">
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            if (contextMenu.edgeId) store.toggleEdgeKind(contextMenu.edgeId)
            closeMenus()
          "
        >
          ──/╌╌ {{ t('mx.inspector.edgeKind') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            if (contextMenu.edgeId) store.reverseEdge(contextMenu.edgeId)
            closeMenus()
          "
        >
          ⇄ {{ t('mx.canvas.reverseEdge') }}
        </button>
        <hr />
        <button
          type="button"
          class="mx-ctx-row is-danger"
          @click="
            store.deleteSelection()
            closeMenus()
          "
        >
          🗑 {{ t('mx.inspector.deleteElement') }}
        </button>
      </template>
    </div>

    <!-- 连线公式行内输入框 -->
    <input
      v-if="edgeEdit"
      ref="edgeInputRef"
      v-model="edgeEdit.value"
      class="mx-edge-input"
      :style="{ left: `${edgeEdit.sx}px`, top: `${edgeEdit.sy}px` }"
      @keydown.enter.prevent="commitEdgeEdit"
      @keydown.esc.prevent="edgeEdit = null"
      @blur="commitEdgeEdit"
    />

    <!-- 节点名称 / Note 行内输入框 -->
    <input
      v-if="nodeEdit"
      ref="nodeInputRef"
      v-model="nodeEdit.value"
      class="mx-edge-input"
      :style="{ left: `${nodeEdit.sx}px`, top: `${nodeEdit.sy}px` }"
      @keydown.enter.prevent="commitNodeEdit"
      @keydown.esc.prevent="nodeEdit = null"
      @blur="commitNodeEdit"
    />

    <!-- ══════════ 右上悬浮搜索定位面板 (Search & Locate Bar · Ctrl+F) ══════════ -->
    <div v-if="searchOpen" class="mx-search-pop" @pointerdown.stop @click.stop>
      <div class="mx-search-row">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          class="mx-search-input"
          :placeholder="t('mx.canvas.searchPlaceholder')"
          @keydown.esc.prevent="searchOpen = false"
        />
        <button type="button" class="mx-search-close" @click="searchOpen = false">×</button>
      </div>
      <div v-if="searchResults.length" class="mx-search-list">
        <button
          v-for="item in searchResults"
          :key="item.id"
          type="button"
          class="mx-search-item"
          @click="focusSearchResult(item)"
        >
          <span class="mx-search-tag">{{ item.badge }}</span>
          <span class="mx-search-lbl">{{ item.title }}</span>
          <span class="mx-search-sub">{{ item.sub }}</span>
        </button>
      </div>
    </div>

    <!-- ══════════ 右下可折叠鸟瞰小地图 (Interactive Minimap) ══════════ -->
    <div class="mx-minimap-dock" :class="{ 'is-collapsed': !minimapOpen }" @pointerdown.stop>
      <button
        type="button"
        class="mx-minimap-toggle"
        :title="t('mx.canvas.minimapToggle')"
        @click="minimapOpen = !minimapOpen"
      >
        🗺 {{ minimapOpen ? '▾' : '▴' }}
      </button>
      <svg
        v-if="minimapOpen"
        class="mx-minimap-svg"
        :viewBox="minimapBounds.viewBox"
        @pointerdown.stop="onMinimapPointerDown"
      >
        <rect
          v-for="g in store.doc.value.groups ?? []"
          :key="'mg-' + g.id"
          :x="g.x"
          :y="g.y"
          :width="g.width"
          :height="g.height"
          rx="8"
          :fill="g.color || '#3b82f6'"
          fill-opacity="0.14"
          :stroke="g.color || '#3b82f6'"
          stroke-width="6"
        />
        <line
          v-for="e in store.doc.value.edges"
          :key="'me-' + e.id"
          :x1="nodeById.get(e.from)?.x ?? 0"
          :y1="nodeById.get(e.from)?.y ?? 0"
          :x2="nodeById.get(e.to)?.x ?? 0"
          :y2="nodeById.get(e.to)?.y ?? 0"
          stroke="#94a3b8"
          stroke-width="5"
          stroke-opacity="0.6"
        />
        <circle
          v-for="n in visibleNodes"
          :key="'mn-' + n.id"
          :cx="n.x"
          :cy="n.y"
          r="16"
          :fill="nodeColor(n)"
        />
        <rect
          :x="minimapBounds.vx"
          :y="minimapBounds.vy"
          :width="minimapBounds.vw"
          :height="minimapBounds.vh"
          fill="rgba(61, 139, 253, 0.12)"
          stroke="#3d8bfd"
          stroke-width="8"
        />
      </svg>
    </div>

    <div v-if="hintText" class="mx-hint">{{ hintText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  mxNodeColor,
  type MxEdge,
  type MxEdgeKind,
  type MxGroup,
  type MxNode,
  type MxNodeKind,
  type MxPullMode
} from '@shared/gameAssets'
import { useStudioI18n } from '../../../composables/useStudioI18n'
import { useMxStudioStore, type MxCanvasTheme, type MxTool } from './mxStudioStore'

const { t } = useStudioI18n()
const store = useMxStudioStore()

const rootRef = ref<HTMLDivElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const edgeInputRef = ref<HTMLInputElement | null>(null)
const nodeInputRef = ref<HTMLInputElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const hoveredNodeId = ref('')
const searchOpen = ref(false)
const searchQuery = ref('')
const minimapOpen = ref(true)

const portOffsets = [
  { dir: 'right', x: 24, y: 0 },
  { dir: 'left', x: -24, y: 0 },
  { dir: 'top', x: 0, y: -24 },
  { dir: 'bottom', x: 0, y: 24 }
]

const quickSpawnKinds: Array<{ kind: MxNodeKind; icon: string }> = [
  { kind: 'pool', icon: '○' },
  { kind: 'converter', icon: '▷|' },
  { kind: 'gate', icon: '◇' },
  { kind: 'drain', icon: '▽' },
  { kind: 'register', icon: '[x]' },
  { kind: 'source', icon: '△' },
  { kind: 'trader', icon: '⧉' },
  { kind: 'delay', icon: '⏱' },
  { kind: 'end', icon: '■' }
]

const toolButtons: Array<{
  id: MxTool
  shape?: MxNodeKind
  color: string
  filled?: boolean
  glyph?: string
}> = [
  { id: 'source', shape: 'source', color: '#f59e0b' },
  { id: 'drain', shape: 'drain', color: '#ef4444' },
  { id: 'pool', shape: 'pool', color: '#3b82f6' },
  { id: 'gate', shape: 'gate', color: '#ec4899' },
  { id: 'trader', shape: 'trader', color: '#14b8a6' },
  { id: 'converter', shape: 'converter', color: '#8b5cf6' },
  { id: 'register', shape: 'register', color: '#a855f7', filled: true, glyph: 'x' },
  { id: 'delay', shape: 'delay', color: '#64748b', glyph: '⏱' },
  { id: 'queue', shape: 'queue', color: '#64748b', glyph: 'Q' },
  { id: 'end', shape: 'end', color: '#6b7280', filled: true },
  { id: 'resource_edge', color: '#3b82f6' },
  { id: 'state_edge', color: '#38bdf8' },
  { id: 'note', shape: 'note', color: '#eab308', filled: false }
]

const isNodeTool = computed(() => {
  const tl = store.tool.value
  return tl !== 'select' && tl !== 'resource_edge' && tl !== 'state_edge'
})

const hintText = computed(() => {
  const tl = store.tool.value
  if (connectDrag.value) return t('mx.canvas.hintConnecting')
  if (tl === 'resource_edge' || tl === 'state_edge') return t('mx.canvas.hintConnect')
  if (isNodeTool.value) return t('mx.canvas.hintPlace')
  return ''
})

const layerMap = computed(() => new Map(store.doc.value.layers.map((l) => [l.id, l])))
const visibleNodes = computed(() =>
  store.doc.value.nodes.filter((n) => {
    const layer = n.layerId ? layerMap.value.get(n.layerId) : undefined
    return !layer || layer.visible
  })
)
const visibleIds = computed(() => new Set(visibleNodes.value.map((n) => n.id)))
const nodeById = computed(() => new Map(store.doc.value.nodes.map((n) => [n.id, n])))
const selectedNodeSet = computed(() => new Set(store.selection.nodes))
const selectedEdgeSet = computed(() => new Set(store.selection.edges))

// ───────── 千级节点与连线视口剔除 (Viewport Frustum Culling) 与 LOD 降级 ─────────
const isLargeGraph = computed(
  () => visibleNodes.value.length > 200 || store.doc.value.edges.length > 350
)
const isLowDetailZoom = computed(() => store.view.zoom < 0.48 || visibleNodes.value.length > 350)
const viewportWorldRect = computed(() => {
  const cw = svgRef.value?.clientWidth || 1440
  const ch = svgRef.value?.clientHeight || 900
  const z = Math.max(0.1, store.view.zoom)
  const pad = 260 / z
  return {
    minX: -store.view.x / z - pad,
    minY: -store.view.y / z - pad,
    maxX: (cw - store.view.x) / z + pad,
    maxY: (ch - store.view.y) / z + pad
  }
})
const renderedNodes = computed(() => {
  const all = visibleNodes.value
  if (!isLargeGraph.value) return all
  const r = viewportWorldRect.value
  const sel = selectedNodeSet.value
  return all.filter(
    (n) =>
      (n.x >= r.minX && n.x <= r.maxX && n.y >= r.minY && n.y <= r.maxY) ||
      sel.has(n.id) ||
      hoveredNodeId.value === n.id
  )
})
const renderedNodeIds = computed(() => new Set(renderedNodes.value.map((n) => n.id)))

function isLocked(node: MxNode): boolean {
  const layer = node.layerId ? layerMap.value.get(node.layerId) : undefined
  return !!layer?.locked
}

const firedIds = computed(() => {
  const set = new Set<string>()
  const flows = store.displayFlows.value
  for (const e of store.doc.value.edges) {
    if ((flows[e.id] ?? 0) > 0) {
      set.add(e.from)
      set.add(e.to)
    }
  }
  return set
})

function nodeColor(node: MxNode): string {
  return mxNodeColor(store.doc.value, node)
}

const converterColorById = computed(() => {
  const map = new Map<string, string>()
  for (const e of store.doc.value.edges) {
    if (e.kind === 'resource' && !map.has(e.from)) {
      const tgt = nodeById.value.get(e.to)
      if (tgt) map.set(e.from, nodeColor(tgt))
    }
  }
  return map
})

const controllingAgentByNodeId = computed(() => {
  const map = new Map<string, { id: string; name: string; color?: string }>()
  const activeAgents = (store.doc.value.agents ?? []).filter((a) => a.enabled)
  if (!activeAgents.length) return map
  const interactiveIds = store.doc.value.nodes
    .filter((n) => n.trigger === 'interactive')
    .map((n) => n.id)
  for (const ag of activeAgents) {
    const targets = ag.controlledNodeIds.length ? ag.controlledNodeIds : interactiveIds
    for (const nid of targets) {
      if (!map.has(nid)) map.set(nid, { id: ag.id, name: ag.name, color: ag.color })
    }
  }
  return map
})

function converterOutputColor(node: MxNode): string {
  return converterColorById.value.get(node.id) ?? nodeColor(node)
}

function isFilled(node: MxNode): boolean {
  return node.kind === 'register' || node.kind === 'end'
}

function nodeValue(node: MxNode): number {
  const vals = store.displayValues.value
  if (vals && node.id in vals) return vals[node.id] ?? 0
  if (node.kind === 'pool') return node.initial ?? 0
  return 0
}

function nodeStepDelta(nodeId: string): number {
  const cur = store.displayValues.value?.[nodeId]
  const prev = store.previousStepValues.value?.[nodeId]
  if (cur === undefined || prev === undefined) return 0
  return Math.round((cur - prev) * 100) / 100
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 1000).toFixed(1)}k`
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function pullModeBadge(pm: MxPullMode): string {
  switch (pm) {
    case 'pull_all':
      return 'p&'
    case 'push_any':
      return 'ps'
    case 'push_all':
      return 'ps&'
    default:
      return ''
  }
}

function tokenDots(count: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  const cols = Math.min(4, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / cols)
  const sp = 5.2
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols)
    const c = i % cols
    pts.push({
      x: (c - (cols - 1) / 2) * sp,
      y: (r - (rows - 1) / 2) * sp
    })
  }
  return pts
}

/** 计算 Pool 节点内部底部动态液面弧形路径 */
function poolLiquidPath(node: MxNode): string {
  const val = Math.max(0, nodeValue(node))
  if (val <= 0) return ''
  const maxRef = node.capacity && node.capacity > 0 ? node.capacity : Math.max(20, val * 1.5)
  const fillRatio = Math.max(0.14, Math.min(0.88, val / maxRef))
  const r = 16.5
  const yLevel = r - fillRatio * (2 * r)
  const halfChord = Math.sqrt(Math.max(0, r * r - yLevel * yLevel))
  const largeArc = fillRatio > 0.5 ? 1 : 0
  return `M ${-halfChord},${yLevel} A ${r},${r} 0 ${largeArc},0 ${halfChord},${yLevel} Z`
}

// ══════════ 60fps 资源球沿边飞行与节点脉冲动画引擎 ══════════
const streamPhase = ref(0)
const burstProgress = ref(1)
let rafId: number | null = null
let burstStartMs = performance.now()

/** 仅在正在连续播放（playing）或单步触发的飞行动画窗口内（burstProgress < 0.98）显示资源流动动画 */
const isFlowAnimating = computed(() => store.playing.value || burstProgress.value < 0.98)

const pulseWave = computed(() => {
  // 在单步触发窗口内使用 burstProgress，否则使用柔和的周期脉动（严格钳制在 0..1）
  const raw = burstProgress.value < 0.99 ? burstProgress.value : streamPhase.value
  return Math.max(0, Math.min(1, raw))
})

function sampleEdgePoint(geo: EdgeGeo, tVal: number): { x: number; y: number } {
  const t = Math.max(0, Math.min(1, tVal))
  const u = 1 - t
  return {
    x: u * u * geo.sx + 2 * u * t * geo.cx + t * t * geo.ex,
    y: u * u * geo.sy + 2 * u * t * geo.cy + t * t * geo.ey
  }
}

function edgeFlowTokens(geo: EdgeGeo): Array<{ x: number; y: number }> {
  if (!isFlowAnimating.value) return []
  const flow = store.displayFlows.value[geo.edge.id] ?? 0
  if (flow <= 0) return []
  const count = Math.min(4, Math.max(1, Math.ceil(flow)))
  const pts: Array<{ x: number; y: number }> = []
  const isBursting = burstProgress.value < 0.98
  for (let i = 0; i < count; i++) {
    let tPos: number
    if (isBursting) {
      const delayed = Math.max(0, Math.min(1, (burstProgress.value - i * 0.12) / 0.72))
      // Cubic ease-out for snappy token flight
      tPos = 1 - Math.pow(1 - delayed, 3)
    } else {
      tPos = (streamPhase.value + i / count) % 1
    }
    pts.push(sampleEdgePoint(geo, tPos))
  }
  return pts
}

function startAnimLoop(): void {
  if (rafId !== null) return
  const tick = (now: number): void => {
    const hasActiveFlow = store.playing.value || burstProgress.value < 0.99
    if (hasActiveFlow) {
      const speed = Math.max(0.25, store.doc.value.settings.speed || 1)
      const burstDur = Math.max(180, 480 / speed)
      const cycleDur = Math.max(450, 1350 / speed)
      if (now < burstStartMs) burstStartMs = now
      burstProgress.value = Math.max(0, Math.min(1, (now - burstStartMs) / burstDur))
      streamPhase.value = Math.max(0, Math.min(1, (now % cycleDur) / cycleDur))
    }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

watch(
  () => store.playStep.value,
  (nextStep, prevStep) => {
    // 正在播放或手动单步前进（Step +1 / 点击交互节点）时触发一次资源球飞行；若运行已结束或重置到 0 则静止
    if (nextStep > 0 && (store.playing.value || Math.abs(nextStep - (prevStep ?? 0)) === 1)) {
      burstStartMs = performance.now()
      burstProgress.value = 0
    } else if (!store.playing.value) {
      burstProgress.value = 1
    }
  }
)

watch(
  () => store.playing.value,
  (isPlaying) => {
    // 播放结束或暂停的瞬间，立即停止连线上的持续流动动画
    if (!isPlaying) {
      burstProgress.value = 1
    }
  }
)

function nodeSubLabel(node: MxNode): string {
  if (node.kind === 'pool' && node.capacity && node.capacity > 0) return `max ${node.capacity}`
  if (node.kind === 'register' && node.formula)
    return node.formula.length > 18 ? `${node.formula.slice(0, 17)}…` : node.formula
  if ((node.kind === 'delay' || node.kind === 'queue') && node.delaySteps)
    return `${node.delaySteps} steps`
  if (node.kind === 'end' && node.formula) return node.formula
  return ''
}

function subW(node: MxNode): number {
  return Math.max(30, nodeSubLabel(node).length * 5.8 + 14)
}

function shapePath(kind: MxNodeKind, r: number): string {
  switch (kind) {
    case 'pool':
      return `M ${-r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0`
    case 'source':
      return `M 0,${-r} L ${r},${r * 0.8} L ${-r},${r * 0.8} Z`
    case 'drain':
      return `M ${-r},${-r * 0.8} L ${r},${-r * 0.8} L 0,${r} Z`
    case 'gate':
      return `M 0,${-r} L ${r},0 L 0,${r} L ${-r},0 Z`
    case 'converter':
      return `M ${-r * 0.82},${-r} L ${r * 0.88},0 L ${-r * 0.82},${r} Z`
    case 'trader':
      return `M ${-r},${-r * 0.72} L 0,0 L ${-r},${r * 0.72} Z M ${r},${-r * 0.72} L 0,0 L ${r},${r * 0.72} Z`
    case 'register':
    case 'end':
      return `M ${-r * 0.85},${-r * 0.85} H ${r * 0.85} V ${r * 0.85} H ${-r * 0.85} Z`
    case 'delay':
      return `M ${-r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0 M 0,${-r * 0.6} V 0 H ${r * 0.5}`
    case 'queue':
      return `M ${-r},0 a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0 M ${-r * 0.5},${-r * 0.3} H ${r * 0.5} M ${-r * 0.5},${r * 0.3} H ${r * 0.5}`
    case 'note':
      return `M ${-r},${-r} H ${r * 0.5} L ${r},${-r * 0.5} V ${r} H ${-r} Z`
  }
}

function nodeRadius(node: MxNode): number {
  return node.kind === 'note' ? Math.max(node.width ?? 160, node.height ?? 80) / 2 : 21
}

// ───────── 连线几何计算（含指向节点 & 指向另一条连线的状态边） ─────────
interface EdgeGeo {
  edge: MxEdge
  path: string
  sx: number
  sy: number
  cx: number
  cy: number
  ex: number
  ey: number
  mid: { x: number; y: number }
  nx: number
  ny: number
  color: string
  tokenColor: string
  marker: string
  label: string
  labelW: number
}

const edgeGeometries = computed<EdgeGeo[]>(() => {
  const out: EdgeGeo[] = []
  const midByEdgeId = new Map<string, { x: number; y: number }>()
  const pairs = new Set(store.doc.value.edges.map((e) => `${e.from}>${e.to}`))

  // 第一遍先算普通 Node -> Node 连线，记录中点供 Edge -> Edge 状态边引用
  const firstPass = store.doc.value.edges.filter((e) => !e.targetEdgeId)
  const secondPass = store.doc.value.edges.filter((e) => !!e.targetEdgeId)

  for (const e of [...firstPass, ...secondPass]) {
    if (!visibleIds.value.has(e.from)) continue
    const a = nodeById.value.get(e.from)
    if (!a) continue

    let bx = 0
    let by = 0
    let rb = 10
    if (e.targetEdgeId) {
      const targetMid = midByEdgeId.get(e.targetEdgeId)
      if (!targetMid) continue
      bx = targetMid.x
      by = targetMid.y
      rb = 12
    } else {
      if (!visibleIds.value.has(e.to)) continue
      const b = nodeById.value.get(e.to)
      if (!b) continue
      bx = b.x
      by = b.y
      rb = nodeRadius(b) + 6
    }

    const dx = bx - a.x
    const dy = by - a.y
    const len = Math.max(1, Math.hypot(dx, dy))
    const ux = dx / len
    const uy = dy / len
    const reverse = !e.targetEdgeId && pairs.has(`${e.to}>${e.from}`)
    const defaultBend = reverse
      ? 28
      : e.kind === 'state' && !e.targetEdgeId
        ? Math.min(48, len * 0.14)
        : 0
    const bend = e.bend !== undefined ? e.bend : defaultBend
    const nx = -uy
    const ny = ux
    const ra = nodeRadius(a) + 2
    const sx = a.x + ux * ra
    const sy = a.y + uy * ra
    const ex = bx - ux * rb
    const ey = by - uy * rb
    const cx = (sx + ex) / 2 + nx * bend
    const cy = (sy + ey) / 2 + ny * bend
    const path =
      Math.abs(bend) > 0.5
        ? `M ${sx},${sy} Q ${cx},${cy} ${ex},${ey}`
        : `M ${sx},${sy} L ${ex},${ey}`
    const mid =
      Math.abs(bend) > 0.5
        ? { x: (sx + 2 * cx + ex) / 4, y: (sy + 2 * cy + ey) / 4 }
        : { x: (sx + ex) / 2, y: (sy + ey) / 2 }

    midByEdgeId.set(e.id, mid)

    const negative = e.kind === 'state' && /^\s*(-|!|<)/.test(e.formula)
    const selected = isEdgeSelected(e.id)
    const color = selected
      ? '#3d8bfd'
      : e.color || (e.kind === 'state' ? (negative ? '#f87171' : '#38bdf8') : '#94a3b8')
    const marker = selected
      ? 'mx-arrow-sel'
      : e.kind === 'state'
        ? negative
          ? 'mx-arrow-neg'
          : 'mx-arrow-state'
        : 'mx-arrow'
    const flow = store.displayFlows.value[e.id] ?? 0
    const label =
      flow > 0 && e.kind === 'resource'
        ? `${e.formula || '1'} → ${formatValue(Math.round(flow * 10) / 10)}`
        : e.formula || (e.kind === 'state' ? '*' : '1')
    const src = nodeById.value.get(e.from)
    out.push({
      edge: e,
      path,
      sx,
      sy,
      cx,
      cy,
      ex,
      ey,
      mid,
      nx,
      ny,
      color,
      tokenColor: src ? nodeColor(src) : '#3d8bfd',
      marker,
      label,
      labelW: Math.max(24, label.length * 6.4 + 14)
    })
  }
  return out
})

const renderedEdgeGeometries = computed<EdgeGeo[]>(() => {
  const all = edgeGeometries.value
  if (!isLargeGraph.value) return all
  const rIds = renderedNodeIds.value
  const selE = selectedEdgeSet.value
  const r = viewportWorldRect.value
  return all.filter(
    (g) =>
      rIds.has(g.edge.from) ||
      rIds.has(g.edge.to) ||
      selE.has(g.edge.id) ||
      (g.mid.x >= r.minX && g.mid.x <= r.maxX && g.mid.y >= r.minY && g.mid.y <= r.maxY)
  )
})

function isNodeSelected(id: string): boolean {
  return selectedNodeSet.value.has(id)
}
function isEdgeSelected(id: string): boolean {
  return selectedEdgeSet.value.has(id)
}

const selectedSingleNode = computed<MxNode | null>(() => {
  if (store.selection.nodes.length !== 1 || store.selection.edges.length > 0) return null
  return nodeById.value.get(store.selection.nodes[0]!) ?? null
})

const selectedNodeFloatStyle = computed(() => {
  const n = selectedSingleNode.value
  if (!n) return {}
  const sx = n.x * store.view.zoom + store.view.x
  const sy = (n.y - nodeRadius(n) - 18) * store.view.zoom + store.view.y
  return {
    left: `${sx}px`,
    top: `${Math.max(48, sy)}px`
  }
})

const selectedSingleEdgeGeo = computed<EdgeGeo | null>(() => {
  if (store.selection.edges.length !== 1 || store.selection.nodes.length > 0) return null
  return edgeGeometries.value.find((g) => g.edge.id === store.selection.edges[0]) ?? null
})

const selectedEdgeFloatStyle = computed(() => {
  const g = selectedSingleEdgeGeo.value
  if (!g) return {}
  const sx = g.mid.x * store.view.zoom + store.view.x
  const sy = g.mid.y * store.view.zoom + store.view.y - 34
  return {
    left: `${sx}px`,
    top: `${Math.max(48, sy)}px`
  }
})

// ───────── 坐标换算 ─────────
function toWorld(ev: PointerEvent | WheelEvent | MouseEvent): {
  x: number
  y: number
  sx: number
  sy: number
} {
  const rect = svgRef.value!.getBoundingClientRect()
  const sx = ev.clientX - rect.left
  const sy = ev.clientY - rect.top
  return {
    sx,
    sy,
    x: (sx - store.view.x) / store.view.zoom,
    y: (sy - store.view.y) / store.view.zoom
  }
}

// ───────── 交互状态 ─────────
const panState = ref<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
const dragState = ref<{
  ids: string[]
  lastX: number
  lastY: number
  key: string
  moved: boolean
} | null>(null)
const bendDrag = ref<{
  edgeId: string
  startX: number
  startY: number
  nx: number
  ny: number
  initialBend: number
} | null>(null)
const groupDrag = ref<{
  groupId: string
  lastX: number
  lastY: number
  key: string
} | null>(null)
const groupResize = ref<{
  groupId: string
  startX: number
  startY: number
  initW: number
  initH: number
  key: string
} | null>(null)
const marquee = ref<{ x0: number; y0: number; x1: number; y1: number; additive: boolean } | null>(
  null
)
const connectDrag = ref<{
  kind: MxEdgeKind
  from: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  hoverNodeId: string
  hoverEdgeId: string
  sticky?: boolean
} | null>(null)
const alignGuides = ref<Array<{ x1: number; y1: number; x2: number; y2: number }>>([])
const quickConnectMenu = ref<{
  fromNodeId: string
  edgeKind: MxEdgeKind
  wx: number
  wy: number
  sx: number
  sy: number
} | null>(null)
const contextMenu = ref<{
  targetType: 'canvas' | 'node' | 'edge'
  wx: number
  wy: number
  sx: number
  sy: number
  nodeId?: string
  edgeId?: string
} | null>(null)

let spaceDown = false

const connectPreviewPath = computed(() => {
  const c = connectDrag.value
  if (!c) return ''
  const dx = c.toX - c.fromX
  const dy = c.toY - c.fromY
  const len = Math.hypot(dx, dy)
  if (c.kind === 'state' && len > 30) {
    const cx = (c.fromX + c.toX) / 2 - (dy / len) * 24
    const cy = (c.fromY + c.toY) / 2 + (dx / len) * 24
    return `M ${c.fromX},${c.fromY} Q ${cx},${cy} ${c.toX},${c.toY}`
  }
  return `M ${c.fromX},${c.fromY} L ${c.toX},${c.toY}`
})

function closeMenus(): void {
  quickConnectMenu.value = null
  contextMenu.value = null
}

function startPortConnect(
  node: MxNode,
  kind: MxEdgeKind,
  ev: PointerEvent,
  offsetX = 0,
  offsetY = 0
): void {
  closeMenus()
  if (!isNodeSelected(node.id)) {
    store.select([node.id], [])
  }
  const actualKind: MxEdgeKind = ev.altKey ? 'state' : kind
  const p = toWorld(ev)
  const startX = node.x + offsetX
  const startY = node.y + offsetY
  connectDrag.value = {
    kind: actualKind,
    from: node.id,
    fromX: startX,
    fromY: startY,
    toX: p.x,
    toY: p.y,
    hoverNodeId: '',
    hoverEdgeId: '',
    sticky: false
  }
}

function startBendDrag(edge: MxEdge, ev: PointerEvent): void {
  const geo = edgeGeometries.value.find((g) => g.edge.id === edge.id)
  if (!geo) return
  const p = toWorld(ev)
  bendDrag.value = {
    edgeId: edge.id,
    startX: p.x,
    startY: p.y,
    nx: geo.nx,
    ny: geo.ny,
    initialBend: edge.bend ?? 0
  }
}

function startGroupDrag(grp: MxGroup, ev: PointerEvent): void {
  if (ev.button !== 0) return
  const p = toWorld(ev)
  groupDrag.value = {
    groupId: grp.id,
    lastX: p.x,
    lastY: p.y,
    key: `grpDrag:${grp.id}:${Date.now()}`
  }
}

function startGroupResize(grp: MxGroup, ev: PointerEvent): void {
  if (ev.button !== 0) return
  const p = toWorld(ev)
  groupResize.value = {
    groupId: grp.id,
    startX: p.x,
    startY: p.y,
    initW: grp.width,
    initH: grp.height,
    key: `grpRes:${grp.id}:${Date.now()}`
  }
}

function onBgPointerDown(ev: PointerEvent): void {
  rootRef.value?.focus()
  closeMenus()
  if (ev.button === 2 && connectDrag.value) {
    connectDrag.value = null
    return
  }
  if (connectDrag.value?.sticky) {
    // 处于点击连线模式时，交由 onPointerUp 处理空白处快速新建或取消
    return
  }
  const p = toWorld(ev)
  if (ev.button === 1 || spaceDown) {
    panState.value = { sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y }
    return
  }
  if (ev.button === 2) return
  if (isNodeTool.value) {
    const gx = store.snapToGrid.value ? Math.round(p.x / 20) * 20 : p.x
    const gy = store.snapToGrid.value ? Math.round(p.y / 20) * 20 : p.y
    store.addNode(store.tool.value as MxNodeKind, gx, gy)
    if (!ev.shiftKey) store.tool.value = 'select'
    return
  }
  if (store.tool.value === 'select') {
    marquee.value = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, additive: ev.shiftKey }
    if (!ev.shiftKey) store.select([])
  }
  edgeEdit.value = null
}

function onNodePointerDown(node: MxNode, ev: PointerEvent): void {
  rootRef.value?.focus()
  closeMenus()
  if (connectDrag.value?.sticky) {
    // 处于点击连线模式时，点击目标节点由 onPointerUp 完成连线
    return
  }
  if (ev.button === 1) {
    panState.value = { sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y }
    return
  }
  if (ev.button === 2) return

  // Alt + 拖拽节点：直接拖出连线（Shift+Alt 为状态边，Alt 为资源边）
  const tl = store.tool.value
  if (ev.altKey || tl === 'resource_edge' || tl === 'state_edge') {
    const kind: MxEdgeKind =
      tl === 'state_edge' || (ev.altKey && ev.shiftKey) ? 'state' : 'resource'
    connectDrag.value = {
      kind,
      from: node.id,
      fromX: node.x,
      fromY: node.y,
      toX: node.x,
      toY: node.y,
      hoverNodeId: '',
      hoverEdgeId: '',
      sticky: false
    }
    return
  }

  // 运行中点击交互节点 → 立即触发一步
  if (node.trigger === 'interactive' && (store.liveState.value || store.playing.value)) {
    store.interact(node.id)
    return
  }

  if (!isNodeSelected(node.id)) store.select([node.id], [], ev.shiftKey)
  else if (ev.shiftKey) {
    store.select(
      store.selection.nodes.filter((id) => id !== node.id),
      store.selection.edges
    )
    return
  }
  const ids = store.selection.nodes.filter((id) => {
    const n = nodeById.value.get(id)
    return n && !isLocked(n)
  })
  const p = toWorld(ev)
  dragState.value = { ids, lastX: p.x, lastY: p.y, key: `drag:${Date.now()}`, moved: false }
}

function onNodeDblClick(node: MxNode): void {
  if (node.kind === 'note') {
    startNodeLabelEdit(node)
    return
  }
  store.interact(node.id)
}

function onEdgePointerDown(id: string, ev: PointerEvent): void {
  rootRef.value?.focus()
  closeMenus()
  store.select([], [id], ev.shiftKey)
}

function hitNode(x: number, y: number): MxNode | null {
  for (const n of [...visibleNodes.value].reverse()) {
    if (n.kind === 'note') {
      if (Math.abs(x - n.x) <= (n.width ?? 160) / 2 && Math.abs(y - n.y) <= (n.height ?? 80) / 2)
        return n
    } else if (Math.hypot(x - n.x, y - n.y) <= 28) return n
  }
  return null
}

function hitEdgeMidpoint(x: number, y: number): EdgeGeo | null {
  for (const geo of edgeGeometries.value) {
    if (Math.hypot(x - geo.mid.x, y - geo.mid.y) <= 22) return geo
  }
  return null
}

function onPointerMove(ev: PointerEvent): void {
  if (panState.value) {
    store.view.x = panState.value.vx + (ev.clientX - panState.value.sx)
    store.view.y = panState.value.vy + (ev.clientY - panState.value.sy)
    return
  }
  const p = toWorld(ev)

  if (bendDrag.value) {
    const b = bendDrag.value
    const dx = p.x - b.startX
    const dy = p.y - b.startY
    const proj = (dx * b.nx + dy * b.ny) * 2
    store.updateEdge(b.edgeId, { bend: Math.round(b.initialBend + proj) }, `bend:${b.edgeId}`)
    return
  }

  if (groupResize.value) {
    const gr = groupResize.value
    const nextW = Math.max(120, Math.round(gr.initW + (p.x - gr.startX)))
    const nextH = Math.max(90, Math.round(gr.initH + (p.y - gr.startY)))
    store.updateGroup(gr.groupId, { width: nextW, height: nextH }, gr.key)
    return
  }

  if (groupDrag.value) {
    const gd = groupDrag.value
    const dx = p.x - gd.lastX
    const dy = p.y - gd.lastY
    if (Math.abs(dx) + Math.abs(dy) >= 0.5) {
      gd.lastX = p.x
      gd.lastY = p.y
      store.moveGroup(gd.groupId, dx, dy, gd.key)
    }
    return
  }

  if (dragState.value && dragState.value.ids.length) {
    let dx = p.x - dragState.value.lastX
    let dy = p.y - dragState.value.lastY
    if (Math.abs(dx) + Math.abs(dy) < 0.5) return

    // 单节点拖拽时计算智能对齐辅助线 (Smart Alignment Guides)
    const guides: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
    if (dragState.value.ids.length === 1) {
      const moving = nodeById.value.get(dragState.value.ids[0]!)
      if (moving) {
        const nextX = moving.x + dx
        const nextY = moving.y + dy
        for (const other of visibleNodes.value) {
          if (other.id === moving.id) continue
          if (Math.abs(other.x - nextX) < 6) {
            dx = other.x - moving.x
            guides.push({
              x1: other.x,
              y1: Math.min(other.y, nextY) - 40,
              x2: other.x,
              y2: Math.max(other.y, nextY) + 40
            })
          }
          if (Math.abs(other.y - nextY) < 6) {
            dy = other.y - moving.y
            guides.push({
              x1: Math.min(other.x, nextX) - 40,
              y1: other.y,
              x2: Math.max(other.x, nextX) + 40,
              y2: other.y
            })
          }
        }
      }
    }
    alignGuides.value = guides

    dragState.value.lastX = p.x
    dragState.value.lastY = p.y
    dragState.value.moved = true
    store.moveNodes(dragState.value.ids, dx, dy, dragState.value.key)
    return
  }

  if (connectDrag.value) {
    const targetNode = hitNode(p.x, p.y)
    const targetEdge = !targetNode ? hitEdgeMidpoint(p.x, p.y) : null
    if (targetNode && targetNode.id !== connectDrag.value.from) {
      const dx = targetNode.x - connectDrag.value.fromX
      const dy = targetNode.y - connectDrag.value.fromY
      const dist = Math.hypot(dx, dy) || 1
      const r = nodeRadius(targetNode) + 4
      connectDrag.value.toX = targetNode.x - (dx / dist) * r
      connectDrag.value.toY = targetNode.y - (dy / dist) * r
      connectDrag.value.hoverNodeId = targetNode.id
      connectDrag.value.hoverEdgeId = ''
    } else if (targetEdge && targetEdge.edge.from !== connectDrag.value.from) {
      connectDrag.value.toX = targetEdge.mid.x
      connectDrag.value.toY = targetEdge.mid.y
      connectDrag.value.hoverNodeId = ''
      connectDrag.value.hoverEdgeId = targetEdge.edge.id
    } else {
      connectDrag.value.toX = p.x
      connectDrag.value.toY = p.y
      connectDrag.value.hoverNodeId = ''
      connectDrag.value.hoverEdgeId = ''
    }
    return
  }

  if (marquee.value) {
    marquee.value.x1 = p.sx
    marquee.value.y1 = p.sy
  }
}

function onPointerUp(ev: PointerEvent): void {
  alignGuides.value = []
  if (bendDrag.value) {
    bendDrag.value = null
  }
  if (groupDrag.value) {
    groupDrag.value = null
  }
  if (groupResize.value) {
    groupResize.value = null
  }
  if (connectDrag.value) {
    const cd = connectDrag.value
    const p = toWorld(ev)
    const target = hitNode(p.x, p.y)
    const targetEdge = !target ? hitEdgeMidpoint(p.x, p.y) : null
    const distFromSource = Math.hypot(p.x - cd.fromX, p.y - cd.fromY)

    if (target && target.id !== cd.from) {
      store.addEdge(cd.kind, cd.from, target.id)
      if (!ev.shiftKey) store.tool.value = 'select'
      connectDrag.value = null
    } else if (targetEdge && targetEdge.edge.from !== cd.from) {
      store.addEdgeToEdge(cd.from, targetEdge.edge.id)
      if (!ev.shiftKey) store.tool.value = 'select'
      connectDrag.value = null
    } else if (distFromSource <= 34 && !cd.sticky) {
      // 用户单击了 + / S 锚点（未按住拖远）：进入粘滞连线模式，移动鼠标再点目标节点即可完成连线
      cd.sticky = true
    } else if (distFromSource > 36) {
      // 拖线或粘滞点击在空白处 → 弹出快速新建并连线菜单
      quickConnectMenu.value = {
        fromNodeId: cd.from,
        edgeKind: cd.kind,
        wx: store.snapToGrid.value ? Math.round(p.x / 20) * 20 : p.x,
        wy: store.snapToGrid.value ? Math.round(p.y / 20) * 20 : p.y,
        sx: Math.min(p.sx, (svgRef.value?.clientWidth ?? 600) - 210),
        sy: Math.min(p.sy, (svgRef.value?.clientHeight ?? 400) - 180)
      }
      connectDrag.value = null
    } else {
      connectDrag.value = null
    }
  }
  if (marquee.value) {
    const m = marquee.value
    const x0 = (Math.min(m.x0, m.x1) - store.view.x) / store.view.zoom
    const x1 = (Math.max(m.x0, m.x1) - store.view.x) / store.view.zoom
    const y0 = (Math.min(m.y0, m.y1) - store.view.y) / store.view.zoom
    const y1 = (Math.max(m.y0, m.y1) - store.view.y) / store.view.zoom
    if (Math.abs(m.x1 - m.x0) > 4 || Math.abs(m.y1 - m.y0) > 4) {
      const ids = visibleNodes.value
        .filter((n) => n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1)
        .map((n) => n.id)
      const idSet = new Set(ids)
      const edges = store.doc.value.edges
        .filter((e) => idSet.has(e.from) && idSet.has(e.to))
        .map((e) => e.id)
      store.select(ids, edges, m.additive)
    }
    marquee.value = null
  }
  if (dragState.value?.moved && store.snapToGrid.value) {
    const ids = dragState.value.ids
    store.mutate((d) => {
      for (const n of d.nodes) {
        if (ids.includes(n.id)) {
          n.x = Math.round(n.x / 10) * 10
          n.y = Math.round(n.y / 10) * 10
        }
      }
    }, dragState.value.key)
  }
  panState.value = null
  dragState.value = null
}

function confirmQuickConnectSpawn(kind: MxNodeKind): void {
  const qm = quickConnectMenu.value
  if (!qm) return
  const newNode = store.addNode(kind, qm.wx, qm.wy)
  store.addEdge(qm.edgeKind, qm.fromNodeId, newNode.id)
  store.select([newNode.id])
  quickConnectMenu.value = null
}

function onCanvasContextMenu(ev: MouseEvent): void {
  const p = toWorld(ev)
  contextMenu.value = {
    targetType: 'canvas',
    wx: p.x,
    wy: p.y,
    sx: Math.min(p.sx, (svgRef.value?.clientWidth ?? 600) - 210),
    sy: Math.min(p.sy, (svgRef.value?.clientHeight ?? 400) - 240)
  }
}

function onNodeContextMenu(node: MxNode, ev: MouseEvent): void {
  if (!isNodeSelected(node.id)) store.select([node.id])
  const p = toWorld(ev)
  contextMenu.value = {
    targetType: 'node',
    wx: p.x,
    wy: p.y,
    sx: p.sx,
    sy: p.sy,
    nodeId: node.id
  }
}

function onEdgeContextMenu(edge: MxEdge, ev: MouseEvent): void {
  if (!isEdgeSelected(edge.id)) store.select([], [edge.id])
  const p = toWorld(ev)
  contextMenu.value = {
    targetType: 'edge',
    wx: p.x,
    wy: p.y,
    sx: p.sx,
    sy: p.sy,
    edgeId: edge.id
  }
}

function spawnNodeAtContext(kind: MxNodeKind): void {
  const cm = contextMenu.value
  if (!cm) return
  store.addNode(kind, cm.wx, cm.wy)
  contextMenu.value = null
}

function onAutoLayout(): void {
  store.autoLayout()
  void nextTick(() => fitView())
}

function cycleCanvasTheme(): void {
  const order: MxCanvasTheme[] = ['auto', 'light', 'dark']
  const idx = order.indexOf(store.canvasTheme.value)
  store.canvasTheme.value = order[(idx + 1) % order.length]!
}

function onWheel(ev: WheelEvent): void {
  if (ev.ctrlKey || ev.metaKey || Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
    const p = toWorld(ev)
    const factor = Math.exp(-ev.deltaY * 0.0015)
    const z = Math.max(0.15, Math.min(4, store.view.zoom * factor))
    store.view.x = p.sx - p.x * z
    store.view.y = p.sy - p.y * z
    store.view.zoom = z
  } else {
    store.view.x -= ev.deltaX
    store.view.y -= ev.deltaY
  }
}

function zoomBy(f: number): void {
  const rect = svgRef.value?.getBoundingClientRect()
  const cx = (rect?.width ?? 800) / 2
  const cy = (rect?.height ?? 500) / 2
  const wx = (cx - store.view.x) / store.view.zoom
  const wy = (cy - store.view.y) / store.view.zoom
  const z = Math.max(0.15, Math.min(4, store.view.zoom * f))
  store.view.x = cx - wx * z
  store.view.y = cy - wy * z
  store.view.zoom = z
}

function resetZoom(): void {
  zoomBy(1 / store.view.zoom)
}

function fitView(): void {
  const nodes = visibleNodes.value
  const rect = svgRef.value?.getBoundingClientRect()
  if (!rect || !nodes.length) return
  const minX = Math.min(...nodes.map((n) => n.x)) - 90
  const maxX = Math.max(...nodes.map((n) => n.x)) + 90
  const minY = Math.min(...nodes.map((n) => n.y)) - 80
  const maxY = Math.max(...nodes.map((n) => n.y)) + 90
  const z = Math.max(
    0.2,
    Math.min(1.5, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)))
  )
  store.view.zoom = z
  store.view.x = (rect.width - (maxX - minX) * z) / 2 - minX * z
  store.view.y = (rect.height - (maxY - minY) * z) / 2 - minY * z
}

// ───────── 连线公式 & 节点名称 & 分组标题内联编辑 ─────────
const edgeEdit = ref<{ id: string; value: string; sx: number; sy: number } | null>(null)
const nodeEdit = ref<{
  id: string
  isNote: boolean
  isGroup?: boolean
  value: string
  sx: number
  sy: number
} | null>(null)

function startEdgeEdit(id: string): void {
  const geo = edgeGeometries.value.find((g) => g.edge.id === id)
  if (!geo) return
  edgeEdit.value = {
    id,
    value: geo.edge.formula,
    sx: geo.mid.x * store.view.zoom + store.view.x,
    sy: geo.mid.y * store.view.zoom + store.view.y
  }
  void nextTick(() => {
    edgeInputRef.value?.focus()
    edgeInputRef.value?.select()
  })
}

function commitEdgeEdit(): void {
  const ed = edgeEdit.value
  if (!ed) return
  edgeEdit.value = null
  store.updateEdge(ed.id, { formula: ed.value.trim() })
}

function startNodeLabelEdit(node: MxNode): void {
  if (isLocked(node)) return
  const isNote = node.kind === 'note'
  nodeEdit.value = {
    id: node.id,
    isNote,
    value: isNote ? (node.text ?? node.label) : node.label,
    sx: node.x * store.view.zoom + store.view.x,
    sy: (isNote ? node.y : node.y + 34) * store.view.zoom + store.view.y
  }
  void nextTick(() => {
    nodeInputRef.value?.focus()
    nodeInputRef.value?.select()
  })
}

function startGroupLabelEdit(grp: MxGroup): void {
  nodeEdit.value = {
    id: grp.id,
    isNote: false,
    isGroup: true,
    value: grp.label,
    sx: (grp.x + 80) * store.view.zoom + store.view.x,
    sy: (grp.y + 13) * store.view.zoom + store.view.y
  }
  void nextTick(() => {
    nodeInputRef.value?.focus()
    nodeInputRef.value?.select()
  })
}

function commitNodeEdit(): void {
  const nd = nodeEdit.value
  if (!nd) return
  nodeEdit.value = null
  const val = nd.value.trim()
  if (!val) return
  if (nd.isGroup) {
    store.updateGroup(nd.id, { label: val })
  } else if (nd.isNote) {
    store.updateNode(nd.id, { text: val, label: val.slice(0, 20) })
  } else {
    store.updateNode(nd.id, { label: val })
  }
}

// ───────── 搜索定位 (Ctrl+F) 与鸟瞰小地图 (Minimap) ─────────
interface SearchHit {
  id: string
  kind: 'node' | 'edge'
  badge: string
  title: string
  sub: string
  wx: number
  wy: number
}

const searchResults = computed<SearchHit[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const out: SearchHit[] = []
  for (const n of visibleNodes.value) {
    if (
      !q ||
      n.label.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q) ||
      (n.formula ?? '').toLowerCase().includes(q)
    ) {
      out.push({
        id: n.id,
        kind: 'node',
        badge: n.kind.toUpperCase().slice(0, 4),
        title: n.label || n.id,
        sub: `#${n.id}`,
        wx: n.x,
        wy: n.y
      })
    }
  }
  for (const geo of edgeGeometries.value) {
    const e = geo.edge
    if (q && (e.formula.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))) {
      out.push({
        id: e.id,
        kind: 'edge',
        badge: e.kind === 'state' ? 'STATE' : 'RES',
        title: e.formula || '1',
        sub: `${e.from} → ${e.to}`,
        wx: geo.mid.x,
        wy: geo.mid.y
      })
    }
  }
  return out.slice(0, 12)
})

function toggleSearch(): void {
  searchOpen.value = !searchOpen.value
  if (searchOpen.value) {
    void nextTick(() => searchInputRef.value?.focus())
  }
}

function focusSearchResult(item: SearchHit): void {
  if (item.kind === 'node') store.select([item.id], [])
  else store.select([], [item.id])
  const rect = svgRef.value?.getBoundingClientRect()
  const cw = rect?.width ?? 800
  const ch = rect?.height ?? 500
  store.view.x = cw / 2 - item.wx * store.view.zoom
  store.view.y = ch / 2 - item.wy * store.view.zoom
}

const minimapBounds = computed(() => {
  const nodes = visibleNodes.value
  const grps = store.doc.value.groups ?? []
  let minX = 0
  let maxX = 1000
  let minY = 0
  let maxY = 600
  if (nodes.length || grps.length) {
    const xs = [...nodes.map((n) => n.x), ...grps.flatMap((g) => [g.x, g.x + g.width])]
    const ys = [...nodes.map((n) => n.y), ...grps.flatMap((g) => [g.y, g.y + g.height])]
    minX = Math.min(...xs) - 100
    maxX = Math.max(...xs) + 100
    minY = Math.min(...ys) - 80
    maxY = Math.max(...ys) + 80
  }
  const w = Math.max(300, maxX - minX)
  const h = Math.max(200, maxY - minY)
  const rect = svgRef.value?.getBoundingClientRect()
  const cw = rect?.width ?? 800
  const ch = rect?.height ?? 480
  const vx = -store.view.x / store.view.zoom
  const vy = -store.view.y / store.view.zoom
  const vw = cw / store.view.zoom
  const vh = ch / store.view.zoom
  return {
    minX,
    minY,
    w,
    h,
    viewBox: `${minX} ${minY} ${w} ${h}`,
    vx,
    vy,
    vw,
    vh
  }
})

function onMinimapPointerDown(ev: PointerEvent): void {
  const svg = ev.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const b = minimapBounds.value
  const wx = b.minX + ((ev.clientX - rect.left) / Math.max(1, rect.width)) * b.w
  const wy = b.minY + ((ev.clientY - rect.top) / Math.max(1, rect.height)) * b.h
  const mainRect = svgRef.value?.getBoundingClientRect()
  const cw = mainRect?.width ?? 800
  const ch = mainRect?.height ?? 480
  store.view.x = cw / 2 - wx * store.view.zoom
  store.view.y = ch / 2 - wy * store.view.zoom
}

// ───────── 键盘快捷键 ─────────
function onKeyDown(ev: KeyboardEvent): void {
  if (
    (ev.target as HTMLElement)?.tagName === 'INPUT' ||
    (ev.target as HTMLElement)?.tagName === 'TEXTAREA'
  )
    return
  const mod = ev.ctrlKey || ev.metaKey
  if (ev.key === ' ') {
    spaceDown = true
    const up = (): void => {
      spaceDown = false
      window.removeEventListener('keyup', up)
    }
    window.addEventListener('keyup', up)
    ev.preventDefault()
    return
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    store.deleteSelection()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'z') {
    if (ev.shiftKey) store.redo()
    else store.undo()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'y') {
    store.redo()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'c') {
    store.copySelection()
  } else if (mod && ev.key.toLowerCase() === 'v') {
    store.pasteNodes()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'd') {
    store.duplicateSelection()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'g') {
    store.createGroupFromSelection()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'f') {
    toggleSearch()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'a') {
    store.select(
      visibleNodes.value.map((n) => n.id),
      store.doc.value.edges.map((e) => e.id)
    )
    ev.preventDefault()
  } else if (ev.key === 'Escape') {
    store.tool.value = 'select'
    store.select([])
    connectDrag.value = null
    closeMenus()
  } else if (ev.key === 'v' || ev.key === 'V') {
    store.tool.value = 'select'
  } else if (ev.key === 'f' || ev.key === 'F') {
    fitView()
  }
}

onMounted(() => {
  startAnimLoop()
  void nextTick(() => fitView())
})

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
})

function buildCleanDiagramSvg(): { svgText: string; width: number; height: number } | null {
  const srcSvg = svgRef.value
  if (!srcSvg) return null
  const b = minimapBounds.value
  const width = Math.max(480, Math.round(b.w))
  const height = Math.max(320, Math.round(b.h))
  const cloned = srcSvg.cloneNode(true) as SVGSVGElement
  cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  cloned.setAttribute('width', String(width))
  cloned.setAttribute('height', String(height))
  cloned.setAttribute('viewBox', `${b.minX} ${b.minY} ${width} ${height}`)

  const isDark =
    store.canvasTheme.value === 'dark' ||
    (store.canvasTheme.value === 'auto' &&
      !document.documentElement.getAttribute('data-theme')?.includes('light'))
  const bgFill = isDark ? '#181a1d' : '#f8f9fb'
  const nodeFill = isDark ? '#25282c' : '#ffffff'
  const labelFg = isDark ? '#e8eaed' : '#1e293b'
  const pillBorder = isDark ? '#3c4043' : '#cbd5e1'

  const worldG = cloned.querySelector('.mx-world')
  if (worldG) {
    worldG.setAttribute('transform', 'translate(0, 0) scale(1)')
  }

  // 插入背景矩形
  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bgRect.setAttribute('x', String(b.minX))
  bgRect.setAttribute('y', String(b.minY))
  bgRect.setAttribute('width', String(width))
  bgRect.setAttribute('height', String(height))
  bgRect.setAttribute('fill', bgFill)
  cloned.insertBefore(bgRect, cloned.firstChild)

  let raw = new XMLSerializer().serializeToString(cloned)
  raw = raw
    .replace(/var\(--mx-node-fill\)/g, nodeFill)
    .replace(/var\(--mx-label-fg\)/g, labelFg)
    .replace(/var\(--mx-pill-bg\)/g, nodeFill)
    .replace(/var\(--mx-pill-border\)/g, pillBorder)
    .replace(/var\(--mx-pill-fg\)/g, labelFg)
  return { svgText: raw, width, height }
}

function exportSvgDiagram(baseName = 'economy-diagram'): void {
  const built = buildCleanDiagramSvg()
  if (!built) return
  const blob = new Blob([built.svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${baseName}.svg`
  a.click()
  URL.revokeObjectURL(url)
}

function exportPngDiagram(baseName = 'economy-diagram'): void {
  const built = buildCleanDiagramSvg()
  if (!built) return
  const svgBlob = new Blob([built.svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(svgBlob)
  const img = new Image()
  img.onload = () => {
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = built.width * scale
    canvas.height = built.height * scale
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, built.width, built.height)
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        const pngUrl = URL.createObjectURL(pngBlob)
        const a = document.createElement('a')
        a.href = pngUrl
        a.download = `${baseName}.png`
        a.click()
        URL.revokeObjectURL(pngUrl)
      }, 'image/png')
    }
    URL.revokeObjectURL(url)
  }
  img.src = url
}

defineExpose({
  fitView,
  fitToScreen: fitView,
  exportSvgDiagram,
  exportPngDiagram
})
</script>

<style scoped>
.mx-canvas {
  /* 默认跟随宿主应用主题 (--graph-viewport-bg / --bg-panel / --text) */
  --mx-canvas-bg: var(--graph-viewport-bg, #181a1d);
  --mx-grid-color: var(--wash-16, rgba(148, 163, 184, 0.22));
  --mx-node-fill: var(--bg-elevated);
  --mx-label-fg: var(--text, #e8eaed);
  --mx-sub-bg: var(--bg-elevated);
  --mx-sub-fg: var(--text-muted, #9aa0a6);
  --mx-pill-bg: var(--bg-elevated);
  --mx-pill-border: var(--border);
  --mx-pill-fg: var(--text, #e8eaed);

  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--mx-canvas-bg);
  outline: none;
  overflow: hidden;
}

/* 经典 Machinations 浅色纸张模式 */
.mx-canvas.theme-light {
  --mx-canvas-bg: #f8f9fb;
  --mx-grid-color: #cbd5e1;
  --mx-node-fill: #ffffff;
  --mx-label-fg: #1e293b;
  --mx-sub-bg: #e2e8f0;
  --mx-sub-fg: #475569;
  --mx-pill-bg: #ffffff;
  --mx-pill-border: #cbd5e1;
  --mx-pill-fg: #334155;
}

/* 深色蓝图模式 */
.mx-canvas.theme-dark {
  --mx-canvas-bg: #13161c;
  --mx-grid-color: rgba(148, 163, 184, 0.16);
  --mx-node-fill: #1e232d;
  --mx-label-fg: #e2e8f0;
  --mx-sub-bg: #262c38;
  --mx-sub-fg: #94a3b8;
  --mx-pill-bg: #1e232d;
  --mx-pill-border: #334155;
  --mx-pill-fg: #e2e8f0;
}

.mx-canvas.panning {
  cursor: grabbing;
}
.mx-canvas.placing,
.mx-canvas.connecting {
  cursor: crosshair;
}
.mx-svg {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}
.mx-grid-dot {
  fill: var(--mx-grid-color);
}

.mx-align-guide {
  stroke: var(--accent, #3d8bfd);
  stroke-width: 1.2;
  stroke-dasharray: 4 3;
  pointer-events: none;
}

.mx-edge {
  cursor: pointer;
}
.mx-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
}
.mx-edge-pill-bg {
  fill: var(--mx-pill-bg);
  stroke: var(--mx-pill-border);
  stroke-width: 1.2;
  transition:
    stroke 0.12s,
    transform 0.12s;
}
.mx-edge-pill-bg.is-state {
  stroke: color-mix(in srgb, #38bdf8 55%, var(--mx-pill-border));
}
.mx-edge-pill-bg.is-selected,
.mx-edge-pill-bg.is-drop {
  fill: color-mix(in srgb, var(--accent, #3d8bfd) 18%, var(--mx-pill-bg));
  stroke: var(--accent, #3d8bfd);
  stroke-width: 1.8;
}
.mx-edge-label {
  font-size: 10.5px;
  font-family: var(--mono, ui-monospace, monospace);
  fill: var(--mx-pill-fg);
  font-weight: 600;
  pointer-events: none;
}
.mx-edge-label.is-state {
  fill: #38bdf8;
}

.mx-bend-handle {
  cursor: ns-resize;
}
.mx-bend-handle circle {
  fill: var(--accent, #3d8bfd);
  stroke: #ffffff;
  stroke-width: 1.5;
}

.mx-node {
  cursor: grab;
}
.mx-node.locked {
  cursor: default;
}
.mx-node.fired path {
  filter: drop-shadow(0 0 6px rgba(61, 139, 253, 0.65));
}
.mx-sel-halo {
  fill: color-mix(in srgb, var(--accent, #3d8bfd) 12%, transparent);
  stroke: var(--accent, #3d8bfd);
  stroke-width: 1.4;
  stroke-dasharray: 4 3;
}
.mx-sel-halo.is-snap {
  fill: rgba(56, 189, 248, 0.22);
  stroke: #38bdf8;
  stroke-width: 2.2;
  stroke-dasharray: none;
}

.mx-node-value {
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
}
.mx-node-glyph {
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
}
.mx-node-pull-badge {
  font-size: 8.5px;
  font-family: var(--mono, ui-monospace, monospace);
  font-weight: 700;
  pointer-events: none;
}
.mx-node-star {
  font-size: 13px;
  font-weight: 800;
  pointer-events: none;
}
.mx-node-label {
  font-size: 11px;
  font-weight: 600;
  fill: var(--mx-label-fg);
  cursor: text;
}
.mx-reg-step-btn {
  cursor: pointer;
}
.mx-reg-step-btn circle {
  fill: var(--mx-node-fill);
  stroke: #a855f7;
  stroke-width: 1.5;
  transition:
    fill 0.12s,
    stroke-width 0.12s;
}
.mx-reg-step-btn text {
  fill: #a855f7;
  pointer-events: none;
}
.mx-reg-step-btn:hover circle {
  fill: #a855f7;
}
.mx-reg-step-btn:hover text {
  fill: #ffffff;
}
.mx-tool-divider {
  width: 22px;
  height: 1px;
  background: var(--border);
  margin: 2px auto;
}
.mx-node-label.sel {
  fill: #ffffff;
  paint-order: stroke;
  stroke: var(--accent, #3d8bfd);
  stroke-width: 7px;
  stroke-linejoin: round;
}
.mx-node-sub-pill {
  fill: var(--mx-sub-bg);
  stroke: var(--mx-pill-border);
  stroke-width: 0.8;
}
.mx-node-sub {
  font-size: 9px;
  fill: var(--mx-sub-fg);
  font-family: var(--mono, ui-monospace, monospace);
  pointer-events: none;
}
.mx-note-rect {
  fill: color-mix(in srgb, #facc15 18%, var(--mx-node-fill));
  stroke: #eab308;
  stroke-width: 1.4;
}
.mx-note-rect.selected {
  stroke: var(--accent, #3d8bfd);
  stroke-width: 2;
}
.mx-note-text {
  font-size: 11px;
  color: var(--mx-label-fg);
  white-space: pre-wrap;
  overflow: hidden;
  height: 100%;
  line-height: 1.4;
}

/* 悬停四向连线锚点（禁止在带 SVG transform="translate(...)" 的 g 上使用 CSS transform，避免覆盖位移导致闪烁） */
.mx-port-dot {
  cursor: crosshair;
}
.mx-port-dot.is-resource .mx-port-vis {
  fill: var(--accent, #3d8bfd);
  stroke: #ffffff;
  stroke-width: 1.5;
  transition:
    stroke-width 0.12s,
    filter 0.12s;
}
.mx-port-dot.is-state .mx-port-vis {
  fill: #0284c7;
  stroke: #ffffff;
  stroke-width: 1.5;
  transition:
    stroke-width 0.12s,
    filter 0.12s;
}
.mx-port-dot:hover .mx-port-vis {
  stroke-width: 2.4;
  filter: drop-shadow(0 0 5px var(--accent, #3d8bfd));
}

.mx-marquee {
  fill: var(--accent-12, rgba(61, 139, 253, 0.12));
  stroke: var(--accent, #3d8bfd);
  stroke-dasharray: 4 3;
}

/* 左上工具栏与右上视图栏（完全适配暗色/亮色主题） */
.mx-toolbar {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 4px;
  padding: 5px 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 4px 14px var(--shadow, rgba(0, 0, 0, 0.35));
}
.mx-tool {
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s;
}
.mx-tool-svg {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: block;
}
.mx-tool:hover {
  background: var(--bg-hover);
  border-color: var(--border);
}
.mx-tool.active {
  background: var(--accent-18, rgba(61, 139, 253, 0.18));
  border-color: var(--accent, #3d8bfd);
  box-shadow: inset 0 0 0 1px var(--accent, #3d8bfd);
}

.mx-viewbar {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 4px 14px var(--shadow, rgba(0, 0, 0, 0.35));
  color: var(--text, #e8eaed);
  font-size: 12px;
}
.mx-viewbar button {
  min-width: 28px;
  height: 28px;
  padding: 0 4px;
  border: none;
  background: transparent;
  border-radius: 5px;
  cursor: pointer;
  color: var(--text, #e8eaed);
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mx-viewbar button:hover:not(:disabled) {
  background: var(--bg-hover);
}
.mx-viewbar button.is-on {
  color: var(--accent, #3d8bfd);
  background: var(--accent-12, rgba(61, 139, 253, 0.12));
}
.mx-viewbar button:disabled {
  opacity: 0.35;
  cursor: default;
}
.mx-viewbar .sep {
  width: 1px;
  height: 16px;
  background: var(--border);
  margin: 0 3px;
}
.mx-viewbar .zoom {
  min-width: 42px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* 选中节点/连线悬浮操作条 */
.mx-node-floatbar {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 18px var(--shadow, rgba(0, 0, 0, 0.4));
  z-index: 12;
  white-space: nowrap;
}
.mx-node-floatbar .sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  margin: 0 2px;
}
.mx-nf-btn {
  height: 22px;
  padding: 0 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text, #e8eaed);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.mx-nf-btn:hover {
  background: var(--bg-hover);
}
.mx-nf-btn.active {
  background: var(--accent-18, rgba(61, 139, 253, 0.18));
  color: var(--accent, #3d8bfd);
}
.mx-nf-btn.is-fire {
  color: #f59e0b;
}
.mx-nf-btn.is-state {
  color: #38bdf8;
}
.mx-nf-btn.is-danger:hover {
  background: rgba(227, 93, 106, 0.18);
  color: var(--danger, #e35d6a);
}
.mx-nf-chip {
  height: 20px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text, #e8eaed);
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 10px;
  cursor: pointer;
}
.mx-nf-chip:hover,
.mx-nf-chip.active {
  border-color: var(--accent, #3d8bfd);
  color: var(--accent, #3d8bfd);
}

/* 快速新建并连线弹出面板 & 右键菜单 */
.mx-quick-menu,
.mx-ctx-menu {
  position: absolute;
  width: 204px;
  padding: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 28px var(--shadow, rgba(0, 0, 0, 0.45));
  z-index: 30;
  color: var(--text, #e8eaed);
}
.mx-qm-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted, #9aa0a6);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
  padding: 0 2px;
}
.mx-qm-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.mx-qm-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text, #e8eaed);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.mx-qm-item:hover {
  border-color: var(--accent, #3d8bfd);
  background: var(--accent-12, rgba(61, 139, 253, 0.12));
}
.mx-qm-ico {
  font-weight: 800;
  color: var(--accent, #3d8bfd);
  min-width: 16px;
  text-align: center;
}
.mx-ctx-menu hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 6px 0;
}
.mx-ctx-row {
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text, #e8eaed);
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mx-ctx-row:hover {
  background: var(--bg-hover);
}
.mx-ctx-row.is-danger {
  color: var(--danger, #e35d6a);
}

.mx-edge-input {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 148px;
  padding: 4px 10px;
  border: 1.5px solid var(--accent, #3d8bfd);
  border-radius: 12px;
  font-size: 12px;
  font-family: var(--mono, ui-monospace, monospace);
  background: var(--bg-panel);
  color: var(--text, #e8eaed);
  box-shadow: 0 4px 14px var(--shadow, rgba(0, 0, 0, 0.4));
  outline: none;
  z-index: 25;
}
.mx-hint {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 14px;
  background: var(--panel-glass, rgba(28, 30, 33, 0.92));
  border: 1px solid var(--border);
  color: var(--text, #e8eaed);
  border-radius: 999px;
  font-size: 11px;
  pointer-events: none;
}

/* 子系统分组框 (Subsystem Group Frames) */
.mx-group {
  cursor: move;
}
.mx-group-bg {
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}
.mx-group-title {
  font-size: 11.5px;
  font-weight: 700;
  fill: var(--mx-label-fg);
  cursor: text;
}
.mx-group-del {
  cursor: pointer;
}
.mx-group-del text {
  fill: var(--text-muted, #9aa0a6);
}
.mx-group-del:hover text {
  fill: #ef4444;
}
.mx-group-resize {
  cursor: nwse-resize;
}

/* 搜索与快速定位浮窗 (Search & Locate) */
.mx-search-pop {
  position: absolute;
  top: 52px;
  right: 12px;
  width: 248px;
  padding: 8px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 10px 26px var(--shadow, rgba(0, 0, 0, 0.4));
  z-index: 28;
}
.mx-search-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mx-search-input {
  flex: 1;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text, #e8eaed);
  font-size: 11.5px;
  outline: none;
}
.mx-search-input:focus {
  border-color: var(--accent, #3d8bfd);
}
.mx-search-close {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted, #9aa0a6);
  cursor: pointer;
}
.mx-search-list {
  margin-top: 6px;
  max-height: 196px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mx-search-item {
  width: 100%;
  padding: 5px 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text, #e8eaed);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  text-align: left;
}
.mx-search-item:hover {
  background: var(--bg-hover);
}
.mx-search-tag {
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--accent, #3d8bfd);
  font-size: 9px;
  font-weight: 800;
  font-family: var(--mono, ui-monospace, monospace);
}
.mx-search-lbl {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.mx-search-sub {
  font-size: 9.5px;
  color: var(--text-muted, #9aa0a6);
  font-family: var(--mono, ui-monospace, monospace);
}

/* 右下鸟瞰小地图 (Interactive Minimap) */
.mx-minimap-dock {
  position: absolute;
  right: 12px;
  bottom: 12px;
  width: 158px;
  background: var(--panel-glass, rgba(28, 30, 33, 0.92));
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 6px 18px var(--shadow, rgba(0, 0, 0, 0.32));
  overflow: hidden;
  z-index: 15;
}
.mx-minimap-dock.is-collapsed {
  width: auto;
}
.mx-minimap-toggle {
  width: 100%;
  height: 22px;
  padding: 0 8px;
  border: none;
  background: var(--bg-elevated);
  color: var(--text-muted, #9aa0a6);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mx-minimap-svg {
  width: 158px;
  height: 92px;
  display: block;
  cursor: crosshair;
}

/* 多选对齐与等距排版工具栏 */
.mx-multiselect-bar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  background: var(--panel-glass, rgba(28, 30, 33, 0.94));
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: 0 8px 24px var(--shadow, rgba(0, 0, 0, 0.35));
  z-index: 20;
}
.mx-ms-count {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent, #3d8bfd);
  padding: 0 4px;
}
.mx-bottleneck-badge {
  pointer-events: none;
}
</style>
