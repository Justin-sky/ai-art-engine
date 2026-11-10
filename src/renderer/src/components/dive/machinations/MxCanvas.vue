<template>
  <div
    ref="rootRef"
    class="mx-canvas"
    :class="[
      `theme-${store.canvasTheme.value}`,
      `is-${resolvedCanvasTheme}`,
      { panning: !!panState, connecting: !!connectDrag || !!reconnectDrag, placing: isNodeTool }
    ]"
    :data-theme="resolvedCanvasTheme"
    tabindex="0"
    @keydown="onKeyDown"
    @click="closeMenus"
  >
    <svg
      ref="svgRef"
      class="mx-svg"
      :class="{ 'is-dragging': isActiveGeometryDrag }"
      @pointerdown="onBgPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onSvgPointerLeave"
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
          <circle
            cx="1.2"
            cy="1.2"
            r="1.15"
            class="mx-grid-dot"
            :opacity="store.snapToGrid.value ? 1 : 0.26"
          />
        </pattern>
        <marker
          v-for="mk in edgeMarkerDefs"
          :id="mk.id"
          :key="mk.id"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,1.2 L10,5 L0,8.8 z" :fill="mk.color" />
        </marker>
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
        <marker
          id="mx-arrow-ref"
          viewBox="0 0 10 10"
          refX="8.5"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,1.2 L10,5 L0,8.8 z" fill="#f59e0b" />
        </marker>
      </defs>

      <rect class="mx-bg" x="0" y="0" width="100%" height="100%" fill="url(#mx-grid)" />

      <g
        class="mx-world"
        :transform="`translate(${store.view.x}, ${store.view.y}) scale(${store.view.zoom})`"
      >
        <!-- ══════════ 子系统分组容器层 (Subsystem Group Frames) ══════════ -->
        <g
          v-for="grp in visibleGroups"
          :key="grp.id"
          class="mx-group"
          :class="{ 'is-locked': isGroupLocked(grp) }"
          :transform="`translate(${groupX(grp)}, ${groupY(grp)})`"
        >
          <rect
            x="0"
            y="0"
            :width="groupW(grp)"
            :height="groupH(grp)"
            rx="10"
            class="mx-group-bg"
            pointer-events="none"
            :style="{
              stroke: grp.color || '#3b82f6',
              fill: `color-mix(in srgb, ${grp.color || '#3b82f6'} 8%, transparent)`
            }"
          />
          <rect
            x="0"
            y="0"
            :width="groupW(grp)"
            height="26"
            rx="10"
            class="mx-group-hdr"
            :style="{
              fill: `color-mix(in srgb, ${grp.color || '#3b82f6'} 22%, var(--mx-node-fill))`
            }"
            @pointerdown.stop="startGroupDrag(grp, $event)"
          />
          <text
            x="12"
            y="17"
            class="mx-group-title"
            @pointerdown.stop="startGroupDrag(grp, $event)"
            @dblclick.stop="startGroupLabelEdit(grp)"
          >
            {{ grp.label }}
          </text>
          <g
            v-if="!isGroupLocked(grp)"
            :transform="`translate(${groupW(grp) - 16}, 13)`"
            class="mx-group-del"
            @pointerdown.stop="store.deleteGroup(grp.id)"
          >
            <circle r="8" fill="transparent" />
            <text text-anchor="middle" y="3.5" font-size="11" font-weight="700">×</text>
          </g>
          <!-- 右下角缩放手柄 -->
          <path
            v-if="!isGroupLocked(grp)"
            :d="`M ${groupW(grp) - 12},${groupH(grp) - 3} L ${groupW(grp) - 3},${groupH(grp) - 12} M ${groupW(grp) - 7},${groupH(grp) - 3} L ${groupW(grp) - 3},${groupH(grp) - 7}`"
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
            'is-dormant': geo.dormant && !isEdgeSelected(geo.edge.id),
            'is-gated-off': geo.gatedOff && !isEdgeSelected(geo.edge.id),
            'is-cond-consumer':
              consumerEdgeHitById.has(geo.edge.id) ||
              directConsumerBridgeEdgeIdSet.has(geo.edge.id),
            'is-reconnecting': reconnectDrag?.edgeId === geo.edge.id,
            'is-drop-target':
              connectDrag?.hoverEdgeId === geo.edge.id || reconnectDrag?.hoverEdgeId === geo.edge.id
          }"
          @pointerenter="hoveredEdgeId = geo.edge.id"
          @pointerleave="hoveredEdgeId = hoveredEdgeId === geo.edge.id ? '' : hoveredEdgeId"
          @pointerdown.stop="onEdgePointerDown(geo.edge.id, $event)"
          @dblclick.stop="startEdgeEdit(geo.edge.id)"
          @contextmenu.prevent.stop="onEdgeContextMenu(geo.edge, $event)"
        >
          <path :d="geo.path" fill="none" class="mx-edge-hit" />
          <path
            v-if="
              consumerEdgeHitById.has(geo.edge.id) || directConsumerBridgeEdgeIdSet.has(geo.edge.id)
            "
            :d="geo.path"
            fill="none"
            class="mx-edge-cond-glow"
          />
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
            :stroke-opacity="geo.dormant && !isEdgeSelected(geo.edge.id) ? 0.35 : 1"
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

          <!-- Instant 瞬时传输连线触发时的零延迟全线闪光脉冲 -->
          <path
            v-if="
              isFlowAnimating &&
              geo.edge.kind === 'resource' &&
              geo.edge.transferMode === 'instant' &&
              (store.displayFlows.value[geo.edge.id] ?? 0) > 0
            "
            :d="geo.path"
            fill="none"
            :stroke="geo.tokenColor"
            stroke-width="3.6"
            stroke-linecap="round"
            :stroke-opacity="Math.max(0.18, (1 - pulseWave) * 0.92)"
          />

          <!-- 激活资源连线的持续流动脉冲虚线流（flow 模式在播放或单步触发动画期间显示） -->
          <path
            v-else-if="
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

          <!-- 60fps 贝塞尔曲线真实飞行资源球 (Animated Flow Tokens · instant 模式跳过飞行直接到达) -->
          <template
            v-if="
              isFlowAnimating &&
              geo.edge.kind === 'resource' &&
              geo.edge.transferMode !== 'instant' &&
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

          <!-- 状态控制边条件满足/触发时的原地闪烁（闪 3 下后静止，不使用资源球/菱形流动） -->
          <g
            v-if="
              isStateFlashActive &&
              store.playStep.value > 0 &&
              geo.edge.kind === 'state' &&
              isStateEdgePulsing(geo.edge)
            "
            :key="`st-flash-${geo.edge.id}-${stateFlashSeq}`"
            class="mx-state-flash-group"
            pointer-events="none"
          >
            <path
              :d="geo.path"
              fill="none"
              :stroke="geo.color"
              stroke-width="6.5"
              stroke-linecap="round"
              class="mx-state-flash-glow"
            />
            <path
              :d="geo.path"
              fill="none"
              stroke="#ffffff"
              stroke-width="2.6"
              stroke-dasharray="6 4"
              stroke-linecap="round"
              class="mx-state-flash-core"
            />
          </g>

          <!-- 连线中点公式胶囊 (Machinations 原生风格胶囊 · 支持 10 | 3 ⧗ 频率分栏与上方标题) -->
          <g
            class="mx-edge-pill"
            :transform="`translate(${geo.mid.x}, ${geo.mid.y})`"
            :style="{ '--edge-c': geo.color }"
          >
            <text
              v-if="geo.caption"
              text-anchor="middle"
              y="-13.5"
              class="mx-edge-caption"
              :class="{ 'is-selected': isEdgeSelected(geo.edge.id) }"
            >
              {{ geo.caption }}
            </text>
            <rect
              v-if="
                isStateFlashActive &&
                store.playStep.value > 0 &&
                geo.edge.kind === 'state' &&
                isStateEdgePulsing(geo.edge)
              "
              :key="`st-pill-flash-${geo.edge.id}-${stateFlashSeq}`"
              :x="-geo.labelW / 2 - 2"
              y="-11.25"
              :width="geo.labelW + 4"
              height="22.5"
              rx="11.25"
              fill="none"
              :stroke="geo.color"
              stroke-width="2"
              class="mx-state-flash-pill"
            />
            <rect
              :x="-geo.labelW / 2"
              y="-9.25"
              :width="geo.labelW"
              height="18.5"
              rx="9.25"
              class="mx-edge-pill-bg"
              :class="{
                'is-selected': isEdgeSelected(geo.edge.id),
                'is-state': geo.edge.kind === 'state',
                'is-compact-fx': geo.isCompactFormula && !isEdgeSelected(geo.edge.id),
                'is-gated-off': geo.gatedOff && !isEdgeSelected(geo.edge.id),
                'is-mod-active': geo.formulaModified && !isEdgeSelected(geo.edge.id),
                'is-cond-highlight':
                  !isEdgeSelected(geo.edge.id) && consumerEdgeHitById.has(geo.edge.id),
                'is-drop':
                  connectDrag?.hoverEdgeId === geo.edge.id ||
                  reconnectDrag?.hoverEdgeId === geo.edge.id
              }"
            />
            <template v-if="geo.intervalText">
              <line
                :x1="geo.dividerX"
                y1="-9"
                :x2="geo.dividerX"
                y2="9"
                class="mx-edge-pill-div"
                :class="{
                  'is-selected': isEdgeSelected(geo.edge.id),
                  'is-cond-highlight':
                    !isEdgeSelected(geo.edge.id) && consumerEdgeHitById.has(geo.edge.id)
                }"
              />
              <text
                class="mx-edge-label"
                :class="{
                  'is-selected': isEdgeSelected(geo.edge.id),
                  'is-compact-fx': geo.isCompactFormula && !isEdgeSelected(geo.edge.id),
                  'is-mod-active': geo.formulaModified && !isEdgeSelected(geo.edge.id),
                  'is-cond-highlight':
                    !isEdgeSelected(geo.edge.id) && consumerEdgeHitById.has(geo.edge.id)
                }"
                text-anchor="middle"
                :x="geo.leftTextX"
                y="3.8"
              >
                {{ geo.rateText }}
              </text>
              <text
                class="mx-edge-label is-iv-num"
                :class="{
                  'is-selected': isEdgeSelected(geo.edge.id),
                  'is-compact-fx': geo.isCompactFormula && !isEdgeSelected(geo.edge.id),
                  'is-mod-active': geo.formulaModified && !isEdgeSelected(geo.edge.id),
                  'is-cond-highlight':
                    !isEdgeSelected(geo.edge.id) && consumerEdgeHitById.has(geo.edge.id)
                }"
                text-anchor="middle"
                :x="geo.rightTextX"
                y="3.7"
              >
                {{ geo.intervalText }}
              </text>
              <g
                :transform="`translate(${geo.hourglassX}, 0)`"
                class="mx-edge-hourglass"
                :class="{
                  'is-selected': isEdgeSelected(geo.edge.id),
                  'is-cond-highlight':
                    !isEdgeSelected(geo.edge.id) && consumerEdgeHitById.has(geo.edge.id)
                }"
              >
                <path
                  d="M-2.4,-3.6 H2.4 L0.4,0 L2.4,3.6 H-2.4 L-0.4,0 Z"
                  fill="none"
                  stroke-width="1.1"
                  stroke-linejoin="round"
                />
                <path d="M-1.45,3.05 H1.45 L0,0.95 Z" stroke="none" />
              </g>
            </template>
            <text
              v-else
              class="mx-edge-label"
              :class="{
                'is-selected': isEdgeSelected(geo.edge.id),
                'is-state': geo.edge.kind === 'state',
                'is-compact-fx': geo.isCompactFormula && !isEdgeSelected(geo.edge.id),
                'is-mod-active': geo.formulaModified && !isEdgeSelected(geo.edge.id),
                'is-cond-highlight':
                  !isEdgeSelected(geo.edge.id) && consumerEdgeHitById.has(geo.edge.id)
              }"
              text-anchor="middle"
              y="3.8"
            >
              {{ geo.rateText }}
            </text>
            <title v-if="geo.tooltipText">{{ geo.tooltipText }}</title>
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

          <!-- 选中连线时的可拖拽弧度控制点 (Curvature Handle · 含指向连线的状态边) -->
          <g
            v-if="isEdgeSelected(geo.edge.id)"
            class="mx-bend-handle"
            :transform="`translate(${geo.mid.x}, ${geo.mid.y - (geo.caption ? 26 : 16)})`"
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
            'is-cond-consumer': !isNodeSelected(node.id) && consumerNodeHitById.has(node.id),
            hovered: hoveredNodeId === node.id,
            'is-runtime-interactive': isSimRuntime && node.trigger === 'interactive',
            'drop-target':
              connectDrag?.hoverNodeId === node.id || reconnectDrag?.hoverNodeId === node.id,
            fired: isFlowAnimating && firedIds.has(node.id),
            locked: isLocked(node)
          }"
          :transform="`translate(${nodeX(node)}, ${nodeY(node)})`"
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
            <circle r="32" fill="transparent" class="mx-node-hit-area">
              <title v-if="!store.showNodeLabels.value && node.label">{{ node.label }}</title>
            </circle>

            <!-- 选中/悬停/吸附光环与条件变量引用高亮光环 -->
            <circle
              v-if="
                isNodeSelected(node.id) ||
                connectDrag?.hoverNodeId === node.id ||
                reconnectDrag?.hoverNodeId === node.id
              "
              r="29"
              class="mx-sel-halo"
              :class="{
                'is-snap':
                  connectDrag?.hoverNodeId === node.id || reconnectDrag?.hoverNodeId === node.id
              }"
            />
            <circle
              v-else-if="consumerNodeHitById.has(node.id)"
              r="28"
              fill="none"
              class="mx-cond-consumer-halo"
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
              <!-- 默认模式也在池底显示微缩动态资源球（支持多色 LIFO/混洗栈与 Display Cap） -->
              <template
                v-if="!isLowDetailZoom || node.showAs === 'tokens' || node.showAs === 'both'"
              >
                <circle
                  v-for="(pt, ti) in poolTokenDots(node)"
                  :key="`ptok-${ti}`"
                  :cx="pt.x"
                  :cy="
                    (node.showAs === 'tokens' ? pt.y : pt.y * 0.55 + 8.5) +
                    (isFlowAnimating ? Math.sin(streamPhase * Math.PI * 2 + ti * 1.1) * 1.1 : 0)
                  "
                  :r="node.showAs === 'tokens' || node.showAs === 'both' ? 2.3 : 1.75"
                  :fill="pt.color"
                  :fill-opacity="node.showAs === 'tokens' || node.showAs === 'both' ? 0.95 : 0.62"
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
                (node.kind === 'pool' && poolShowsNumber(node)) ||
                node.kind === 'register' ||
                node.kind === 'delay' ||
                node.kind === 'queue'
              "
              class="mx-node-value"
              text-anchor="middle"
              :y="
                node.kind === 'pool' && node.showAs === 'both' && (node.displayCapacity ?? 25) > 0
                  ? -1
                  : 4
              "
              :fill="isFilled(node) ? '#ffffff' : nodeColor(node)"
            >
              {{ formatValue(nodeValue(node)) }}
            </text>

            <!-- Gate 中心符号 (% / ⚖ / ⚡ / 🎯) -->
            <text
              v-else-if="node.kind === 'gate'"
              class="mx-node-glyph"
              text-anchor="middle"
              y="3.5"
              :fill="nodeColor(node)"
            >
              {{ gateGlyph(node) }}
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

            <!-- Pull Mode 角标 (p& / ps / ps&)，极简模式下隐藏避免新手困惑 -->
            <text
              v-if="
                store.complexityMode.value !== 'simple' &&
                node.pullMode &&
                node.pullMode !== 'pull_any'
              "
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
              @pointerenter="hoveredBadgeTip = { nodeId: node.id, kind: 'delta' }"
              @pointerleave="
                hoveredBadgeTip =
                  hoveredBadgeTip?.nodeId === node.id && hoveredBadgeTip?.kind === 'delta'
                    ? null
                    : hoveredBadgeTip
              "
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
              <title>{{ nodeStepDeltaTip(node) }}</title>
            </g>

            <!-- 瓶颈告警徽标（Converter 饥饿阻塞 / Pool 爆仓 MAX / Pool 枯竭 0!） -->
            <g
              v-if="store.nodeBottlenecks.value[node.id]"
              transform="translate(-22, -20)"
              class="mx-bottleneck-badge"
              @pointerenter="hoveredBadgeTip = { nodeId: node.id, kind: 'bottleneck' }"
              @pointerleave="
                hoveredBadgeTip =
                  hoveredBadgeTip?.nodeId === node.id && hoveredBadgeTip?.kind === 'bottleneck'
                    ? null
                    : hoveredBadgeTip
              "
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
              <title>{{ nodeBottleneckTip(node) }}</title>
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

            <!-- 节点主标题与副标签（双击主标题直接行内重命名；连线或节点条件引用定位时即使关闭全局节点名也临时高亮显示） -->
            <text
              v-if="
                store.showNodeLabels.value ||
                formulaRefNodeIdSet.has(node.id) ||
                consumerNodeHitById.has(node.id)
              "
              class="mx-node-label"
              text-anchor="middle"
              y="34"
              :class="{
                sel: isNodeSelected(node.id),
                'is-ref':
                  !isNodeSelected(node.id) &&
                  (formulaRefNodeIdSet.has(node.id) || consumerNodeHitById.has(node.id))
              }"
              @dblclick.stop="startNodeLabelEdit(node)"
            >
              {{ node.label }}
            </text>
            <g
              v-if="effectiveNodeSubLabel(node)"
              :transform="
                store.showNodeLabels.value ||
                formulaRefNodeIdSet.has(node.id) ||
                consumerNodeHitById.has(node.id)
                  ? 'translate(0, 47)'
                  : 'translate(0, 34)'
              "
              style="cursor: pointer"
              @dblclick.stop="onNodeSubPillDblClick(node)"
            >
              <rect
                :x="-effectiveSubW(node) / 2"
                y="-8"
                :width="effectiveSubW(node)"
                height="16"
                rx="8"
                class="mx-node-sub-pill"
                :class="{ 'is-cond-highlight': consumerNodeHitById.has(node.id) }"
              />
              <text
                class="mx-node-sub"
                :class="{ 'is-cond-highlight': consumerNodeHitById.has(node.id) }"
                text-anchor="middle"
                y="3"
              >
                {{ effectiveNodeSubLabel(node) }}
              </text>
            </g>

            <!-- ══════════ 四向快捷连线端口 (Hover Connection Ports · 运行时隐藏) ══════════ -->
            <g
              v-if="
                !isSimRuntime &&
                !reconnectDrag &&
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

        <!-- ══════════ 选中连线或节点时的条件/公式引用虚线层 (Formula <-> Node Dashed Links) ══════════ -->
        <g v-if="formulaRefLinks.length > 0" class="mx-formula-ref-layer" pointer-events="none">
          <g v-for="rl in formulaRefLinks" :key="rl.key" class="mx-formula-ref-item">
            <circle
              v-if="rl.haloR > 0"
              :cx="rl.tx"
              :cy="rl.ty"
              :r="rl.haloR"
              fill="none"
              class="mx-formula-ref-halo"
            />
            <path :d="rl.path" fill="none" class="mx-formula-ref-glow" />
            <path
              :d="rl.path"
              fill="none"
              class="mx-formula-ref-line"
              marker-end="url(#mx-arrow-ref)"
            />
            <circle
              :cx="rl.sx"
              :cy="rl.sy"
              r="3"
              fill="#f59e0b"
              stroke="#ffffff"
              stroke-width="1.2"
            />
            <g :transform="`translate(${rl.tagX}, ${rl.tagY})`" class="mx-formula-ref-tag">
              <rect
                :x="-rl.tagW / 2"
                y="-8"
                :width="rl.tagW"
                height="16"
                rx="8"
                class="mx-formula-ref-tag-bg"
              />
              <text text-anchor="middle" y="3.2" class="mx-formula-ref-tag-text">
                {{ rl.token }}
              </text>
            </g>
          </g>
        </g>

        <!-- ══════════ 连线两端可拖拽重连锚点层 (置于节点层上方，确保不被节点热区遮挡) ══════════ -->
        <g v-if="endpointHandleGeos.length > 0" class="mx-edge-endpoints-layer">
          <g v-for="geo in endpointHandleGeos" :key="`ep-${geo.edge.id}`" class="mx-edge-endpoints">
            <g
              :transform="`translate(${geo.sx}, ${geo.sy})`"
              class="mx-edge-endpoint is-source"
              @pointerenter="hoveredEdgeId = geo.edge.id"
              @pointerleave="hoveredEdgeId = hoveredEdgeId === geo.edge.id ? '' : hoveredEdgeId"
              @pointerdown.stop="startEdgeEndpointDrag(geo, 'from', $event)"
            >
              <circle r="9.5" fill="transparent" class="mx-ep-hit" />
              <circle
                r="4.5"
                fill="#ffffff"
                :stroke="geo.color"
                stroke-width="2"
                class="mx-ep-vis"
              />
              <title>{{ t('mx.canvas.dragEdgeSourceTip') }}</title>
            </g>
            <g
              :transform="`translate(${geo.ex}, ${geo.ey})`"
              class="mx-edge-endpoint is-target"
              @pointerenter="hoveredEdgeId = geo.edge.id"
              @pointerleave="hoveredEdgeId = hoveredEdgeId === geo.edge.id ? '' : hoveredEdgeId"
              @pointerdown.stop="startEdgeEndpointDrag(geo, 'to', $event)"
            >
              <circle r="9.5" fill="transparent" class="mx-ep-hit" />
              <circle
                r="4.8"
                :fill="geo.color"
                stroke="#ffffff"
                stroke-width="1.8"
                class="mx-ep-vis"
              />
              <title>{{ t('mx.canvas.dragEdgeTargetTip') }}</title>
            </g>
          </g>
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

        <!-- ══════════ 拖拽连线端点重连实时预览 ══════════ -->
        <g
          v-if="reconnectPreview"
          class="mx-connect-preview mx-reconnect-preview"
          pointer-events="none"
        >
          <circle
            :cx="reconnectPreview.fromX"
            :cy="reconnectPreview.fromY"
            r="4.2"
            fill="#ffffff"
            :stroke="reconnectPreview.kind === 'state' ? '#38bdf8' : '#3d8bfd'"
            stroke-width="2"
          />
          <path
            :d="reconnectPreview.path"
            fill="none"
            :stroke="reconnectPreview.kind === 'state' ? '#38bdf8' : '#3d8bfd'"
            stroke-width="2.4"
            :stroke-dasharray="reconnectPreview.kind === 'state' ? '6 4' : undefined"
            :marker-end="
              reconnectPreview.kind === 'state' ? 'url(#mx-arrow-state)' : 'url(#mx-arrow-sel)'
            "
          />
          <circle
            :cx="reconnectPreview.toX"
            :cy="reconnectPreview.toY"
            r="4.5"
            :fill="reconnectPreview.kind === 'state' ? '#38bdf8' : '#3d8bfd'"
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
        v-for="tb in visibleToolButtons"
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
        :aria-pressed="store.snapToGrid.value"
        :title="`${t('mx.canvas.snapGrid')} (${store.snapToGrid.value ? 'ON' : 'OFF'})`"
        @click="store.snapToGrid.value = !store.snapToGrid.value"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            :opacity="store.snapToGrid.value ? 1 : 0.55"
            d="M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11"
          />
          <circle v-if="store.snapToGrid.value" cx="9.8" cy="9.8" r="2.1" fill="currentColor" />
          <path
            v-else
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            d="M2 14L14 2"
          />
        </svg>
      </button>
      <button
        type="button"
        :class="{ 'is-on': store.showNodeLabels.value }"
        :aria-pressed="store.showNodeLabels.value"
        :title="`${t('mx.canvas.showNodeLabels')} (${store.showNodeLabels.value ? 'ON' : 'OFF'})`"
        @click="store.showNodeLabels.value = !store.showNodeLabels.value"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path
            d="M2.2 12.2L5.1 3.8h1.5l2.9 8.4H8.1l-.65-2.1H4.25l-.65 2.1H2.2zm2.45-3.25h2.4L5.85 5.3l-1.2 3.65zM10.5 7.4c0-1.05.85-1.7 2.15-1.7 1.25 0 2.05.6 2.05 1.75v3.3c0 .55.05 1.05.15 1.45h-1.25l-.1-.75c-.4.55-1.05.85-1.8.85-1.05 0-1.8-.65-1.8-1.6 0-1.05.85-1.6 2.3-1.75l1.25-.12v-.38c0-.5-.35-.8-.95-.8-.55 0-.88.25-.98.65l-1.02-.2zm3 1.75l-1.05.12c-.75.08-1.12.35-1.12.82 0 .42.35.68.88.68.75 0 1.29-.52 1.29-1.25v-.37z"
            fill="currentColor"
            :opacity="store.showNodeLabels.value ? 1 : 0.55"
          />
          <path
            v-if="!store.showNodeLabels.value"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            d="M2 14L14 2"
          />
        </svg>
      </button>
      <button
        type="button"
        :class="{ 'is-on': store.compactEdgeFormulas.value }"
        :aria-pressed="store.compactEdgeFormulas.value"
        :title="`${t('mx.canvas.compactEdgeFormulas')} (${store.compactEdgeFormulas.value ? t('mx.canvas.modeCompact') : t('mx.canvas.modeFull')})`"
        @click="store.compactEdgeFormulas.value = !store.compactEdgeFormulas.value"
      >
        <span class="mx-fx-toggle-glyph" aria-hidden="true">ƒx</span>
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
      <span class="sep" />
      <button
        type="button"
        :class="{ 'is-on': isMxCanvasFullscreenFocus }"
        :aria-pressed="isMxCanvasFullscreenFocus"
        :title="
          isMxCanvasFullscreenFocus
            ? t('mx.canvas.exitFullscreenFocus')
            : t('mx.canvas.fullscreenFocus')
        "
        @click="toggleMxCanvasFullscreen"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
          <path
            v-if="!isMxCanvasFullscreenFocus"
            d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
            stroke="currentColor"
            stroke-width="1.45"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            v-else
            d="M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M2.5 10H6v3.5"
            stroke="currentColor"
            stroke-width="1.45"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
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
      v-if="selectedSingleNode && !isActiveGeometryDrag && !edgeEdit && !quickConnectMenu"
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
      <button
        v-if="hasMxNodeSimpleMacros(selectedSingleNode)"
        type="button"
        class="mx-nf-btn"
        :title="expandMacroFloatTip"
        @click="store.expandNodeSimpleMacros(selectedSingleNode.id)"
      >
        📐
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
      v-if="selectedSingleEdgeGeo && !isActiveGeometryDrag && !edgeEdit"
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
          v-for="qk in visibleQuickSpawnKinds"
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
            v-for="qk in visibleQuickSpawnKinds"
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
            () => {
              onAutoLayout()
              closeMenus()
            }
          "
        >
          ✨ {{ t('mx.canvas.autoLayout') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            () => {
              store.pasteNodes()
              closeMenus()
            }
          "
        >
          📋 {{ t('mx.canvas.paste') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            () => {
              fitView()
              closeMenus()
            }
          "
        >
          ⤢ {{ t('mx.view.fit') }}
        </button>
      </template>

      <template v-else-if="contextMenu.targetType === 'node'">
        <button
          type="button"
          class="mx-ctx-row"
          @click="(contextMenu.nodeId && store.interact(contextMenu.nodeId), closeMenus())"
        >
          ⚡ {{ t('mx.canvas.fireNodeNow') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="
            () => {
              store.duplicateSelection()
              closeMenus()
            }
          "
        >
          ⧉ {{ t('mx.canvas.duplicate') }}
        </button>
        <hr />
        <button
          type="button"
          class="mx-ctx-row is-danger"
          @click="
            () => {
              store.deleteSelection()
              closeMenus()
            }
          "
        >
          🗑 {{ t('mx.inspector.deleteElement') }}
        </button>
      </template>

      <template v-else-if="contextMenu.targetType === 'edge'">
        <button
          type="button"
          class="mx-ctx-row"
          @click="(contextMenu.edgeId && startEdgeEdit(contextMenu.edgeId), closeMenus())"
        >
          fx {{ t('mx.inspector.formula') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="(contextMenu.edgeId && store.toggleEdgeKind(contextMenu.edgeId), closeMenus())"
        >
          ──/╌╌ {{ t('mx.inspector.edgeKind') }}
        </button>
        <button
          type="button"
          class="mx-ctx-row"
          @click="(contextMenu.edgeId && store.reverseEdge(contextMenu.edgeId), closeMenus())"
        >
          ⇄ {{ t('mx.canvas.reverseEdge') }}
        </button>
        <hr />
        <button
          type="button"
          class="mx-ctx-row is-danger"
          @click="
            () => {
              store.deleteSelection()
              closeMenus()
            }
          "
        >
          🗑 {{ t('mx.inspector.deleteElement') }}
        </button>
      </template>
    </div>

    <!-- 连线公式行内输入框 + 实时变量来源与快捷插入浮层 -->
    <div
      v-if="edgeEdit"
      class="mx-edge-edit-wrap"
      :style="{ left: `${edgeEdit.sx}px`, top: `${edgeEdit.sy}px` }"
      @pointerdown.stop
      @click.stop
    >
      <div class="mx-edge-edit-bar">
        <input
          ref="edgeInputRef"
          v-model="edgeEdit.value"
          class="mx-edge-formula-input"
          @keydown.enter.prevent="commitEdgeEdit"
          @keydown.esc.prevent="edgeEdit = null"
          @blur="commitEdgeEdit"
        />
        <span
          v-if="edgeEditInspection?.previewText"
          class="mx-edge-edit-preview"
          :class="{ 'is-dice': edgeEditInspection.isStochastic }"
        >
          {{ edgeEditInspection.previewText }}
        </span>
      </div>
      <div
        v-if="
          edgeEditInspection &&
          (edgeEditInspection.referencedSymbols.length || edgeEditQuickCatalog.length)
        "
        class="mx-edge-edit-pop"
        @mousedown.prevent
      >
        <div v-if="edgeEditInspection.referencedSymbols.length" class="mx-edge-edit-syms">
          <span
            v-for="sym in edgeEditInspection.referencedSymbols"
            :key="sym.token"
            class="mx-edge-sym-tag"
            :class="`src-${sym.source}`"
          >
            <b>{{ edgeEditSourceTag(sym) }}</b>
            <span>{{ sym.token }}</span>
            <em v-if="sym.valueText !== undefined">={{ sym.valueText }}</em>
            <button
              v-if="sym.source === 'unknown'"
              type="button"
              class="mx-edge-sym-add"
              @mousedown.prevent="promoteCanvasUnknownParam(sym.token)"
            >
              {{ t('mx.formulaEditor.createAsParam') }}
            </button>
          </span>
        </div>
        <div v-if="edgeEditQuickCatalog.length" class="mx-edge-edit-chips">
          <button
            v-for="item in edgeEditQuickCatalog"
            :key="item.key"
            type="button"
            class="mx-edge-qchip"
            :title="item.subtitle ?? item.title"
            @mousedown.prevent="insertCanvasEdgeToken(item.insertText)"
          >
            <span class="mx-edge-qbadge">{{ edgeEditCatalogBadge(item) }}</span>
            <span>{{ item.title }}</span>
            <em v-if="item.valueText !== undefined">={{ item.valueText }}</em>
          </button>
        </div>
      </div>
    </div>

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

    <!-- ══════════ 节点右上角单步变化量 / 左上角瓶颈徽章即时悬停提示气泡 ══════════ -->
    <div
      v-if="activeBadgeTooltip"
      class="mx-badge-hover-tip"
      :class="`tone-${activeBadgeTooltip.tone}`"
      :style="{ left: activeBadgeTooltip.left, top: activeBadgeTooltip.top }"
    >
      <div class="mx-bht-title">{{ activeBadgeTooltip.title }}</div>
      <div class="mx-bht-detail">{{ activeBadgeTooltip.detail }}</div>
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
          v-for="g in visibleGroups"
          :key="'mg-' + g.id"
          :x="groupX(g)"
          :y="groupY(g)"
          :width="groupW(g)"
          :height="groupH(g)"
          rx="8"
          :fill="g.color || '#3b82f6'"
          fill-opacity="0.14"
          :stroke="g.color || '#3b82f6'"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-for="me in minimapEdges"
          :key="'me-' + me.id"
          :d="me.path"
          fill="none"
          :stroke="me.stroke"
          :stroke-width="me.strokeWidth"
          :stroke-opacity="me.opacity"
          :stroke-dasharray="me.dasharray"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
        <circle
          v-for="me in minimapEdgeTargetDots"
          :key="'met-' + me.id"
          :cx="me.tx"
          :cy="me.ty"
          :r="minimapBounds.junctionR"
          :fill="me.stroke"
          :fill-opacity="me.opacity"
        />
        <template v-for="n in visibleNodes" :key="'mn-' + n.id">
          <rect
            v-if="n.kind === 'note'"
            :x="nodeX(n) - (n.width ?? 160) / 2"
            :y="nodeY(n) - (n.height ?? 80) / 2"
            :width="n.width ?? 160"
            :height="n.height ?? 80"
            rx="4"
            fill="#eab308"
            fill-opacity="0.22"
            stroke="#eab308"
            stroke-width="0.9"
            vector-effect="non-scaling-stroke"
          />
          <path
            v-else
            :d="shapePath(n.kind, minimapBounds.nodeR)"
            :transform="`translate(${nodeX(n)}, ${nodeY(n)})`"
            :fill="nodeColor(n)"
            :stroke="
              isNodeSelected(n.id) ? '#3d8bfd' : consumerNodeHitById.has(n.id) ? '#f59e0b' : 'none'
            "
            :stroke-width="isNodeSelected(n.id) || consumerNodeHitById.has(n.id) ? 1.8 : 0"
            vector-effect="non-scaling-stroke"
          />
        </template>
        <rect
          :x="minimapBounds.vx"
          :y="minimapBounds.vy"
          :width="minimapBounds.vw"
          :height="minimapBounds.vh"
          fill="rgba(61, 139, 253, 0.12)"
          stroke="#3d8bfd"
          stroke-width="1.5"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>

    <div v-if="hintText" class="mx-hint">{{ hintText }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import {
  computeMxDiagramBounds,
  estimateMxTextWidth,
  evaluateMxEdgeRuntimeGates,
  evaluateMxExpression,
  exportMxDiagramSvg,
  getMxNodeSubPillWidth,
  hasMxNodeSimpleMacros,
  inspectMxFormulaContext,
  isMxBooleanStateExpr,
  mxNodeColor,
  parseMxStateFormula,
  formatMxCompactEdgeFormulas,
  resolveMxEdgeReferencedNodes,
  resolveMxNodeConsumers,
  resolveMxParams,
  type MxEdge,
  type MxEdgeKind,
  type MxFormulaCatalogItem,
  type MxFormulaSymbolRef,
  type MxGroup,
  type MxNode,
  type MxNodeConsumerEdgeHit,
  type MxNodeConsumerNodeHit,
  type MxNodeKind,
  type MxPullMode
} from '@shared/gameAssets'
import { useStudioI18n } from '../../../composables/useStudioI18n'
import { useWorkspaceFullscreen } from '../../../composables/useWorkspaceFullscreen'
import { themePreference } from '../../../editor/preferences'
import { useMxStudioStore, type MxCanvasTheme, type MxDrawer, type MxTool } from './mxStudioStore'

const { t, locale } = useStudioI18n()
const isEn = computed(() => locale.value === 'en-US')
const expandMacroFloatTip = computed(
  () =>
    isEn.value ? 'Expand inline rules to Pro Blueprint nodes' : '将此节点内联规则展开为专业蓝图节点' // cjk-ok
)
const { isWorkspaceFullscreen, enterWorkspaceFullscreen, exitWorkspaceFullscreen } =
  useWorkspaceFullscreen()
const store = useMxStudioStore()

const resolvedCanvasTheme = computed<'light' | 'dark'>(() =>
  store.canvasTheme.value === 'auto' ? themePreference.value : store.canvasTheme.value
)

const rootRef = ref<HTMLDivElement | null>(null)
const svgRef = ref<SVGSVGElement | null>(null)
const edgeInputRef = ref<HTMLInputElement | null>(null)
const nodeInputRef = ref<HTMLInputElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const hoveredNodeId = ref('')
const hoveredEdgeId = ref('')
const searchOpen = ref(false)
const searchQuery = ref('')
const minimapOpen = ref(true)
const mxCanvasFocusActive = ref(false)
let savedMxChromeBeforeFocus: {
  drawer: MxDrawer
  inspectorOpen: boolean
  resultsOpen: boolean
  wasWorkspaceFullscreen: boolean
} | null = null

const isMxCanvasFullscreenFocus = computed(
  () => isWorkspaceFullscreen.value && mxCanvasFocusActive.value
)

function restoreMxChromeAfterFocus(): void {
  if (!savedMxChromeBeforeFocus) return
  const snap = savedMxChromeBeforeFocus
  savedMxChromeBeforeFocus = null
  store.drawer.value = snap.drawer
  store.inspectorOpen.value = snap.inspectorOpen
  store.resultsOpen.value = snap.resultsOpen
}

function toggleMxCanvasFullscreen(): void {
  if (isMxCanvasFullscreenFocus.value) {
    const keepWorkspaceFs = savedMxChromeBeforeFocus?.wasWorkspaceFullscreen ?? false
    mxCanvasFocusActive.value = false
    restoreMxChromeAfterFocus()
    if (!keepWorkspaceFs) {
      exitWorkspaceFullscreen()
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitView())
    })
    return
  }
  savedMxChromeBeforeFocus = {
    drawer: store.drawer.value,
    inspectorOpen: store.inspectorOpen.value,
    resultsOpen: store.resultsOpen.value,
    wasWorkspaceFullscreen: isWorkspaceFullscreen.value
  }
  store.drawer.value = ''
  store.inspectorOpen.value = false
  store.resultsOpen.value = false
  mxCanvasFocusActive.value = true
  enterWorkspaceFullscreen()
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitView())
  })
}

watch(isWorkspaceFullscreen, (fs) => {
  if (!fs && mxCanvasFocusActive.value) {
    mxCanvasFocusActive.value = false
    restoreMxChromeAfterFocus()
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => fitView())
  })
})
const edgeEdit = ref<{ id: string; value: string; sx: number; sy: number } | null>(null)
const nodeEdit = ref<{
  id: string
  isNote: boolean
  isGroup?: boolean
  value: string
  sx: number
  sy: number
} | null>(null)

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

const visibleQuickSpawnKinds = computed(() =>
  store.complexityMode.value === 'simple'
    ? quickSpawnKinds.filter(
        (q) => q.kind === 'pool' || q.kind === 'converter' || q.kind === 'gate'
      )
    : quickSpawnKinds
)

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
  { id: 'converter', shape: 'converter', color: '#8b55f6' },
  { id: 'register', shape: 'register', color: '#a855f7', filled: true, glyph: 'x' },
  { id: 'delay', shape: 'delay', color: '#64748b', glyph: '⏱' },
  { id: 'queue', shape: 'queue', color: '#64748b', glyph: 'Q' },
  { id: 'end', shape: 'end', color: '#6b7280', filled: true },
  { id: 'resource_edge', color: '#3b82f6' },
  { id: 'state_edge', color: '#38bdf8' },
  { id: 'note', shape: 'note', color: '#eab308', filled: false }
]

const SIMPLE_TOOL_ORDER: ReadonlyArray<MxTool> = [
  'pool',
  'converter',
  'gate',
  'resource_edge',
  'state_edge',
  'note'
]

const visibleToolButtons = computed(() => {
  if (store.complexityMode.value !== 'simple') return toolButtons
  return SIMPLE_TOOL_ORDER.map((id) => toolButtons.find((tb) => tb.id === id)).filter(
    (tb): tb is NonNullable<typeof tb> => Boolean(tb)
  )
})

const isNodeTool = computed(() => {
  const tl = store.tool.value
  return tl !== 'select' && tl !== 'resource_edge' && tl !== 'state_edge'
})

const hintText = computed(() => {
  const tl = store.tool.value
  if (connectDrag.value || reconnectDrag.value) return t('mx.canvas.hintConnecting')
  if (tl === 'resource_edge' || tl === 'state_edge') return t('mx.canvas.hintConnect')
  if (isNodeTool.value) return t('mx.canvas.hintPlace')
  return ''
})

// ───────── 拖拽期零克隆瞬态几何层 (Transient Drag Geometry Layer) ─────────
const EMPTY_NODE_POS_MAP: ReadonlyMap<string, { x: number; y: number }> = new Map()
const EMPTY_GROUP_RECT_MAP: ReadonlyMap<
  string,
  { x: number; y: number; width: number; height: number }
> = new Map()
const EMPTY_EDGE_BEND_MAP: ReadonlyMap<string, number> = new Map()

const transientNodePos =
  shallowRef<ReadonlyMap<string, { x: number; y: number }>>(EMPTY_NODE_POS_MAP)
const transientGroupRect =
  shallowRef<ReadonlyMap<string, { x: number; y: number; width: number; height: number }>>(
    EMPTY_GROUP_RECT_MAP
  )
const transientEdgeBend = shallowRef<ReadonlyMap<string, number>>(EMPTY_EDGE_BEND_MAP)

function nodeX(node: MxNode): number {
  return transientNodePos.value.get(node.id)?.x ?? node.x
}

function nodeY(node: MxNode): number {
  return transientNodePos.value.get(node.id)?.y ?? node.y
}

function groupX(grp: MxGroup): number {
  return transientGroupRect.value.get(grp.id)?.x ?? grp.x
}

function groupY(grp: MxGroup): number {
  return transientGroupRect.value.get(grp.id)?.y ?? grp.y
}

function groupW(grp: MxGroup): number {
  return transientGroupRect.value.get(grp.id)?.width ?? grp.width
}

function groupH(grp: MxGroup): number {
  return transientGroupRect.value.get(grp.id)?.height ?? grp.height
}

const layerMap = computed(() => {
  void store.topologyRevision.value
  return new Map(store.peekDoc().layers.map((l) => [l.id, l]))
})
const visibleGroups = computed(() =>
  (store.doc.value.groups ?? []).filter((g) => {
    const layer = g.layerId ? layerMap.value.get(g.layerId) : undefined
    return !layer || layer.visible
  })
)
const visibleNodes = computed(() =>
  store.doc.value.nodes.filter((n) => {
    const layer = n.layerId ? layerMap.value.get(n.layerId) : undefined
    return !layer || layer.visible
  })
)
const visibleIds = computed(() => {
  void store.topologyRevision.value
  const lMap = layerMap.value
  const ids = new Set<string>()
  for (const n of store.peekDoc().nodes) {
    const layer = n.layerId ? lMap.get(n.layerId) : undefined
    if (!layer || layer.visible) ids.add(n.id)
  }
  return ids
})
const nodeById = computed(() => new Map(store.doc.value.nodes.map((n) => [n.id, n])))
const selectedNodeSet = computed(() => new Set(store.selection.nodes))
const selectedEdgeSet = computed(() => new Set(store.selection.edges))

// ───────── 千级节点与连线视口剔除 (Viewport Frustum Culling) 与 LOD 降级 ─────────
const isLargeGraph = computed(() => {
  void store.topologyRevision.value
  const d = store.peekDoc()
  return visibleIds.value.size > 200 || d.edges.length > 350
})
const isLowDetailZoom = computed(() => store.view.zoom < 0.48 || visibleIds.value.size > 350)
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
  const refSet = formulaRefNodeIdSet.value
  const consumerNodes = consumerNodeHitById.value
  const tNodes = transientNodePos.value
  return all.filter((n) => {
    const nx = tNodes.get(n.id)?.x ?? n.x
    const ny = tNodes.get(n.id)?.y ?? n.y
    return (
      (nx >= r.minX && nx <= r.maxX && ny >= r.minY && ny <= r.maxY) ||
      tNodes.has(n.id) ||
      sel.has(n.id) ||
      refSet.has(n.id) ||
      consumerNodes.has(n.id) ||
      hoveredNodeId.value === n.id
    )
  })
})
const renderedNodeIds = computed(() => new Set(renderedNodes.value.map((n) => n.id)))

function isLocked(node: MxNode): boolean {
  const layer = node.layerId ? layerMap.value.get(node.layerId) : undefined
  return !!layer?.locked
}

function isGroupLocked(grp: MxGroup): boolean {
  const layer = grp.layerId ? layerMap.value.get(grp.layerId) : undefined
  return !!layer?.locked
}

const firedIds = computed(() => {
  void store.topologyRevision.value
  const set = new Set<string>()
  const flows = store.displayFlows.value
  for (const e of store.peekDoc().edges) {
    if ((flows[e.id] ?? 0) > 0) {
      set.add(e.from)
      set.add(e.to)
    }
  }
  return set
})

const outgoingFiredIds = computed(() => {
  void store.topologyRevision.value
  const set = new Set<string>()
  const flows = store.displayFlows.value
  for (const e of store.peekDoc().edges) {
    if ((flows[e.id] ?? 0) > 0) {
      set.add(e.from)
    }
  }
  return set
})

const resolvedParamsMap = computed(() => {
  void store.topologyRevision.value
  return resolveMxParams(store.peekDoc())
})

const displayVarsMap = computed<Record<string, number>>(() => {
  void store.topologyRevision.value
  const out: Record<string, number> = { ...resolvedParamsMap.value }
  const vals = store.displayValues.value
  for (const n of store.peekDoc().nodes) {
    const v = vals?.[n.id] ?? (n.kind === 'pool' || n.kind === 'register' ? (n.initial ?? 0) : 0)
    out[n.id] = v
    const clean = n.label.trim().replace(/\s+/g, '_')
    if (clean && !(clean in out)) out[clean] = v
  }
  return out
})

function evalStateEdgeCondition(edge: MxEdge): boolean | null {
  const srcNode = nodeById.value.get(edge.from)
  if (srcNode?.kind === 'gate') return null
  const spec = parseMxStateFormula(edge.formula)
  const srcVal =
    store.displayValues.value?.[edge.from] ??
    (srcNode?.kind === 'pool' || srcNode?.kind === 'register' ? (srcNode.initial ?? 0) : 0)

  switch (spec.type) {
    case 'activator':
      switch (spec.op) {
        case '>':
          return srcVal > spec.value
        case '<':
          return srcVal < spec.value
        case '>=':
          return srcVal >= spec.value
        case '<=':
          return srcVal <= spec.value
        case '==':
          return Math.abs(srcVal - spec.value) < 1e-9
        case '!=':
          return Math.abs(srcVal - spec.value) >= 1e-9
      }
      return null
    case 'range':
      return srcVal >= spec.lo && srcVal <= spec.hi
    case 'expr': {
      if (!isMxBooleanStateExpr(spec.expr)) return null
      return (
        evaluateMxExpression(
          spec.expr,
          {
            vars: {
              ...displayVarsMap.value,
              step: store.playStep.value,
              STEP: store.playStep.value,
              t: store.playStep.value,
              a: srcVal,
              self: srcVal
            },
            rng: () => 0.5
          },
          0
        ) !== 0
      )
    }
    default:
      return null
  }
}

const currentStepTriggerEdgeIds = computed<Set<string>>(() => {
  const step = store.playStep.value
  const out = new Set<string>()
  if (step <= 0) return out
  const evs = store.activeRun.value ? store.activeRun.value.events : store.liveEvents.value
  for (const ev of evs) {
    if (ev.step === step && ev.type === 'trigger' && ev.edgeId) {
      out.add(ev.edgeId)
    }
  }
  return out
})

/** 判断状态边在当前步是否真的发射控制信号脉冲（未达条件的状态线、未满足 End 节点其余条件的状态线、未触发的 Gate 分支均保持静默不闪烁） */
function isStateEdgePulsing(edge: MxEdge): boolean {
  const gateSnap = runtimeEdgeGates.value
  // 1. 若该状态边自身处于休眠态（条件未满足）或被上游状态边门控关断，绝不闪烁
  if (gateSnap.dormantStateEdgeIds.has(edge.id) || gateSnap.gatedOffEdgeIds.has(edge.id)) {
    return false
  }

  // 2. 若源节点是 Gate（Trigger Gate / Mixed Gate），仅当引擎在本步实际触发了该条状态分支（产生 trigger 事件）时才闪烁
  const srcNode = nodeById.value.get(edge.from)
  if (srcNode?.kind === 'gate') {
    return currentStepTriggerEdgeIds.value.has(edge.id)
  }

  const cond = evalStateEdgeCondition(edge)
  if (cond !== null) {
    if (!cond) return false
    // 3. 若该条件状态边指向另一条连线（targetEdgeId），仅当被控目标连线未休眠/未被门控关断时才闪烁
    if (edge.targetEdgeId) {
      if (
        gateSnap.dormantStateEdgeIds.has(edge.targetEdgeId) ||
        gateSnap.gatedOffEdgeIds.has(edge.targetEdgeId)
      ) {
        return false
      }
      return true
    }
    const dstNode = nodeById.value.get(edge.to)
    if (!dstNode) return false
    // 4. 若指向 End 终局节点（如 e40: 累计暗伤 <=320 -> 封侯），默认 End 需满足全部入向条件（endMode !== 'any'）：
    //    当其它条件（如官阶 >=16、战功 >=320）尚未达成时，单条 <=320 不应每步都闪烁，仅在 End 全部条件达成时闪烁
    if (dstNode.kind === 'end') {
      if (dstNode.endMode === 'any') return true
      const siblingStateEdges = store
        .peekDoc()
        .edges.filter((se) => se.kind === 'state' && !se.targetEdgeId && se.to === dstNode.id)
      return siblingStateEdges.every(
        (se) => !gateSnap.dormantStateEdgeIds.has(se.id) && !gateSnap.gatedOffEdgeIds.has(se.id)
      )
    }
    // 5. 若指向 Converter / Drain / Trader / Source 等节点，且该节点被其它并联状态边门控关断，或本步并未实际工作（无流量且未触发），则保持静默不每步空闪
    const siblingGated = store
      .peekDoc()
      .edges.some(
        (se) =>
          se.kind === 'state' &&
          !se.targetEdgeId &&
          se.to === dstNode.id &&
          (gateSnap.dormantStateEdgeIds.has(se.id) || gateSnap.gatedOffEdgeIds.has(se.id))
      )
    if (siblingGated) return false
    if (
      dstNode.kind === 'converter' ||
      dstNode.kind === 'trader' ||
      dstNode.kind === 'drain' ||
      dstNode.kind === 'source'
    ) {
      return firedIds.value.has(dstNode.id)
    }
    return true
  }

  const spec = parseMxStateFormula(edge.formula)
  if (spec.type === 'trigger') {
    return currentStepTriggerEdgeIds.value.has(edge.id) || outgoingFiredIds.value.has(edge.from)
  }
  if (spec.type === 'reverse_trigger') {
    return (
      currentStepTriggerEdgeIds.value.has(edge.id) ||
      store.nodeBottlenecks.value[edge.from]?.kind === 'blocked'
    )
  }
  // 数值修正边（如 +0.1、+1、+1/3、=）：源节点本步有实际变化或目标实线有流量时显示脉冲
  const srcVal = store.displayValues.value?.[edge.from] ?? srcNode?.initial ?? 0
  if (Math.abs(srcVal) < 1e-9) return false
  if (edge.targetEdgeId) {
    return (store.displayFlows.value[edge.targetEdgeId] ?? 0) > 0
  }
  const dstNode = nodeById.value.get(edge.to)
  if (dstNode?.kind === 'pool' || dstNode?.kind === 'register') {
    return Math.abs(nodeStepDelta(edge.from)) > 1e-9
  }
  return firedIds.value.has(edge.to) || firedIds.value.has(edge.from)
}

const resourceColorMap = computed(() => {
  void store.topologyRevision.value
  return new Map(store.peekDoc().resources.map((r) => [r.id, r.color]))
})

function nodeColor(node: MxNode): string {
  if (node.color) return node.color
  if ((node.kind === 'pool' || node.kind === 'source') && node.resourceId) {
    const rc = resourceColorMap.value.get(node.resourceId)
    if (rc) return rc
  }
  void store.topologyRevision.value
  return mxNodeColor(store.peekDoc(), node)
}

const converterColorById = computed(() => {
  void store.topologyRevision.value
  const d = store.peekDoc()
  const nMap = new Map(d.nodes.map((n) => [n.id, n]))
  const map = new Map<string, string>()
  for (const e of d.edges) {
    if (e.kind === 'resource' && !map.has(e.from)) {
      const tgt = nMap.get(e.to)
      if (tgt) map.set(e.from, nodeColor(tgt))
    }
  }
  return map
})

const controllingAgentByNodeId = computed(() => {
  void store.topologyRevision.value
  const d = store.peekDoc()
  const map = new Map<string, { id: string; name: string; color?: string }>()
  const activeAgents = (d.agents ?? []).filter((a) => a.enabled)
  if (!activeAgents.length) return map
  const interactiveIds = d.nodes.filter((n) => n.trigger === 'interactive').map((n) => n.id)
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

const hoveredBadgeTip = ref<{
  nodeId: string
  kind: 'delta' | 'bottleneck'
} | null>(null)

function nodeStepDeltaTip(node: MxNode): string {
  const delta = nodeStepDelta(node.id)
  if (delta === 0) return ''
  const cur = store.displayValues.value?.[node.id] ?? 0
  const prev = store.previousStepValues.value?.[node.id] ?? 0
  const step = store.playStep.value
  const sign = delta > 0 ? `+${formatValue(delta)}` : formatValue(delta)
  if (isEn.value) {
    return `Step ${step} Delta: ${sign} (Prev step ${formatValue(prev)} → Current ${formatValue(cur)})`
  }
  return `第 ${step} 步单步变化量：${sign}（上一步 ${formatValue(prev)} → 当前 ${formatValue(cur)}）` // cjk-ok
}

function nodeBottleneckTip(node: MxNode): string {
  const bn = store.nodeBottlenecks.value[node.id]
  if (!bn) return ''
  if (bn.kind === 'blocked') {
    return isEn.value
      ? `Starved / Blocked (${bn.badge}): insufficient input resources to fire`
      : `资源不足阻塞 (${bn.badge})：前置输入不足导致未能触发` // cjk-ok
  }
  if (bn.kind === 'capped') {
    return isEn.value
      ? `Capacity Full (MAX = ${node.capacity ?? 0}): excess inflow will block or overflow`
      : `容量已满 (MAX = ${node.capacity ?? 0})：继续注入将阻塞或溢出` // cjk-ok
  }
  return isEn.value
    ? 'Pool Depleted (0!): resource stock exhausted'
    : '资源池已耗尽 (0!)：存量已归零' // cjk-ok
}

const activeBadgeTooltip = computed<{
  left: string
  top: string
  title: string
  detail: string
  tone: 'pos' | 'neg' | 'warn'
} | null>(() => {
  const hb = hoveredBadgeTip.value
  if (!hb) return null
  const node = nodeById.value.get(hb.nodeId)
  if (!node) return null
  const nx = nodeX(node)
  const ny = nodeY(node)
  if (hb.kind === 'delta') {
    const delta = nodeStepDelta(node.id)
    if (delta === 0) return null
    const cur = store.displayValues.value?.[node.id] ?? 0
    const prev = store.previousStepValues.value?.[node.id] ?? 0
    const step = store.playStep.value
    const sign = delta > 0 ? `+${formatValue(delta)}` : formatValue(delta)
    const sx = (nx + 22) * store.view.zoom + store.view.x
    const sy = (ny - 28) * store.view.zoom + store.view.y
    return {
      left: `${Math.round(sx)}px`,
      top: `${Math.round(Math.max(42, sy))}px`,
      title: isEn.value
        ? `${node.label} · Step ${step} Delta: ${sign}`
        : `${node.label} · 第 ${step} 步变化量：${sign}`, // cjk-ok
      detail: isEn.value
        ? `Previous step: ${formatValue(prev)} → Current step: ${formatValue(cur)}`
        : `上一步数值 ${formatValue(prev)} → 当前步数值 ${formatValue(cur)}`, // cjk-ok
      tone: delta > 0 ? 'pos' : 'neg'
    }
  }
  const bn = store.nodeBottlenecks.value[node.id]
  if (!bn) return null
  const sx = (nx - 22) * store.view.zoom + store.view.x
  const sy = (ny - 28) * store.view.zoom + store.view.y
  return {
    left: `${Math.round(sx)}px`,
    top: `${Math.round(Math.max(42, sy))}px`,
    title:
      bn.kind === 'blocked'
        ? isEn.value
          ? `${node.label} · Starved / Blocked (${bn.badge})`
          : `${node.label} · 资源不足阻塞 (${bn.badge})` // cjk-ok
        : bn.kind === 'capped'
          ? isEn.value
            ? `${node.label} · Capacity Full (MAX = ${node.capacity ?? 0})`
            : `${node.label} · 容量已满 (MAX = ${node.capacity ?? 0})` // cjk-ok
          : isEn.value
            ? `${node.label} · Pool Depleted (0!)`
            : `${node.label} · 资源池已耗尽 (0!)`, // cjk-ok
    detail:
      bn.kind === 'blocked'
        ? isEn.value
          ? 'Upstream inputs were insufficient when this node tried to fire.'
          : '该节点尝试触发时上游输入资源不足。' // cjk-ok
        : bn.kind === 'capped'
          ? isEn.value
            ? 'Pool has reached its capacity ceiling.'
            : '该资源池已达到容量上限。' // cjk-ok
          : isEn.value
            ? 'Pool stock dropped from positive initial value to 0.'
            : '该资源池存量已从初始正值耗尽归零。', // cjk-ok
    tone: 'warn'
  }
})

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

const triggerGateSet = computed(() => {
  void store.topologyRevision.value
  const d = store.peekDoc()
  const resOut = new Set<string>()
  const stOut = new Set<string>()
  for (const e of d.edges) {
    if (e.kind === 'resource') resOut.add(e.from)
    else stOut.add(e.from)
  }
  const tg = new Set<string>()
  for (const n of d.nodes) {
    if (n.kind === 'gate' && !resOut.has(n.id) && stOut.has(n.id)) tg.add(n.id)
  }
  return tg
})

const MX_COND_GATE_OUT_RE = /^(?:>=|<=|==|!=|<>|>|<|=|-?\d+(?:\.\d+)?\s*\.\.\s*-?\d+(?:\.\d+)?$)/

const conditionalGateSet = computed(() => {
  void store.topologyRevision.value
  const d = store.peekDoc()
  const cg = new Set<string>()
  for (const n of d.nodes) {
    if (n.kind === 'gate' && n.formula?.trim()) cg.add(n.id)
  }
  for (const e of d.edges) {
    const s = e.formula.replace(/\s*(?:\||every\b).*$/i, '').trim()
    if (MX_COND_GATE_OUT_RE.test(s)) cg.add(e.from)
  }
  return cg
})

function gateGlyph(node: MxNode): string {
  if (triggerGateSet.value.has(node.id)) {
    return node.gateMode === 'deterministic'
      ? '⚖⚡'
      : conditionalGateSet.value.has(node.id)
        ? '🎲⚡'
        : '⚡'
  }
  if (node.gateMode === 'skill') return '🎯'
  if (node.gateMode === 'deterministic') return '⚖'
  if (conditionalGateSet.value.has(node.id)) return '🎲'
  return '%'
}

function tokenDots(count: number): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  const cols = Math.min(5, Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / cols)
  const sp = count > 16 ? 4.2 : 5.2
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

function poolShowsNumber(node: MxNode): boolean {
  const rawDispCap = node.displayCapacity ?? 25
  if (rawDispCap <= 0) return true
  if (node.showAs !== 'tokens') return true
  return nodeValue(node) > rawDispCap
}

function poolTokenDots(node: MxNode): Array<{ x: number; y: number; color: string }> {
  const rawDispCap = node.displayCapacity ?? 25
  if (rawDispCap <= 0) return []
  const val = nodeValue(node)
  if (node.showAs === 'tokens' && val > rawDispCap) return []
  const maxCap =
    node.showAs === 'tokens' || node.showAs === 'both'
      ? Math.max(1, Math.min(49, rawDispCap))
      : Math.min(12, rawDispCap)
  const count = Math.min(maxCap, Math.max(0, Math.floor(val)))
  if (count <= 0) return []
  const coords = tokenDots(count)
  const fallback = nodeColor(node)
  const stack = store.displayPoolTokens.value?.[node.id]
  if (!stack || !stack.length) {
    return coords.map((pt) => ({ x: pt.x, y: pt.y, color: fallback }))
  }
  const colors: string[] = []
  for (const seg of stack) {
    const segCount = Math.max(0, Math.round(seg.count))
    const segColor = resourceColorMap.value.get(seg.resId) ?? fallback
    for (let k = 0; k < segCount && colors.length < count; k++) {
      colors.push(segColor)
    }
    if (colors.length >= count) break
  }
  return coords.map((pt, idx) => ({
    x: pt.x,
    y: pt.y,
    color: colors[idx] ?? fallback
  }))
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

/** 运行时态（正在播放、单步/交互运行中未重置、或步进飞行动画窗口内）：隐藏节点悬停连线端口，避免遮挡与误触拖线 */
const isSimRuntime = computed(
  () => store.playing.value || store.liveState.value !== null || isFlowAnimating.value
)

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
  if (!isFlowAnimating.value || geo.edge.transferMode === 'instant') return []
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
    if (!hasActiveFlow) {
      rafId = null
      return
    }
    const speed = Math.max(0.25, store.peekDoc().settings.speed || 1)
    const burstDur = Math.max(180, 480 / speed)
    const cycleDur = Math.max(450, 1350 / speed)
    if (now < burstStartMs) burstStartMs = now
    burstProgress.value = Math.max(0, Math.min(1, (now - burstStartMs) / burstDur))
    streamPhase.value = Math.max(0, Math.min(1, (now % cycleDur) / cycleDur))
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

const stateFlashSeq = ref(0)
const isStateFlashActive = ref(false)
let stateFlashTimer: ReturnType<typeof setTimeout> | null = null

function triggerStateEdgeFlash(): void {
  stateFlashSeq.value++
  isStateFlashActive.value = true
  if (stateFlashTimer) clearTimeout(stateFlashTimer)
  stateFlashTimer = setTimeout(() => {
    if (!store.playing.value) {
      isStateFlashActive.value = false
    }
  }, 720)
}

watch(
  () => store.playStep.value,
  (nextStep, prevStep) => {
    // 正在播放或手动单步前进（Step +1 / 点击交互节点）时触发一次资源球飞行与状态线原地闪烁；若重置到 0 则静止
    if (nextStep > 0 && (store.playing.value || Math.abs(nextStep - (prevStep ?? 0)) === 1)) {
      burstStartMs = performance.now()
      burstProgress.value = 0
      startAnimLoop()
      triggerStateEdgeFlash()
    } else if (!store.playing.value) {
      burstProgress.value = 1
      if (nextStep <= 0) {
        if (stateFlashTimer) clearTimeout(stateFlashTimer)
        isStateFlashActive.value = false
        stateFlashSeq.value = 0
      }
    }
  }
)

watch(
  () => store.playing.value,
  (isPlaying) => {
    if (isPlaying) {
      startAnimLoop()
      return
    }
    // 播放结束或暂停的瞬间，立即停止连线上的持续流动动画；若最后一帧有状态触发则播完 3 下闪烁后收起
    burstProgress.value = 1
    if (isStateFlashActive.value) {
      if (stateFlashTimer) clearTimeout(stateFlashTimer)
      stateFlashTimer = setTimeout(() => {
        isStateFlashActive.value = false
      }, 720)
    }
  }
)

watch(isSimRuntime, (running) => {
  if (running) {
    connectDrag.value = null
    reconnectDrag.value = null
  }
})

function compactMacroRateText(raw: string): string {
  const s = raw.trim()
  const m =
    /^if\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|==|!=|<>|<|>)\s*(-?\d+(?:\.\d+)?)\s*,\s*(.+)\s*,\s*0\s*\)(?:\|(.+))?$/.exec(
      s
    )
  if (m) {
    const [, condId, op, val, rate, iv] = m
    const core = iv?.trim() ? `${rate!.trim()}|${iv.trim()}` : rate!.trim()
    return `${core} (${condId}${op}${val})`
  }
  return s.length > 22 ? `${s.slice(0, 21)}…` : s
}

function formatNodeMacroBadges(node: MxNode): string {
  const parts: string[] = []
  if (node.kind === 'pool') {
    if (node.autoInflow?.trim()) parts.push(`+${compactMacroRateText(node.autoInflow)}`)
    if (node.autoOutflow?.trim()) parts.push(`-${compactMacroRateText(node.autoOutflow)}`)
    if (node.cooldownSteps && node.cooldownSteps > 0) parts.push(`⏱${node.cooldownSteps}`)
    if (node.endWhen?.trim()) parts.push(`🏁${node.endWhen.trim()}`)
  } else if (node.kind === 'register') {
    if (node.endWhen?.trim()) parts.push(`🏁${node.endWhen.trim()}`)
  } else if (node.kind === 'converter' || node.kind === 'trader') {
    if (node.autoInflow?.trim()) parts.push(`+${compactMacroRateText(node.autoInflow)}`)
    if (node.autoOutflow?.trim()) parts.push(`-${compactMacroRateText(node.autoOutflow)}`)
    if (node.cooldownSteps && node.cooldownSteps > 0) parts.push(`⏱${node.cooldownSteps}`)
  } else if (node.kind === 'gate') {
    if (node.autoInflow?.trim()) parts.push(`+${compactMacroRateText(node.autoInflow)}`)
    if (node.pityEnabled) {
      parts.push(`🎯${node.pitySoftStart ?? 50}/${node.pityHardMax ?? 80}`)
    }
  }
  return parts.join(' · ')
}

function nodeSubLabel(node: MxNode): string {
  const macroBadge = formatNodeMacroBadges(node)
  if (node.kind === 'pool') {
    const capPart = node.capacity && node.capacity > 0 ? `max ${node.capacity}` : ''
    return [capPart, macroBadge].filter(Boolean).join(' · ')
  }
  if (node.kind === 'register') {
    const fPart = node.formula
      ? node.formula.length > 18
        ? `${node.formula.slice(0, 17)}…`
        : node.formula
      : ''
    return [fPart, macroBadge].filter(Boolean).join(' · ')
  }
  if ((node.kind === 'converter' || node.kind === 'trader') && macroBadge) {
    return macroBadge
  }
  if (node.kind === 'gate') {
    const f = node.formula?.trim() || ''
    const lastRoll =
      store.playStep.value > 0 ? store.liveState.value?.gateLastRoll?.[node.id] : undefined
    if (f && lastRoll !== undefined) {
      const shortF = f.length > 14 ? `${f.slice(0, 13)}…` : f
      return [macroBadge, `${shortF} → ${formatValue(lastRoll)}`].filter(Boolean).join(' · ')
    }
    if (f) {
      const fPart = f.length > 18 ? `${f.slice(0, 17)}…` : f
      return [macroBadge, fPart].filter(Boolean).join(' · ')
    }
    if (lastRoll !== undefined && conditionalGateSet.value.has(node.id)) {
      return [macroBadge, `🎲 ${formatValue(lastRoll)}`].filter(Boolean).join(' · ')
    }
    if (macroBadge) return macroBadge
  }
  if ((node.kind === 'delay' || node.kind === 'queue') && node.delaySteps)
    return `${node.delaySteps} steps`
  if (node.kind === 'end' && node.formula) return node.formula
  return ''
}

function effectiveNodeSubLabel(node: MxNode): string {
  const hit = consumerNodeHitById.value.get(node.id)
  if (hit) {
    if (hit.sourceField === 'botCondition') {
      const bc = hit.formula.trim()
      return `⚡ ${bc.length > 34 ? `${bc.slice(0, 33)}…` : bc}`
    }
    const raw = hit.formula.trim()
    if (raw) {
      return raw.length > 36 ? `${raw.slice(0, 35)}…` : raw
    }
  }
  return nodeSubLabel(node)
}

function effectiveSubW(node: MxNode): number {
  if (
    hasMxNodeSimpleMacros(node) ||
    consumerNodeHitById.value.has(node.id) ||
    (node.kind === 'gate' &&
      store.playStep.value > 0 &&
      store.liveState.value?.gateLastRoll?.[node.id] !== undefined)
  ) {
    const lbl = effectiveNodeSubLabel(node)
    return lbl ? Math.max(28, estimateMxTextWidth(lbl, 9.2, true) + 16) : 0
  }
  return getMxNodeSubPillWidth(node)
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
  caption: string
  rateText: string
  intervalText: string
  dividerX: number
  leftTextX: number
  rightTextX: number
  hourglassX: number
  labelW: number
  dormant: boolean
  gatedOff: boolean
  formulaModified: boolean
  isCompactFormula: boolean
  tooltipText: string
  authoredFormula: string
  effectiveFormula: string
}

interface EdgeStaticMeta {
  color: string
  tokenColor: string
  marker: string
  label: string
  caption: string
  rateText: string
  intervalText: string
  dividerX: number
  leftTextX: number
  rightTextX: number
  hourglassX: number
  labelW: number
  reverse: boolean
  dormant: boolean
  gatedOff: boolean
  formulaModified: boolean
  isCompactFormula: boolean
  tooltipText: string
  authoredFormula: string
  effectiveFormula: string
}

function colorToEdgeMarkerId(colorHex: string): string {
  return `mx-arr-${colorHex.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()}`
}

function splitEdgeIntervalDisplay(
  kind: MxEdge['kind'],
  formulaText: string,
  formulaModified: boolean
): { rateText: string; intervalText: string } {
  if (kind !== 'resource') {
    return { rateText: formulaText, intervalText: '' }
  }
  const m = /^(.*?)\s*(?:(?<!\|)\|(?!\|)|(?:\bevery\b))\s*(.+)$/i.exec(formulaText)
  if (!m) {
    return { rateText: formulaText, intervalText: '' }
  }
  const rateText = m[1]!.trim() || '1'
  const ivText = m[2]!.trim()
  if (!ivText || (ivText === '1' && !formulaModified)) {
    return { rateText, intervalText: '' }
  }
  return { rateText, intervalText: ivText }
}

function buildSingleEdgeGeo(
  e: MxEdge,
  ax: number,
  ay: number,
  ra: number,
  bx: number,
  by: number,
  rb: number,
  targetPillW: number,
  bendOverride: number | undefined,
  meta: EdgeStaticMeta
): EdgeGeo {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.max(1, Math.hypot(dx, dy))
  const ux = dx / len
  const uy = dy / len
  const defaultBend = meta.reverse ? 28 : e.kind === 'state' ? Math.min(44, len * 0.12) : 0
  const bend =
    bendOverride !== undefined ? bendOverride : e.bend !== undefined ? e.bend : defaultBend
  const nx = -uy
  const ny = ux
  const sx = ax + ux * ra
  const sy = ay + uy * ra

  let ex = bx - ux * rb
  let ey = by - uy * rb
  let cx = (sx + ex) / 2 + nx * bend
  let cy = (sy + ey) / 2 + ny * bend

  if (e.targetEdgeId && targetPillW > 0) {
    const approxCx = (sx + bx) / 2 + nx * bend
    const approxCy = (sy + by) / 2 + ny * bend
    const tdx = bx - approxCx
    const tdy = by - approxCy
    const tlen = Math.max(1, Math.hypot(tdx, tdy))
    const tux = tdx / tlen
    const tuy = tdy / tlen
    const hw = targetPillW / 2 + 5
    const hh = 13.5
    const pillDist = Math.min(
      len * 0.45,
      hw / Math.max(1e-4, Math.abs(tux)),
      hh / Math.max(1e-4, Math.abs(tuy))
    )
    ex = bx - tux * pillDist
    ey = by - tuy * pillDist
    cx = approxCx
    cy = approxCy
  }

  const path =
    Math.abs(bend) > 0.5 ? `M ${sx},${sy} Q ${cx},${cy} ${ex},${ey}` : `M ${sx},${sy} L ${ex},${ey}`
  const mid =
    Math.abs(bend) > 0.5
      ? { x: (sx + 2 * cx + ex) / 4, y: (sy + 2 * cy + ey) / 4 }
      : { x: (sx + ex) / 2, y: (sy + ey) / 2 }

  return {
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
    color: meta.color,
    tokenColor: meta.tokenColor,
    marker: meta.marker,
    label: meta.label,
    caption: meta.caption,
    rateText: meta.rateText,
    intervalText: meta.intervalText,
    dividerX: meta.dividerX,
    leftTextX: meta.leftTextX,
    rightTextX: meta.rightTextX,
    hourglassX: meta.hourglassX,
    labelW: meta.labelW,
    dormant: meta.dormant,
    gatedOff: meta.gatedOff,
    formulaModified: meta.formulaModified,
    isCompactFormula: meta.isCompactFormula,
    tooltipText: meta.tooltipText,
    authoredFormula: meta.authoredFormula,
    effectiveFormula: meta.effectiveFormula
  }
}

const orderedVisibleTopology = computed(() => {
  void store.topologyRevision.value
  const d = store.peekDoc()
  const visIds = visibleIds.value
  const pairs = new Set<string>()
  const firstPass: MxEdge[] = []
  const pendingEdgeToEdge: MxEdge[] = []

  for (const e of d.edges) {
    if (!e.targetEdgeId) {
      pairs.add(`${e.from}>${e.to}`)
      if (visIds.has(e.from) && visIds.has(e.to)) {
        firstPass.push(e)
      }
    } else if (visIds.has(e.from)) {
      pendingEdgeToEdge.push(e)
    }
  }

  const orderedEdges: MxEdge[] = [...firstPass]
  const resolvedIds = new Set(firstPass.map((e) => e.id))
  let remaining = pendingEdgeToEdge
  for (let pass = 0; pass < 5 && remaining.length > 0; pass++) {
    const nextRem: MxEdge[] = []
    let progressed = false
    for (const e of remaining) {
      if (e.targetEdgeId && resolvedIds.has(e.targetEdgeId)) {
        orderedEdges.push(e)
        resolvedIds.add(e.id)
        progressed = true
      } else {
        nextRem.push(e)
      }
    }
    remaining = nextRem
    if (!progressed) break
  }
  return { orderedEdges, pairs }
})

const runtimeEdgeGates = computed(() => {
  void store.topologyRevision.value
  return evaluateMxEdgeRuntimeGates(store.peekDoc(), {
    values: store.displayValues.value,
    poolTokens: store.displayPoolTokens.value,
    step: store.playStep.value,
    params: resolvedParamsMap.value
  })
})

const compactEdgeFormulaMap = computed(() => {
  void store.topologyRevision.value
  return formatMxCompactEdgeFormulas(store.peekDoc(), {
    values: store.displayValues.value,
    step: store.playStep.value,
    params: resolvedParamsMap.value
  })
})

const edgeStaticMetaById = computed<Map<string, EdgeStaticMeta>>(() => {
  void store.topologyRevision.value
  const d = store.peekDoc()
  const nMap = new Map(d.nodes.map((n) => [n.id, n]))
  const { orderedEdges, pairs } = orderedVisibleTopology.value
  const resColors = resourceColorMap.value
  const flows = store.displayFlows.value
  const gateSnap = runtimeEdgeGates.value
  const compactMap = compactEdgeFormulaMap.value
  const compactMode = store.compactEdgeFormulas.value
  const isRuntimeStep = store.playStep.value > 0
  const showRuntimeMods = isRuntimeStep || store.playing.value || store.liveState.value !== null
  const selEdges = selectedEdgeSet.value
  const map = new Map<string, EdgeStaticMeta>()

  for (const e of orderedEdges) {
    const src = nMap.get(e.from)
    const srcColor = src
      ? src.kind === 'converter'
        ? converterOutputColor(src)
        : nodeColor(src)
      : e.kind === 'state'
        ? '#38bdf8'
        : '#64748b'
    const filterColor = e.resourceFilter && e.resourceId ? resColors.get(e.resourceId) : undefined
    const selected = selEdges.has(e.id)
    const baseColor = e.color || filterColor || srcColor
    const color = selected ? '#3d8bfd' : baseColor
    const marker = selected ? 'mx-arrow-sel' : colorToEdgeMarkerId(color)
    const flow = flows[e.id] ?? 0
    const gatedOff =
      e.kind === 'resource' && isRuntimeStep && flow <= 0 && gateSnap.gatedOffEdgeIds.has(e.id)
    const dormant = gatedOff || (e.kind === 'state' && gateSnap.dormantStateEdgeIds.has(e.id))
    const rawFormula = e.formula || (e.kind === 'state' ? '*' : '1')
    const withInterval =
      e.kind === 'resource' &&
      e.interval?.trim() &&
      e.interval.trim() !== '1' &&
      !/\bevery\b|(?<!\|)\|(?!\|)/i.test(rawFormula)
        ? `${rawFormula}|${e.interval.trim()}`
        : rawFormula
    const runtimeModFormula = showRuntimeMods ? gateSnap.modifiedEdgeFormulas.get(e.id) : undefined
    const formulaModified = runtimeModFormula !== undefined
    const effectiveFormula = runtimeModFormula ?? withInterval
    const { rateText: splitRate, intervalText: splitIv } = splitEdgeIntervalDisplay(
      e.kind,
      effectiveFormula,
      formulaModified
    )
    const compactHit = compactMap.get(e.id)
    const isCompactFormula = Boolean(compactMode && !selected && !formulaModified && compactHit)
    const displayRate = isCompactFormula && compactHit ? compactHit.compactRateText : splitRate
    const intervalText = isCompactFormula && compactHit ? compactHit.compactIntervalText : splitIv
    const rateText = e.influencer ? `★ ${displayRate}` : displayRate
    const tooltipText = formulaModified
      ? `fx: ${withInterval} ⇒ ${effectiveFormula}`
      : (compactHit?.tooltipText ?? '')
    const caption = e.label?.trim() || ''

    let labelW = 24
    let dividerX = 0
    let leftTextX = 0
    let rightTextX = 0
    let hourglassX = 0

    if (intervalText) {
      const leftW = Math.max(24, estimateMxTextWidth(rateText, 10.8, true) + 13)
      const ivTextW = estimateMxTextWidth(intervalText, 10.2, true)
      const rightContentW = ivTextW + 9.5
      const rightW = Math.max(28, rightContentW + 12)
      labelW = leftW + rightW
      dividerX = -labelW / 2 + leftW
      leftTextX = -labelW / 2 + leftW / 2
      const rightStart = dividerX + (rightW - rightContentW) / 2
      rightTextX = rightStart + ivTextW / 2
      hourglassX = rightStart + ivTextW + 6.5
    } else {
      labelW = Math.max(24, estimateMxTextWidth(rateText, 10.8, true) + 14)
    }

    map.set(e.id, {
      color,
      tokenColor: filterColor ?? srcColor,
      marker,
      label: effectiveFormula,
      caption,
      rateText,
      intervalText,
      dividerX,
      leftTextX,
      rightTextX,
      hourglassX,
      labelW,
      reverse: !e.targetEdgeId && pairs.has(`${e.to}>${e.from}`),
      dormant,
      gatedOff,
      formulaModified,
      isCompactFormula,
      tooltipText,
      authoredFormula: withInterval,
      effectiveFormula
    })
  }
  return map
})

const edgeMarkerDefs = computed(() => {
  const seen = new Map<string, string>()
  for (const meta of edgeStaticMetaById.value.values()) {
    if (meta.marker !== 'mx-arrow-sel' && !seen.has(meta.marker)) {
      seen.set(meta.marker, meta.color)
    }
  }
  return Array.from(seen.entries()).map(([id, color]) => ({ id, color }))
})

const baseEdgeGeoById = computed<Map<string, EdgeGeo>>(() => {
  const { orderedEdges } = orderedVisibleTopology.value
  const metaMap = edgeStaticMetaById.value
  const nMap = nodeById.value
  const edgeById = new Map(store.doc.value.edges.map((e) => [e.id, e]))
  const out = new Map<string, EdgeGeo>()

  for (const topoEdge of orderedEdges) {
    const e = edgeById.get(topoEdge.id) ?? topoEdge
    const meta = metaMap.get(e.id)
    const a = nMap.get(e.from)
    if (!meta || !a) continue

    let bx = 0
    let by = 0
    let rb = 10
    let targetPillW = 0
    if (e.targetEdgeId) {
      const targetGeo = out.get(e.targetEdgeId)
      if (!targetGeo) continue
      bx = targetGeo.mid.x
      by = targetGeo.mid.y
      targetPillW = targetGeo.labelW
    } else {
      const b = nMap.get(e.to)
      if (!b) continue
      bx = b.x
      by = b.y
      rb = nodeRadius(b) + 6
    }

    out.set(
      e.id,
      buildSingleEdgeGeo(e, a.x, a.y, nodeRadius(a) + 2, bx, by, rb, targetPillW, e.bend, meta)
    )
  }
  return out
})

const edgeGeometries = computed<EdgeGeo[]>(() => {
  const baseMap = baseEdgeGeoById.value
  const tNodes = transientNodePos.value
  const tBends = transientEdgeBend.value
  if (tNodes.size === 0 && tBends.size === 0) {
    return Array.from(baseMap.values())
  }

  const { orderedEdges } = orderedVisibleTopology.value
  const metaMap = edgeStaticMetaById.value
  const nMap = nodeById.value
  const movedEdgeIds = new Set<string>()
  const resolvedGeoById = new Map<string, EdgeGeo>()
  const out: EdgeGeo[] = []

  for (const topoEdge of orderedEdges) {
    const baseGeo = baseMap.get(topoEdge.id)
    const e = baseGeo?.edge ?? topoEdge
    const isAffected =
      tNodes.has(e.from) ||
      (e.targetEdgeId ? movedEdgeIds.has(e.targetEdgeId) : tNodes.has(e.to)) ||
      tBends.has(e.id)

    if (!isAffected && baseGeo) {
      resolvedGeoById.set(e.id, baseGeo)
      out.push(baseGeo)
      continue
    }

    const meta = metaMap.get(e.id)
    const a = nMap.get(e.from)
    if (!meta || !a) continue

    const ax = tNodes.get(a.id)?.x ?? a.x
    const ay = tNodes.get(a.id)?.y ?? a.y
    let bx = 0
    let by = 0
    let rb = 10
    let targetPillW = 0
    if (e.targetEdgeId) {
      const targetGeo = resolvedGeoById.get(e.targetEdgeId)
      if (!targetGeo) continue
      bx = targetGeo.mid.x
      by = targetGeo.mid.y
      targetPillW = targetGeo.labelW
    } else {
      const b = nMap.get(e.to)
      if (!b) continue
      bx = tNodes.get(b.id)?.x ?? b.x
      by = tNodes.get(b.id)?.y ?? b.y
      rb = nodeRadius(b) + 6
    }

    const geo = buildSingleEdgeGeo(
      e,
      ax,
      ay,
      nodeRadius(a) + 2,
      bx,
      by,
      rb,
      targetPillW,
      tBends.get(e.id),
      meta
    )
    movedEdgeIds.add(e.id)
    resolvedGeoById.set(e.id, geo)
    out.push(geo)
  }
  return out
})

const renderedEdgeGeometries = computed<EdgeGeo[]>(() => {
  const all = edgeGeometries.value
  if (!isLargeGraph.value) return all
  const rIds = renderedNodeIds.value
  const selE = selectedEdgeSet.value
  const consumerEdges = consumerEdgeHitById.value
  const bridgeEdges = directConsumerBridgeEdgeIdSet.value
  const r = viewportWorldRect.value
  return all.filter(
    (g) =>
      rIds.has(g.edge.from) ||
      rIds.has(g.edge.to) ||
      selE.has(g.edge.id) ||
      consumerEdges.has(g.edge.id) ||
      bridgeEdges.has(g.edge.id) ||
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
  const sx = nodeX(n) * store.view.zoom + store.view.x
  const sy = (nodeY(n) - nodeRadius(n) - 18) * store.view.zoom + store.view.y
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

const selectedNodeConsumers = computed(() => {
  void store.topologyRevision.value
  if (store.selection.nodes.length === 0 || store.selection.nodes.length > 12) {
    return { nodes: [], edges: [], params: [] }
  }
  return resolveMxNodeConsumers(store.peekDoc(), store.selection.nodes)
})

const consumerNodeHitById = computed<Map<string, MxNodeConsumerNodeHit>>(() => {
  const map = new Map<string, MxNodeConsumerNodeHit>()
  for (const h of selectedNodeConsumers.value.nodes) {
    if (!visibleIds.value.has(h.consumerNodeId)) continue
    const prev = map.get(h.consumerNodeId)
    if (!prev) {
      map.set(h.consumerNodeId, h)
    } else if (!prev.token.includes(h.token)) {
      map.set(h.consumerNodeId, { ...prev, token: `${prev.token}, ${h.token}` })
    }
  }
  return map
})

const consumerEdgeHitById = computed<Map<string, MxNodeConsumerEdgeHit>>(() => {
  const map = new Map<string, MxNodeConsumerEdgeHit>()
  for (const h of selectedNodeConsumers.value.edges) {
    const prev = map.get(h.consumerEdgeId)
    if (!prev) {
      map.set(h.consumerEdgeId, h)
    } else if (prev.isDirectStateCondition && !h.isDirectStateCondition) {
      map.set(h.consumerEdgeId, h)
    }
  }
  return map
})

const directConsumerBridgeEdgeIdSet = computed<Set<string>>(() => {
  void store.topologyRevision.value
  const set = new Set<string>()
  const nodeHits = selectedNodeConsumers.value.nodes
  if (nodeHits.length === 0) return set
  const pairs = new Set(nodeHits.map((h) => `${h.sourceNodeId}->${h.consumerNodeId}`))
  for (const e of store.peekDoc().edges) {
    if (!e.targetEdgeId && pairs.has(`${e.from}->${e.to}`)) {
      set.add(e.id)
    }
  }
  return set
})

interface FormulaRefLink {
  key: string
  edgeId: string
  nodeId: string
  token: string
  sx: number
  sy: number
  tx: number
  ty: number
  haloR: number
  path: string
  tagX: number
  tagY: number
  tagW: number
}

const activeEdgeReferencedNodesMap = computed(() => {
  void store.topologyRevision.value
  const activeEdgeIds = new Set<string>(store.selection.edges)
  const ed = edgeEdit.value
  if (ed) activeEdgeIds.add(ed.id)
  const out = new Map<string, Array<{ nodeId: string; token: string; tagW: number }>>()
  if (activeEdgeIds.size === 0 || activeEdgeIds.size > 12) return out
  const d = store.peekDoc()
  const edgeById = new Map(d.edges.map((e) => [e.id, e]))
  for (const edgeId of activeEdgeIds) {
    const rawEdge = edgeById.get(edgeId)
    if (!rawEdge) continue
    const effEdge = ed?.id === edgeId ? { ...rawEdge, formula: ed.value } : rawEdge
    const refs = resolveMxEdgeReferencedNodes(d, effEdge)
    out.set(
      edgeId,
      refs.map((r) => ({
        nodeId: r.nodeId,
        token: r.token,
        tagW: Math.max(20, estimateMxTextWidth(r.token, 9.5, true) + 10)
      }))
    )
  }
  return out
})

const formulaRefLinks = computed<FormulaRefLink[]>(() => {
  const edgeRefsMap = activeEdgeReferencedNodesMap.value
  const hasEdgeActive = edgeRefsMap.size > 0
  const consumers = selectedNodeConsumers.value
  const hasNodeConsumers = consumers.nodes.length > 0 || consumers.edges.length > 0
  if (!hasEdgeActive && !hasNodeConsumers) return []

  const geoById = new Map<string, EdgeGeo>()
  for (const g of edgeGeometries.value) geoById.set(g.edge.id, g)

  const links: FormulaRefLink[] = []
  if (hasEdgeActive) {
    for (const [edgeId, refs] of edgeRefsMap.entries()) {
      const geo = geoById.get(edgeId)
      if (!geo) continue
      for (const refItem of refs) {
        if (!visibleIds.value.has(refItem.nodeId)) continue
        const target = nodeById.value.get(refItem.nodeId)
        if (!target) continue
        const tx = nodeX(target)
        const ty = nodeY(target)

        const dx = tx - geo.mid.x
        const dy = ty - geo.mid.y
        const len = Math.hypot(dx, dy)
        if (len < 4) continue
        const ux = dx / len
        const uy = dy / len

        const hw = geo.labelW / 2 + 3
        const hh = 11.5
        const pillDist = Math.min(
          len * 0.36,
          hw / Math.max(1e-4, Math.abs(ux)),
          hh / Math.max(1e-4, Math.abs(uy))
        )
        const haloR = nodeRadius(target) + 6
        const nodeStop = Math.min(len * 0.42, haloR + 2)

        const sx = geo.mid.x + ux * pillDist
        const sy = geo.mid.y + uy * pillDist
        const ex = tx - ux * nodeStop
        const ey = ty - uy * nodeStop
        const arcBend = Math.min(30, Math.max(14, len * 0.14))
        const cx = (sx + ex) / 2 - uy * arcBend
        const cy = (sy + ey) / 2 + ux * arcBend
        const path = `M ${sx},${sy} Q ${cx},${cy} ${ex},${ey}`
        const tagX = (sx + 2 * cx + ex) / 4
        const tagY = (sy + 2 * cy + ey) / 4

        links.push({
          key: `${edgeId}->${refItem.nodeId}`,
          edgeId,
          nodeId: refItem.nodeId,
          token: refItem.token,
          sx,
          sy,
          tx,
          ty,
          haloR,
          path,
          tagX,
          tagY,
          tagW: refItem.tagW
        })
      }
    }
  }

  if (hasNodeConsumers) {
    const directNodePairs = new Set<string>()
    for (const e of store.peekDoc().edges) {
      if (!e.targetEdgeId) directNodePairs.add(`${e.from}->${e.to}`)
    }

    const seenNodeLinkKeys = new Set<string>()
    for (const nh of consumers.nodes) {
      const pairKey = `${nh.sourceNodeId}->${nh.consumerNodeId}`
      if (directNodePairs.has(pairKey) || seenNodeLinkKeys.has(pairKey)) continue
      if (!visibleIds.value.has(nh.sourceNodeId) || !visibleIds.value.has(nh.consumerNodeId)) {
        continue
      }
      const src = nodeById.value.get(nh.sourceNodeId)
      const dst = nodeById.value.get(nh.consumerNodeId)
      if (!src || !dst) continue
      seenNodeLinkKeys.add(pairKey)

      const srcX = nodeX(src)
      const srcY = nodeY(src)
      const dstX = nodeX(dst)
      const dstY = nodeY(dst)
      const dx = dstX - srcX
      const dy = dstY - srcY
      const len = Math.hypot(dx, dy)
      if (len < 6) continue
      const ux = dx / len
      const uy = dy / len

      const srcOut = Math.min(len * 0.36, nodeRadius(src) + 4)
      const dstStop = Math.min(len * 0.42, nodeRadius(dst) + 9)
      const sx = srcX + ux * srcOut
      const sy = srcY + uy * srcOut
      const ex = dstX - ux * dstStop
      const ey = dstY - uy * dstStop
      const arcBend = Math.min(34, Math.max(16, len * 0.14))
      const cx = (sx + ex) / 2 - uy * arcBend
      const cy = (sy + ey) / 2 + ux * arcBend
      const path = `M ${sx},${sy} Q ${cx},${cy} ${ex},${ey}`
      const tagX = (sx + 2 * cx + ex) / 4
      const tagY = (sy + 2 * cy + ey) / 4
      const mergedHit = consumerNodeHitById.value.get(nh.consumerNodeId) ?? nh
      const tagW = Math.max(20, estimateMxTextWidth(mergedHit.token, 9.5, true) + 10)

      links.push({
        key: `ncons:${pairKey}`,
        edgeId: '',
        nodeId: nh.consumerNodeId,
        token: mergedHit.token,
        sx,
        sy,
        tx: dstX,
        ty: dstY,
        haloR: 0,
        path,
        tagX,
        tagY,
        tagW
      })
    }

    const seenEdgeLinkKeys = new Set<string>()
    for (const eh of consumers.edges) {
      if (eh.isDirectStateCondition) continue
      const geo = geoById.get(eh.consumerEdgeId)
      if (!geo || geo.edge.from === eh.sourceNodeId || edgeRefsMap.has(eh.consumerEdgeId)) {
        continue
      }
      if (!visibleIds.value.has(eh.sourceNodeId)) continue
      const src = nodeById.value.get(eh.sourceNodeId)
      if (!src) continue
      const pairKey = `${eh.sourceNodeId}->edge:${eh.consumerEdgeId}`
      if (seenEdgeLinkKeys.has(pairKey)) continue
      seenEdgeLinkKeys.add(pairKey)

      const srcX = nodeX(src)
      const srcY = nodeY(src)
      const dx = geo.mid.x - srcX
      const dy = geo.mid.y - srcY
      const len = Math.hypot(dx, dy)
      if (len < 6) continue
      const ux = dx / len
      const uy = dy / len

      const srcOut = Math.min(len * 0.36, nodeRadius(src) + 4)
      const hw = geo.labelW / 2 + 4
      const hh = 12
      const pillStop = Math.min(
        len * 0.38,
        hw / Math.max(1e-4, Math.abs(ux)),
        hh / Math.max(1e-4, Math.abs(uy))
      )
      const sx = srcX + ux * srcOut
      const sy = srcY + uy * srcOut
      const ex = geo.mid.x - ux * pillStop
      const ey = geo.mid.y - uy * pillStop
      const arcBend = Math.min(30, Math.max(14, len * 0.14))
      const cx = (sx + ex) / 2 - uy * arcBend
      const cy = (sy + ey) / 2 + ux * arcBend
      const path = `M ${sx},${sy} Q ${cx},${cy} ${ex},${ey}`
      const tagX = (sx + 2 * cx + ex) / 4
      const tagY = (sy + 2 * cy + ey) / 4
      const tagW = Math.max(20, estimateMxTextWidth(eh.token, 9.5, true) + 10)

      links.push({
        key: `econs:${pairKey}`,
        edgeId: eh.consumerEdgeId,
        nodeId: '',
        token: eh.token,
        sx,
        sy,
        tx: geo.mid.x,
        ty: geo.mid.y,
        haloR: 0,
        path,
        tagX,
        tagY,
        tagW
      })
    }
  }
  return links
})

const formulaRefNodeIdSet = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const l of formulaRefLinks.value) {
    if (l.nodeId) s.add(l.nodeId)
  }
  return s
})

// ───────── 坐标换算（拖拽期间缓存 SVG 视口矩形，消除高频 pointermove 强制同步布局回流） ─────────
let cachedSvgRect: DOMRect | null = null
let activeCapturedPointerId: number | null = null

function refreshSvgRect(): DOMRect {
  cachedSvgRect = svgRef.value?.getBoundingClientRect() ?? null
  return cachedSvgRect ?? ({ left: 0, top: 0, width: 800, height: 600 } as DOMRect)
}

function clientToWorld(
  clientX: number,
  clientY: number,
  useCache = false
): {
  x: number
  y: number
  sx: number
  sy: number
} {
  const rect = useCache && cachedSvgRect ? cachedSvgRect : refreshSvgRect()
  const sx = clientX - rect.left
  const sy = clientY - rect.top
  return {
    sx,
    sy,
    x: (sx - store.view.x) / store.view.zoom,
    y: (sy - store.view.y) / store.view.zoom
  }
}

function toWorld(ev: PointerEvent | WheelEvent | MouseEvent): {
  x: number
  y: number
  sx: number
  sy: number
} {
  return clientToWorld(ev.clientX, ev.clientY, false)
}

function captureCanvasPointer(ev: PointerEvent): void {
  refreshSvgRect()
  if (typeof ev.pointerId === 'number') {
    try {
      svgRef.value?.setPointerCapture?.(ev.pointerId)
      activeCapturedPointerId = ev.pointerId
    } catch {
      activeCapturedPointerId = null
    }
  }
}

function releaseCanvasPointer(): void {
  if (activeCapturedPointerId !== null) {
    try {
      svgRef.value?.releasePointerCapture?.(activeCapturedPointerId)
    } catch {
      // ignore if already released
    }
    activeCapturedPointerId = null
  }
  cachedSvgRect = null
}

// ───────── 交互状态 ─────────
const panState = ref<{ sx: number; sy: number; vx: number; vy: number } | null>(null)
const dragState = ref<{
  ids: string[]
  leadId: string
  startX: number
  startY: number
  origins: Record<string, { x: number; y: number }>
  snapCandidates: Array<{ x: number; y: number }>
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
  key: string
} | null>(null)
const groupDrag = ref<{
  groupId: string
  startX: number
  startY: number
  originX: number
  originY: number
  width: number
  height: number
  memberOrigins: Array<{ id: string; x: number; y: number }>
  key: string
  moved: boolean
} | null>(null)
const groupResize = ref<{
  groupId: string
  startX: number
  startY: number
  originX: number
  originY: number
  initW: number
  initH: number
  key: string
  moved: boolean
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
const reconnectDrag = ref<{
  edgeId: string
  end: 'from' | 'to'
  kind: MxEdgeKind
  fixedAnchorX: number
  fixedAnchorY: number
  fixedRadius: number
  pointerX: number
  pointerY: number
  hoverNodeId: string
  hoverEdgeId: string
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

function isEdgeLocked(edge: MxEdge): boolean {
  const a = nodeById.value.get(edge.from)
  const b = nodeById.value.get(edge.to)
  return Boolean((a && isLocked(a)) || (b && isLocked(b)))
}

const endpointHandleGeos = computed<EdgeGeo[]>(() => {
  if (isSimRuntime.value || connectDrag.value || reconnectDrag.value) return []
  return renderedEdgeGeometries.value.filter(
    (geo) =>
      (isEdgeSelected(geo.edge.id) || hoveredEdgeId.value === geo.edge.id) &&
      !isEdgeLocked(geo.edge)
  )
})

const reconnectPreview = computed(() => {
  const rd = reconnectDrag.value
  if (!rd) return null
  let fromX = 0
  let fromY = 0
  let toX = 0
  let toY = 0
  if (rd.end === 'to') {
    const dx = rd.pointerX - rd.fixedAnchorX
    const dy = rd.pointerY - rd.fixedAnchorY
    const dist = Math.hypot(dx, dy) || 1
    fromX = rd.fixedAnchorX + (dx / dist) * rd.fixedRadius
    fromY = rd.fixedAnchorY + (dy / dist) * rd.fixedRadius
    toX = rd.pointerX
    toY = rd.pointerY
  } else {
    const dx = rd.fixedAnchorX - rd.pointerX
    const dy = rd.fixedAnchorY - rd.pointerY
    const dist = Math.hypot(dx, dy) || 1
    fromX = rd.pointerX
    fromY = rd.pointerY
    toX = rd.fixedAnchorX - (dx / dist) * rd.fixedRadius
    toY = rd.fixedAnchorY - (dy / dist) * rd.fixedRadius
  }
  const dx = toX - fromX
  const dy = toY - fromY
  const len = Math.hypot(dx, dy)
  const path =
    rd.kind === 'state' && len > 30
      ? `M ${fromX},${fromY} Q ${(fromX + toX) / 2 - (dy / len) * 24},${(fromY + toY) / 2 + (dx / len) * 24} ${toX},${toY}`
      : `M ${fromX},${fromY} L ${toX},${toY}`
  return {
    kind: rd.kind,
    fromX,
    fromY,
    toX,
    toY,
    path
  }
})

function canReconnectToNode(
  rd: NonNullable<typeof reconnectDrag.value>,
  candidate: MxNode
): boolean {
  if (candidate.kind === 'note' || isLocked(candidate)) return false
  const curEdge = store.doc.value.edges.find((e) => e.id === rd.edgeId)
  if (!curEdge) return false
  if (rd.end === 'from') {
    if (
      store.doc.value.edges.some(
        (dep) => dep.targetEdgeId === rd.edgeId && dep.from === candidate.id
      )
    ) {
      return false
    }
    if (curEdge.targetEdgeId) {
      const tgtEdge = store.doc.value.edges.find((e) => e.id === curEdge.targetEdgeId)
      return Boolean(tgtEdge && tgtEdge.from !== candidate.id)
    }
    return candidate.id !== curEdge.to
  }
  return candidate.id !== curEdge.from
}

function canReconnectToEdge(
  rd: NonNullable<typeof reconnectDrag.value>,
  candidateGeo: EdgeGeo
): boolean {
  if (rd.end !== 'to' || rd.kind !== 'state') return false
  if (candidateGeo.edge.id === rd.edgeId) return false
  const curEdge = store.doc.value.edges.find((e) => e.id === rd.edgeId)
  if (!curEdge || candidateGeo.edge.from === curEdge.from) return false
  let cursor: MxEdge | undefined = candidateGeo.edge
  const visited = new Set<string>([rd.edgeId])
  while (cursor?.targetEdgeId) {
    if (visited.has(cursor.targetEdgeId)) return false
    visited.add(cursor.targetEdgeId)
    cursor = store.doc.value.edges.find((e) => e.id === cursor!.targetEdgeId)
  }
  return true
}

function startEdgeEndpointDrag(geo: EdgeGeo, end: 'from' | 'to', ev: PointerEvent): void {
  if (ev.button !== 0 || isEdgeLocked(geo.edge)) return
  rootRef.value?.focus()
  closeMenus()
  if (!isEdgeSelected(geo.edge.id)) {
    store.select([], [geo.edge.id])
  }
  captureCanvasPointer(ev)
  const p = clientToWorld(ev.clientX, ev.clientY, true)
  const srcNode = nodeById.value.get(geo.edge.from)
  const tgtNode = !geo.edge.targetEdgeId ? nodeById.value.get(geo.edge.to) : undefined
  const fixedAnchorX =
    end === 'to' ? (srcNode?.x ?? geo.sx) : geo.edge.targetEdgeId ? geo.ex : (tgtNode?.x ?? geo.ex)
  const fixedAnchorY =
    end === 'to' ? (srcNode?.y ?? geo.sy) : geo.edge.targetEdgeId ? geo.ey : (tgtNode?.y ?? geo.ey)
  const fixedRadius =
    end === 'to'
      ? srcNode
        ? nodeRadius(srcNode) + 2
        : 0
      : !geo.edge.targetEdgeId && tgtNode
        ? nodeRadius(tgtNode) + 6
        : 0
  reconnectDrag.value = {
    edgeId: geo.edge.id,
    end,
    kind: geo.edge.kind,
    fixedAnchorX,
    fixedAnchorY,
    fixedRadius,
    pointerX: p.x,
    pointerY: p.y,
    hoverNodeId: '',
    hoverEdgeId: ''
  }
}

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
  captureCanvasPointer(ev)
  const actualKind: MxEdgeKind = ev.altKey ? 'state' : kind
  const p = clientToWorld(ev.clientX, ev.clientY, true)
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

const isActiveGeometryDrag = computed(() =>
  Boolean(
    (dragState.value && dragState.value.moved) ||
    (groupDrag.value && groupDrag.value.moved) ||
    (groupResize.value && groupResize.value.moved) ||
    bendDrag.value
  )
)

watch(
  isActiveGeometryDrag,
  (dragging) => {
    store.isCanvasDragging.value = dragging
  },
  { immediate: true }
)

function startBendDrag(edge: MxEdge, ev: PointerEvent): void {
  const geo = edgeGeometries.value.find((g) => g.edge.id === edge.id)
  if (!geo) return
  captureCanvasPointer(ev)
  const p = clientToWorld(ev.clientX, ev.clientY, true)
  bendDrag.value = {
    edgeId: edge.id,
    startX: p.x,
    startY: p.y,
    nx: geo.nx,
    ny: geo.ny,
    initialBend: edge.bend ?? 0,
    key: `bend:${edge.id}:${Date.now()}`
  }
}

function startGroupDrag(grp: MxGroup, ev: PointerEvent): void {
  rootRef.value?.focus()
  closeMenus()
  edgeEdit.value = null
  if (ev.button === 0 && !ev.shiftKey) store.select([])
  if (ev.button !== 0 || isGroupLocked(grp)) return
  captureCanvasPointer(ev)
  const p = clientToWorld(ev.clientX, ev.clientY, true)
  const x0 = grp.x
  const y0 = grp.y
  const x1 = grp.x + grp.width
  const y1 = grp.y + grp.height
  const memberOrigins: Array<{ id: string; x: number; y: number }> = []
  for (const n of store.doc.value.nodes) {
    if (!isLocked(n) && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1) {
      memberOrigins.push({ id: n.id, x: n.x, y: n.y })
    }
  }
  groupDrag.value = {
    groupId: grp.id,
    startX: p.x,
    startY: p.y,
    originX: grp.x,
    originY: grp.y,
    width: grp.width,
    height: grp.height,
    memberOrigins,
    key: `grpDrag:${grp.id}:${Date.now()}`,
    moved: false
  }
}

function startGroupResize(grp: MxGroup, ev: PointerEvent): void {
  rootRef.value?.focus()
  closeMenus()
  edgeEdit.value = null
  if (ev.button === 0 && !ev.shiftKey) store.select([])
  if (ev.button !== 0 || isGroupLocked(grp)) return
  captureCanvasPointer(ev)
  const p = clientToWorld(ev.clientX, ev.clientY, true)
  groupResize.value = {
    groupId: grp.id,
    startX: p.x,
    startY: p.y,
    originX: grp.x,
    originY: grp.y,
    initW: grp.width,
    initH: grp.height,
    key: `grpRes:${grp.id}:${Date.now()}`,
    moved: false
  }
}

function onBgPointerDown(ev: PointerEvent): void {
  rootRef.value?.focus()
  closeMenus()
  edgeEdit.value = null
  if (ev.button === 2 && (connectDrag.value || reconnectDrag.value)) {
    connectDrag.value = null
    reconnectDrag.value = null
    return
  }
  if (connectDrag.value?.sticky) {
    // 处于点击连线模式时，交由 onPointerUp 处理空白处快速新建或取消
    return
  }
  const p = toWorld(ev)
  if (ev.button === 1 || spaceDown) {
    captureCanvasPointer(ev)
    panState.value = { sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y }
    return
  }
  if (ev.button === 2) {
    if (!ev.shiftKey) store.select([])
    return
  }
  if (isNodeTool.value) {
    const gx = store.snapToGrid.value ? Math.round(p.x / 20) * 20 : p.x
    const gy = store.snapToGrid.value ? Math.round(p.y / 20) * 20 : p.y
    store.addNode(store.tool.value as MxNodeKind, gx, gy)
    if (!ev.shiftKey) store.tool.value = 'select'
    return
  }
  if (store.tool.value === 'resource_edge' || store.tool.value === 'state_edge') {
    if (!ev.shiftKey) {
      store.tool.value = 'select'
      store.select([])
    }
    return
  }
  if (store.tool.value === 'select') {
    captureCanvasPointer(ev)
    marquee.value = { x0: p.sx, y0: p.sy, x1: p.sx, y1: p.sy, additive: ev.shiftKey }
    if (!ev.shiftKey) store.select([])
  }
}

function onNodePointerDown(node: MxNode, ev: PointerEvent): void {
  rootRef.value?.focus()
  closeMenus()
  if (connectDrag.value?.sticky) {
    // 处于点击连线模式时，点击目标节点由 onPointerUp 完成连线
    return
  }
  if (ev.button === 1) {
    captureCanvasPointer(ev)
    panState.value = { sx: ev.clientX, sy: ev.clientY, vx: store.view.x, vy: store.view.y }
    return
  }
  if (ev.button === 2) return

  // Alt + 拖拽节点：直接拖出连线（Shift+Alt 为状态边，Alt 为资源边）
  const tl = store.tool.value
  if (ev.altKey || tl === 'resource_edge' || tl === 'state_edge') {
    captureCanvasPointer(ev)
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
  if (!ids.length) return
  const origins: Record<string, { x: number; y: number }> = {}
  for (const id of ids) {
    const n = nodeById.value.get(id)
    if (n) origins[id] = { x: n.x, y: n.y }
  }
  const leadId = ids.includes(node.id) ? node.id : ids[0]!
  const snapCandidates: Array<{ x: number; y: number }> = []
  if (ids.length === 1) {
    for (const other of visibleNodes.value) {
      if (other.id !== leadId) snapCandidates.push({ x: other.x, y: other.y })
    }
  }
  captureCanvasPointer(ev)
  const p = clientToWorld(ev.clientX, ev.clientY, true)
  dragState.value = {
    ids,
    leadId,
    startX: p.x,
    startY: p.y,
    origins,
    snapCandidates,
    key: `drag:${Date.now()}`,
    moved: false
  }
}

function onNodeDblClick(node: MxNode): void {
  if (node.kind === 'note') {
    startNodeLabelEdit(node)
    return
  }
  if (
    !isSimRuntime.value &&
    node.trigger !== 'interactive' &&
    (node.kind === 'register' || node.kind === 'end')
  ) {
    store.openFormulaModal({ targetType: 'node', nodeId: node.id, field: 'formula' })
    return
  }
  store.interact(node.id)
}

function onNodeSubPillDblClick(node: MxNode): void {
  if (
    node.kind === 'register' ||
    node.kind === 'end' ||
    node.kind === 'gate' ||
    node.kind === 'delay' ||
    node.kind === 'queue'
  ) {
    store.openFormulaModal({ targetType: 'node', nodeId: node.id, field: 'formula' })
  }
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

let pointerRafId: number | null = null
let pendingPointer: { clientX: number; clientY: number } | null = null

function cancelPendingPointerRaf(): void {
  if (pointerRafId !== null) {
    cancelAnimationFrame(pointerRafId)
    pointerRafId = null
  }
  pendingPointer = null
}

function cancelActiveTransientDrag(): void {
  cancelPendingPointerRaf()
  if (alignGuides.value.length > 0) alignGuides.value = []
  dragState.value = null
  groupDrag.value = null
  groupResize.value = null
  bendDrag.value = null
  panState.value = null
  marquee.value = null
  transientNodePos.value = EMPTY_NODE_POS_MAP
  transientGroupRect.value = EMPTY_GROUP_RECT_MAP
  transientEdgeBend.value = EMPTY_EDGE_BEND_MAP
  releaseCanvasPointer()
}

function processPointerMove(clientX: number, clientY: number): void {
  if (panState.value) {
    store.view.x = panState.value.vx + (clientX - panState.value.sx)
    store.view.y = panState.value.vy + (clientY - panState.value.sy)
    return
  }

  const p = clientToWorld(clientX, clientY, activeCapturedPointerId !== null)

  if (bendDrag.value) {
    const b = bendDrag.value
    const dx = p.x - b.startX
    const dy = p.y - b.startY
    const proj = (dx * b.nx + dy * b.ny) * 2
    const nextBend = Math.round(b.initialBend + proj)
    if (transientEdgeBend.value.get(b.edgeId) !== nextBend) {
      transientEdgeBend.value = new Map([[b.edgeId, nextBend]])
    }
    return
  }

  if (groupResize.value) {
    const gr = groupResize.value
    const rawW = gr.initW + (p.x - gr.startX)
    const rawH = gr.initH + (p.y - gr.startY)
    const nextW = Math.max(
      120,
      store.snapToGrid.value ? Math.round(rawW / 20) * 20 : Math.round(rawW)
    )
    const nextH = Math.max(
      100,
      store.snapToGrid.value ? Math.round(rawH / 20) * 20 : Math.round(rawH)
    )
    gr.moved = true
    const cur = transientGroupRect.value.get(gr.groupId)
    if (!cur || cur.width !== nextW || cur.height !== nextH) {
      transientGroupRect.value = new Map([
        [gr.groupId, { x: gr.originX, y: gr.originY, width: nextW, height: nextH }]
      ])
    }
    return
  }

  if (groupDrag.value) {
    const gd = groupDrag.value
    const rawDx = p.x - gd.startX
    const rawDy = p.y - gd.startY
    if (!gd.moved && Math.hypot(rawDx, rawDy) < 2) return
    gd.moved = true
    const rawX = gd.originX + rawDx
    const rawY = gd.originY + rawDy
    const targetX = store.snapToGrid.value ? Math.round(rawX / 20) * 20 : Math.round(rawX)
    const targetY = store.snapToGrid.value ? Math.round(rawY / 20) * 20 : Math.round(rawY)
    const dx = targetX - Math.round(gd.originX)
    const dy = targetY - Math.round(gd.originY)
    const curGrp = transientGroupRect.value.get(gd.groupId)
    if (!curGrp || curGrp.x !== targetX || curGrp.y !== targetY) {
      transientGroupRect.value = new Map([
        [gd.groupId, { x: targetX, y: targetY, width: gd.width, height: gd.height }]
      ])
      if (gd.memberOrigins.length > 0) {
        const nextNodePos = new Map<string, { x: number; y: number }>()
        for (const m of gd.memberOrigins) {
          nextNodePos.set(m.id, { x: Math.round(m.x + dx), y: Math.round(m.y + dy) })
        }
        transientNodePos.value = nextNodePos
      }
    }
    return
  }

  if (dragState.value && dragState.value.ids.length) {
    const ds = dragState.value
    const rawDx = p.x - ds.startX
    const rawDy = p.y - ds.startY
    if (!ds.moved && Math.hypot(rawDx, rawDy) < 2) return
    ds.moved = true

    const leadOrig = ds.origins[ds.leadId] ?? { x: 0, y: 0 }
    let effDx = rawDx
    let effDy = rawDy

    if (store.snapToGrid.value) {
      const rawLeadX = leadOrig.x + rawDx
      const rawLeadY = leadOrig.y + rawDy
      let targetLeadX = Math.round(rawLeadX / 20) * 20
      let targetLeadY = Math.round(rawLeadY / 20) * 20

      if (ds.ids.length === 1 && ds.snapCandidates.length > 0) {
        let bestXDist = 7
        let bestYDist = 7
        for (const other of ds.snapCandidates) {
          const distX = Math.abs(other.x - rawLeadX)
          if (distX < bestXDist) {
            bestXDist = distX
            targetLeadX = other.x
          }
          const distY = Math.abs(other.y - rawLeadY)
          if (distY < bestYDist) {
            bestYDist = distY
            targetLeadY = other.y
          }
        }
        const guides: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
        for (const other of ds.snapCandidates) {
          if (Math.abs(other.x - targetLeadX) < 0.5) {
            guides.push({
              x1: other.x,
              y1: Math.min(other.y, targetLeadY) - 40,
              x2: other.x,
              y2: Math.max(other.y, targetLeadY) + 40
            })
          }
          if (Math.abs(other.y - targetLeadY) < 0.5) {
            guides.push({
              x1: Math.min(other.x, targetLeadX) - 40,
              y1: other.y,
              x2: Math.max(other.x, targetLeadX) + 40,
              y2: other.y
            })
          }
        }
        if (guides.length > 0 || alignGuides.value.length > 0) {
          alignGuides.value = guides
        }
      } else if (alignGuides.value.length > 0) {
        alignGuides.value = []
      }
      effDx = targetLeadX - leadOrig.x
      effDy = targetLeadY - leadOrig.y
    } else if (alignGuides.value.length > 0) {
      alignGuides.value = []
    }

    let changed = false
    for (const id of ds.ids) {
      const orig = ds.origins[id]
      if (!orig) continue
      const nx = Math.round(orig.x + effDx)
      const ny = Math.round(orig.y + effDy)
      const prev = transientNodePos.value.get(id)
      const curX = prev ? prev.x : orig.x
      const curY = prev ? prev.y : orig.y
      if (curX !== nx || curY !== ny) {
        changed = true
        break
      }
    }
    if (changed) {
      const nextPos = new Map<string, { x: number; y: number }>()
      for (const id of ds.ids) {
        const orig = ds.origins[id]
        if (!orig) continue
        nextPos.set(id, {
          x: Math.round(orig.x + effDx),
          y: Math.round(orig.y + effDy)
        })
      }
      transientNodePos.value = nextPos
    }
    return
  }

  if (reconnectDrag.value) {
    const rd = reconnectDrag.value
    const targetNode = hitNode(p.x, p.y)
    const targetEdge = !targetNode ? hitEdgeMidpoint(p.x, p.y) : null
    if (targetNode && canReconnectToNode(rd, targetNode)) {
      const dx = targetNode.x - rd.fixedAnchorX
      const dy = targetNode.y - rd.fixedAnchorY
      const dist = Math.hypot(dx, dy) || 1
      const r = nodeRadius(targetNode) + (rd.end === 'to' ? 4 : 2)
      rd.pointerX = targetNode.x - (dx / dist) * r
      rd.pointerY = targetNode.y - (dy / dist) * r
      rd.hoverNodeId = targetNode.id
      rd.hoverEdgeId = ''
    } else if (targetEdge && canReconnectToEdge(rd, targetEdge)) {
      rd.pointerX = targetEdge.mid.x
      rd.pointerY = targetEdge.mid.y
      rd.hoverNodeId = ''
      rd.hoverEdgeId = targetEdge.edge.id
    } else {
      rd.pointerX = p.x
      rd.pointerY = p.y
      rd.hoverNodeId = ''
      rd.hoverEdgeId = ''
    }
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

function flushPendingPointerMove(): void {
  if (pointerRafId !== null) {
    cancelAnimationFrame(pointerRafId)
    pointerRafId = null
  }
  if (pendingPointer) {
    const pt = pendingPointer
    pendingPointer = null
    processPointerMove(pt.clientX, pt.clientY)
  }
}

function onPointerMove(ev: PointerEvent): void {
  if (
    !panState.value &&
    !bendDrag.value &&
    !groupResize.value &&
    !groupDrag.value &&
    !dragState.value &&
    !reconnectDrag.value &&
    !connectDrag.value &&
    !marquee.value
  ) {
    return
  }
  pendingPointer = { clientX: ev.clientX, clientY: ev.clientY }
  if (pointerRafId === null) {
    pointerRafId = requestAnimationFrame(() => {
      pointerRafId = null
      const pt = pendingPointer
      pendingPointer = null
      if (pt) {
        processPointerMove(pt.clientX, pt.clientY)
      }
    })
  }
}

function onSvgPointerLeave(ev: PointerEvent): void {
  if (activeCapturedPointerId !== null) return
  if (connectDrag.value?.sticky) return
  onPointerUp(ev)
}

function onPointerUp(ev: PointerEvent): void {
  flushPendingPointerMove()
  if (alignGuides.value.length > 0) alignGuides.value = []

  if (bendDrag.value) {
    const b = bendDrag.value
    const nextBend = transientEdgeBend.value.get(b.edgeId)
    bendDrag.value = null
    transientEdgeBend.value = EMPTY_EDGE_BEND_MAP
    if (nextBend !== undefined) {
      store.commitEdgeBend(b.edgeId, nextBend, b.key)
    }
  }

  if (groupDrag.value) {
    const gd = groupDrag.value
    const nextGrp = transientGroupRect.value.get(gd.groupId)
    const nextMembers = transientNodePos.value
    groupDrag.value = null
    transientGroupRect.value = EMPTY_GROUP_RECT_MAP
    transientNodePos.value = EMPTY_NODE_POS_MAP
    if (gd.moved && nextGrp) {
      store.commitGroupMove(gd.groupId, nextGrp.x, nextGrp.y, nextMembers, gd.key)
    }
  }

  if (groupResize.value) {
    const gr = groupResize.value
    const nextGrp = transientGroupRect.value.get(gr.groupId)
    groupResize.value = null
    transientGroupRect.value = EMPTY_GROUP_RECT_MAP
    if (gr.moved && nextGrp) {
      store.commitGroupResize(gr.groupId, nextGrp.width, nextGrp.height, gr.key)
    }
  }

  if (dragState.value) {
    const ds = dragState.value
    const nextPos = transientNodePos.value
    dragState.value = null
    transientNodePos.value = EMPTY_NODE_POS_MAP
    if (ds.moved && nextPos.size > 0) {
      store.commitNodePositions(nextPos, ds.key)
    }
  }

  if (reconnectDrag.value) {
    const rd = reconnectDrag.value
    const p = clientToWorld(ev.clientX, ev.clientY, true)
    const targetNode = hitNode(p.x, p.y)
    const targetEdge = !targetNode ? hitEdgeMidpoint(p.x, p.y) : null
    if (targetNode && canReconnectToNode(rd, targetNode)) {
      store.reconnectEdge(rd.edgeId, rd.end, { nodeId: targetNode.id })
    } else if (targetEdge && canReconnectToEdge(rd, targetEdge)) {
      store.reconnectEdge(rd.edgeId, 'to', { targetEdgeId: targetEdge.edge.id })
    }
    reconnectDrag.value = null
  }

  if (connectDrag.value) {
    const cd = connectDrag.value
    const p = clientToWorld(ev.clientX, ev.clientY, true)
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
      if (!target && !ev.shiftKey) store.select([])
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
      const selectedEdges = new Set<string>()
      for (const e of store.doc.value.edges) {
        if (!e.targetEdgeId && idSet.has(e.from) && idSet.has(e.to)) {
          selectedEdges.add(e.id)
        }
      }
      for (let pass = 0; pass < 5; pass++) {
        let added = false
        for (const e of store.doc.value.edges) {
          if (
            e.targetEdgeId &&
            !selectedEdges.has(e.id) &&
            idSet.has(e.from) &&
            selectedEdges.has(e.targetEdgeId)
          ) {
            selectedEdges.add(e.id)
            added = true
          }
        }
        if (!added) break
      }
      store.select(ids, Array.from(selectedEdges), m.additive)
    }
    marquee.value = null
  }
  panState.value = null
  releaseCanvasPointer()
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
  const gx = store.snapToGrid.value ? Math.round(cm.wx / 20) * 20 : Math.round(cm.wx)
  const gy = store.snapToGrid.value ? Math.round(cm.wy / 20) * 20 : Math.round(cm.wy)
  store.addNode(kind, gx, gy)
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
  const rect = svgRef.value?.getBoundingClientRect()
  if (!rect || (!visibleNodes.value.length && !visibleGroups.value.length)) return
  const b = computeMxDiagramBounds(store.doc.value, {
    padding: 48,
    minWidth: 200,
    minHeight: 160,
    displayFlows: store.displayFlows.value,
    flowHeatmap: store.flowHeatmap.value,
    showNodeLabels: store.showNodeLabels.value,
    compactEdgeFormulas: store.compactEdgeFormulas.value,
    edgeCumulativeFlows: store.edgeCumulativeFlows.value,
    nodeBottlenecks: store.nodeBottlenecks.value
  })
  const spanW = b.contentWidth + 96
  const spanH = b.contentHeight + 96
  const cx = (b.contentMinX + b.contentMaxX) / 2
  const cy = (b.contentMinY + b.contentMaxY) / 2
  const z = Math.max(0.18, Math.min(1.5, Math.min(rect.width / spanW, rect.height / spanH)))
  store.view.zoom = z
  store.view.x = rect.width / 2 - cx * z
  store.view.y = rect.height / 2 - cy * z
}

// ───────── 连线公式 & 节点名称 & 分组标题编辑 ─────────
function startEdgeEdit(id: string): void {
  const edge = store.doc.value.edges.find((e) => e.id === id)
  if (!edge) return
  edgeEdit.value = null
  store.openFormulaModal({ targetType: 'edge', edgeId: id, field: 'formula' })
}

function commitEdgeEdit(): void {
  const ed = edgeEdit.value
  if (!ed) return
  edgeEdit.value = null
  store.updateEdge(ed.id, { formula: ed.value.trim() })
}

const edgeEditInspection = computed(() => {
  const ed = edgeEdit.value
  if (!ed) return null
  const edge = store.doc.value.edges.find((x) => x.id === ed.id)
  if (!edge) return null
  return inspectMxFormulaContext(store.doc.value, ed.value, {
    contextKind: edge.kind,
    edgeId: edge.id,
    values: store.displayValues.value,
    step: store.playStep.value
  })
})

const edgeEditQuickCatalog = computed(() => {
  const insp = edgeEditInspection.value
  if (!insp) return []
  return insp.catalog
    .filter((it) => it.source === 'param' || it.source === 'state_input' || it.source === 'node')
    .slice(0, 8)
})

function edgeEditSourceTag(sym: MxFormulaSymbolRef): string {
  if (sym.source === 'param') return t('mx.formulaEditor.srcParam')
  if (sym.source === 'state_input') return t('mx.formulaEditor.srcStateIn')
  if (sym.source === 'node') {
    return sym.nodeKind === 'register'
      ? t('mx.formulaEditor.srcRegister')
      : t('mx.formulaEditor.srcPool')
  }
  if (sym.source === 'builtin_var') return t('mx.formulaEditor.srcBuiltin')
  return t('mx.formulaEditor.srcUnknown')
}

function edgeEditCatalogBadge(item: MxFormulaCatalogItem): string {
  if (item.source === 'param') return '(x)'
  if (item.source === 'state_input') return '╌►'
  if (item.source === 'node') return item.nodeKind === 'register' ? '[x]' : '◯'
  return 'fx'
}

function insertCanvasEdgeToken(insertText: string): void {
  const ed = edgeEdit.value
  if (!ed) return
  const el = edgeInputRef.value
  const cur = ed.value
  const start = el?.selectionStart ?? cur.length
  const end = el?.selectionEnd ?? cur.length
  const nextVal = cur.slice(0, start) + insertText + cur.slice(end)
  ed.value = nextVal
  const nextCaret = start + insertText.length
  void nextTick(() => {
    if (edgeInputRef.value) {
      edgeInputRef.value.focus()
      edgeInputRef.value.setSelectionRange(nextCaret, nextCaret)
    }
  })
}

function promoteCanvasUnknownParam(token: string): void {
  store.upsertParam(token, 1)
  void nextTick(() => {
    edgeInputRef.value?.focus()
  })
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
  if (isGroupLocked(grp)) return
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
        sub: `${e.from} → ${e.targetEdgeId ? `#${e.targetEdgeId}` : e.to}`,
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

const MINIMAP_SVG_W = 158
const MINIMAP_SVG_H = 92
const MINIMAP_ASPECT = MINIMAP_SVG_W / MINIMAP_SVG_H

interface MinimapEdgeItem {
  id: string
  path: string
  stroke: string
  strokeWidth: number
  opacity: number
  dasharray: string | undefined
  isEdgeTarget: boolean
  tx: number
  ty: number
}

const minimapEdges = computed<MinimapEdgeItem[]>(() => {
  const geos = edgeGeometries.value
  const nMap = nodeById.value
  const tNodes = transientNodePos.value
  const tBends = transientEdgeBend.value
  const selEdges = selectedEdgeSet.value
  const consumerEdges = consumerEdgeHitById.value
  const bridgeEdges = directConsumerBridgeEdgeIdSet.value
  const midByEdgeId = new Map<string, { x: number; y: number }>()
  const out: MinimapEdgeItem[] = []

  for (const geo of geos) {
    const e = geo.edge
    const a = nMap.get(e.from)
    if (!a) continue
    const ax = tNodes.get(a.id)?.x ?? a.x
    const ay = tNodes.get(a.id)?.y ?? a.y

    let bx = 0
    let by = 0
    let isEdgeTarget = false
    if (e.targetEdgeId) {
      const targetMid = midByEdgeId.get(e.targetEdgeId)
      if (!targetMid) continue
      bx = targetMid.x
      by = targetMid.y
      isEdgeTarget = true
    } else {
      const b = nMap.get(e.to)
      if (!b) continue
      bx = tNodes.get(b.id)?.x ?? b.x
      by = tNodes.get(b.id)?.y ?? b.y
    }

    const dx = bx - ax
    const dy = by - ay
    const len = Math.max(1, Math.hypot(dx, dy))
    const nx = -dy / len
    const ny = dx / len
    const defaultBend = isEdgeTarget
      ? Math.min(44, len * 0.12)
      : Math.hypot(geo.cx - (geo.sx + geo.ex) / 2, geo.cy - (geo.sy + geo.ey) / 2) > 0.5
        ? (geo.cx - (geo.sx + geo.ex) / 2) * nx + (geo.cy - (geo.sy + geo.ey) / 2) * ny
        : 0
    const bend = tBends.get(e.id) ?? e.bend ?? defaultBend
    const curved = Math.abs(bend) > 0.5
    const mcx = (ax + bx) / 2 + nx * bend
    const mcy = (ay + by) / 2 + ny * bend
    const path = curved
      ? `M ${ax},${ay} Q ${mcx},${mcy} ${bx},${by}`
      : `M ${ax},${ay} L ${bx},${by}`
    const midX = curved ? (ax + 2 * mcx + bx) / 4 : (ax + bx) / 2
    const midY = curved ? (ay + 2 * mcy + by) / 4 : (ay + by) / 2
    midByEdgeId.set(e.id, { x: midX, y: midY })

    const selected = selEdges.has(e.id)
    const condHighlight = !selected && (consumerEdges.has(e.id) || bridgeEdges.has(e.id))
    const stroke = selected ? '#3d8bfd' : condHighlight ? '#f59e0b' : geo.color
    const isState = e.kind === 'state'
    const strokeWidth = selected ? 2.2 : condHighlight ? 1.9 : isState ? 1.55 : 1.4
    const opacity = selected || condHighlight ? 1 : geo.dormant ? 0.38 : isState ? 0.9 : 0.72
    const dasharray = isState ? '3.5 2.5' : undefined

    out.push({
      id: e.id,
      path,
      stroke,
      strokeWidth,
      opacity,
      dasharray,
      isEdgeTarget,
      tx: bx,
      ty: by
    })
  }
  return out
})

const minimapEdgeTargetDots = computed(() => minimapEdges.value.filter((me) => me.isEdgeTarget))

let cachedMinimapDiagramBounds: ReturnType<typeof computeMxDiagramBounds> | null = null

const minimapBounds = computed(() => {
  const showLabels = store.showNodeLabels.value
  if (!isActiveGeometryDrag.value || !cachedMinimapDiagramBounds) {
    void store.docRevision.value
    cachedMinimapDiagramBounds = computeMxDiagramBounds(store.peekDoc(), {
      padding: 56,
      minWidth: 320,
      minHeight: 200,
      showNodeLabels: showLabels
    })
  }
  const b = cachedMinimapDiagramBounds
  const centerX = (b.contentMinX + b.contentMaxX) / 2
  const centerY = (b.contentMinY + b.contentMaxY) / 2
  let w = b.exportWidth
  let h = b.exportHeight
  if (w / h < MINIMAP_ASPECT) {
    w = h * MINIMAP_ASPECT
  } else {
    h = w / MINIMAP_ASPECT
  }
  const minX = centerX - w / 2
  const minY = centerY - h / 2
  const unit = w / MINIMAP_SVG_W
  const nodeR = Math.max(15, Math.min(26, unit * 2.8))
  const junctionR = Math.max(6, Math.min(14, unit * 1.7))
  const rect = cachedSvgRect ?? svgRef.value?.getBoundingClientRect()
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
    nodeR,
    junctionR,
    viewBox: `${minX} ${minY} ${w} ${h}`,
    vx,
    vy,
    vw,
    vh
  }
})

function panViewportFromMinimapClient(svg: SVGSVGElement, clientX: number, clientY: number): void {
  const rect = svg.getBoundingClientRect()
  const b = minimapBounds.value
  const rx = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
  const ry = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)))
  const wx = b.minX + rx * b.w
  const wy = b.minY + ry * b.h
  const mainRect = svgRef.value?.getBoundingClientRect()
  const cw = mainRect?.width ?? 800
  const ch = mainRect?.height ?? 480
  store.view.x = cw / 2 - wx * store.view.zoom
  store.view.y = ch / 2 - wy * store.view.zoom
}

function onMinimapPointerDown(ev: PointerEvent): void {
  const svg = ev.currentTarget as SVGSVGElement
  panViewportFromMinimapClient(svg, ev.clientX, ev.clientY)
  const onMove = (moveEv: PointerEvent): void => {
    panViewportFromMinimapClient(svg, moveEv.clientX, moveEv.clientY)
  }
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
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
    cancelActiveTransientDrag()
    store.deleteSelection()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'z') {
    cancelActiveTransientDrag()
    if (ev.shiftKey) store.redo()
    else store.undo()
    ev.preventDefault()
  } else if (mod && ev.key.toLowerCase() === 'y') {
    cancelActiveTransientDrag()
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
    const hadActiveInteraction =
      store.tool.value !== 'select' ||
      store.selection.nodes.length > 0 ||
      store.selection.edges.length > 0 ||
      isActiveGeometryDrag.value ||
      Boolean(connectDrag.value) ||
      Boolean(reconnectDrag.value) ||
      searchOpen.value
    cancelActiveTransientDrag()
    store.tool.value = 'select'
    store.select([])
    connectDrag.value = null
    reconnectDrag.value = null
    searchOpen.value = false
    closeMenus()
    if (hadActiveInteraction) {
      ev.preventDefault()
    }
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
  cancelActiveTransientDrag()
  store.isCanvasDragging.value = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (stateFlashTimer) {
    clearTimeout(stateFlashTimer)
    stateFlashTimer = null
  }
})

function resolveExportTheme(): 'dark' | 'light' {
  return resolvedCanvasTheme.value
}

function buildCleanDiagramSvg(): { svgText: string; width: number; height: number } {
  const rendered = exportMxDiagramSvg(store.doc.value, {
    theme: resolveExportTheme(),
    showGrid: true,
    padding: 56,
    minWidth: 640,
    minHeight: 420,
    displayValues: store.displayValues.value,
    displayFlows: store.displayFlows.value,
    flowHeatmap: store.flowHeatmap.value,
    showNodeLabels: store.showNodeLabels.value,
    compactEdgeFormulas: store.compactEdgeFormulas.value,
    edgeCumulativeFlows: store.edgeCumulativeFlows.value,
    nodeBottlenecks: store.nodeBottlenecks.value,
    playStep: store.playStep.value
  })
  return {
    svgText: rendered.svgText,
    width: rendered.width,
    height: rendered.height
  }
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function exportSvgDiagram(baseName = 'economy-diagram'): void {
  const built = buildCleanDiagramSvg()
  const blob = new Blob([built.svgText], { type: 'image/svg+xml;charset=utf-8' })
  triggerBlobDownload(blob, `${baseName}.svg`)
}

function exportPngDiagram(baseName = 'economy-diagram'): void {
  const built = buildCleanDiagramSvg()
  const maxCanvasSide = 8192
  const idealScale = Math.max(2, Math.min(3, window.devicePixelRatio || 2))
  const scale = Math.min(idealScale, maxCanvasSide / Math.max(1, built.width, built.height))
  const outWidth = Math.max(1, Math.round(built.width * scale))
  const outHeight = Math.max(1, Math.round(built.height * scale))

  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, outWidth, outHeight)
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return
      triggerBlobDownload(pngBlob, `${baseName}.png`)
    }, 'image/png')
  }
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.svgText)}`
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
  /* 默认跟随解析后的画布主题（theme-light / theme-dark） */
  --mx-canvas-bg: var(--graph-viewport-bg);
  --mx-grid-color: var(--wash-16);
  --mx-node-fill: var(--graph-node-bg);
  --mx-label-fg: var(--text);
  --mx-sub-bg: var(--bg-elevated);
  --mx-sub-fg: var(--text-muted);
  --mx-pill-bg: var(--graph-node-bg);
  --mx-pill-border: var(--border);
  --mx-pill-fg: var(--text);

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
  --mx-sub-bg: #f1f5f9;
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
.mx-edge.is-reconnecting {
  opacity: 0.25;
  pointer-events: none;
}
.mx-edge-endpoint {
  cursor: grab;
}
.mx-edge-endpoint:active {
  cursor: grabbing;
}
.mx-edge-endpoint .mx-ep-vis {
  transition:
    stroke-width 0.12s,
    filter 0.12s;
}
.mx-edge-endpoint:hover .mx-ep-vis {
  stroke-width: 2.6;
  filter: drop-shadow(0 0 5px var(--accent, #3d8bfd));
}
.mx-edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
}
.mx-edge-pill-bg {
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 12%, var(--mx-pill-bg, #1e232d));
  stroke: var(--edge-c, #3b82f6);
  stroke-width: 1.3;
  transition:
    stroke 0.12s,
    fill 0.12s,
    transform 0.12s;
}
.mx-canvas.is-light .mx-edge-pill-bg {
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 8%, var(--mx-pill-bg, #ffffff));
  stroke: var(--edge-c, #3b82f6);
}
.mx-edge-pill-bg.is-mod-active {
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 22%, var(--mx-pill-bg, #1e232d));
  stroke: var(--edge-c, #3b82f6);
  stroke-width: 1.65;
}
.mx-canvas.is-light .mx-edge-pill-bg.is-mod-active {
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 16%, var(--mx-pill-bg, #ffffff));
}
.mx-edge-pill-bg.is-state {
  stroke-dasharray: 3 2;
}
.mx-edge.is-dormant:not(:hover) .mx-edge-pill {
  opacity: 0.44;
}
.mx-edge.is-gated-off:not(:hover) .mx-edge-pill {
  opacity: 0.44;
}
.mx-edge-pill-bg.is-selected,
.mx-edge-pill-bg.is-drop {
  fill: color-mix(in srgb, var(--accent, #3d8bfd) 18%, var(--mx-pill-bg, #1e232d));
  stroke: var(--accent, #3d8bfd);
  stroke-width: 1.85;
}
.mx-canvas.is-light .mx-edge-pill-bg.is-selected,
.mx-canvas.is-light .mx-edge-pill-bg.is-drop {
  fill: color-mix(in srgb, var(--accent, #3d8bfd) 13%, var(--mx-pill-bg, #ffffff));
}
.mx-edge-pill-div {
  stroke: var(--edge-c, #3b82f6);
  stroke-width: 1.15;
  pointer-events: none;
}
.mx-edge-pill-div.is-selected {
  stroke: var(--accent, #3d8bfd);
}
.mx-edge-pill-div.is-cond-highlight {
  stroke: #f59e0b;
}
.mx-edge-label {
  font-size: 10.8px;
  font-family: var(--sans, system-ui, -apple-system, sans-serif);
  font-variant-numeric: tabular-nums;
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 72%, #ffffff);
  font-weight: 600;
  pointer-events: none;
}
.mx-edge-label.is-iv-num {
  font-size: 10.2px;
}
.mx-edge-label.is-compact-fx {
  letter-spacing: -0.01em;
}
.mx-edge-pill-bg.is-compact-fx {
  stroke-width: 1.45;
}
.mx-canvas.is-light .mx-edge-label {
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 84%, #0f172a);
}
.mx-edge-label.is-mod-active {
  font-weight: 700;
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 58%, #ffffff);
}
.mx-canvas.is-light .mx-edge-label.is-mod-active {
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 92%, #020617);
}
.mx-edge-label.is-selected {
  fill: #93c5fd;
}
.mx-canvas.is-light .mx-edge-label.is-selected {
  fill: #1d4ed8;
}
.mx-edge-caption {
  font-size: 10px;
  font-weight: 600;
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 76%, #ffffff);
  pointer-events: none;
}
.mx-canvas.is-light .mx-edge-caption {
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 84%, #0f172a);
}
.mx-edge-caption.is-selected {
  fill: var(--accent, #3d8bfd);
}
.mx-edge-hourglass {
  stroke: color-mix(in srgb, var(--edge-c, #3b82f6) 72%, #ffffff);
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 72%, #ffffff);
  pointer-events: none;
}
.mx-canvas.is-light .mx-edge-hourglass {
  stroke: color-mix(in srgb, var(--edge-c, #3b82f6) 84%, #0f172a);
  fill: color-mix(in srgb, var(--edge-c, #3b82f6) 84%, #0f172a);
}
.mx-edge-hourglass.is-selected {
  stroke: #93c5fd;
  fill: #93c5fd;
}
.mx-canvas.is-light .mx-edge-hourglass.is-selected {
  stroke: #1d4ed8;
  fill: #1d4ed8;
}
.mx-edge-hourglass.is-cond-highlight {
  stroke: #f59e0b;
  fill: #f59e0b;
}

@keyframes mxStateFlashGlow {
  0% {
    stroke-opacity: 0;
  }
  15% {
    stroke-opacity: 0.55;
  }
  32% {
    stroke-opacity: 0.08;
  }
  50% {
    stroke-opacity: 0.55;
  }
  67% {
    stroke-opacity: 0.08;
  }
  84% {
    stroke-opacity: 0.55;
  }
  100% {
    stroke-opacity: 0;
  }
}

@keyframes mxStateFlashCore {
  0% {
    stroke-opacity: 0;
  }
  15% {
    stroke-opacity: 0.95;
  }
  32% {
    stroke-opacity: 0.12;
  }
  50% {
    stroke-opacity: 0.95;
  }
  67% {
    stroke-opacity: 0.12;
  }
  84% {
    stroke-opacity: 0.95;
  }
  100% {
    stroke-opacity: 0;
  }
}

.mx-state-flash-glow {
  animation: mxStateFlashGlow 0.66s ease-in-out 1 forwards;
}

.mx-state-flash-core {
  animation: mxStateFlashCore 0.66s ease-in-out 1 forwards;
}

.mx-state-flash-pill {
  pointer-events: none;
  animation: mxStateFlashCore 0.66s ease-in-out 1 forwards;
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
.mx-node.is-runtime-interactive {
  cursor: pointer;
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
.mx-delta-badge,
.mx-bottleneck-badge {
  cursor: help;
}
.mx-delta-badge:hover rect,
.mx-bottleneck-badge:hover rect {
  stroke: #ffffff;
  stroke-width: 1.4;
  filter: drop-shadow(0 2px 5px rgba(0, 0, 0, 0.45));
}
.mx-badge-hover-tip {
  position: absolute;
  transform: translate(-50%, -100%) translateY(-8px);
  z-index: 38;
  pointer-events: none;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);
  color: var(--text);
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.mx-badge-hover-tip.tone-pos {
  border-color: rgba(22, 163, 74, 0.65);
}
.mx-badge-hover-tip.tone-neg {
  border-color: rgba(220, 38, 38, 0.65);
}
.mx-badge-hover-tip.tone-warn {
  border-color: rgba(217, 119, 6, 0.65);
}
.mx-bht-title {
  font-size: 11.5px;
  font-weight: 700;
  line-height: 1.3;
}
.mx-badge-hover-tip.tone-pos .mx-bht-title {
  color: #4ade80;
}
.mx-badge-hover-tip.tone-neg .mx-bht-title {
  color: #f87171;
}
.mx-badge-hover-tip.tone-warn .mx-bht-title {
  color: #fbbf24;
}
.mx-bht-detail {
  font-size: 10.5px;
  color: var(--text-muted);
  font-family: var(--mono, ui-monospace, monospace);
  line-height: 1.3;
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
.mx-node-label.is-ref {
  fill: #fffbeb;
  paint-order: stroke;
  stroke: #d97706;
  stroke-width: 6px;
  stroke-linejoin: round;
}
@keyframes mxFormulaRefDash {
  to {
    stroke-dashoffset: -18;
  }
}
.mx-formula-ref-halo {
  stroke: #f59e0b;
  stroke-width: 2;
  stroke-dasharray: 4.5 3.5;
  filter: drop-shadow(0 0 4px rgba(245, 158, 11, 0.45));
}
.mx-formula-ref-glow {
  stroke: rgba(245, 158, 11, 0.22);
  stroke-width: 5.5;
  stroke-linecap: round;
}
.mx-formula-ref-line {
  stroke: #f59e0b;
  stroke-width: 2;
  stroke-dasharray: 5 4;
  stroke-linecap: round;
  animation: mxFormulaRefDash 0.85s linear infinite;
}
.mx-formula-ref-tag-bg {
  fill: var(--mx-pill-bg, #1e232d);
  stroke: #f59e0b;
  stroke-width: 1.25;
}
.mx-formula-ref-tag-text {
  fill: color-mix(in srgb, #f59e0b 76%, var(--mx-pill-fg));
  font-size: 9.5px;
  font-weight: 700;
  font-family: var(--mono, ui-monospace, monospace);
}
.mx-edge-cond-glow {
  stroke: rgba(245, 158, 11, 0.34);
  stroke-width: 6;
  stroke-linecap: round;
  pointer-events: none;
}
.mx-edge-pill-bg.is-cond-highlight {
  fill: color-mix(in srgb, #f59e0b 24%, var(--mx-pill-bg));
  stroke: #f59e0b;
  stroke-width: 1.9;
  filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.42));
}
.mx-edge-label.is-cond-highlight {
  fill: color-mix(in srgb, #f59e0b 55%, var(--mx-pill-fg));
  font-weight: 700;
}
.mx-canvas.is-light .mx-edge-label.is-cond-highlight,
.mx-canvas.is-light .mx-node-sub.is-cond-highlight {
  fill: #92400e;
}
.mx-cond-consumer-halo {
  fill: rgba(245, 158, 11, 0.12);
  stroke: #f59e0b;
  stroke-width: 2;
  stroke-dasharray: 4.5 3.5;
  filter: drop-shadow(0 0 5px rgba(245, 158, 11, 0.5));
  pointer-events: none;
}
.mx-node-sub-pill {
  fill: var(--mx-sub-bg);
  stroke: var(--mx-pill-border);
  stroke-width: 0.8;
}
.mx-node-sub-pill.is-cond-highlight {
  fill: color-mix(in srgb, #f59e0b 26%, var(--mx-pill-bg, #1e232d));
  stroke: #f59e0b;
  stroke-width: 1.5;
  filter: drop-shadow(0 0 5px rgba(245, 158, 11, 0.42));
}
.mx-node-sub {
  font-size: 9px;
  fill: var(--mx-sub-fg);
  font-family: var(--mono, ui-monospace, monospace);
  pointer-events: none;
}
.mx-node-sub.is-cond-highlight {
  fill: color-mix(in srgb, #f59e0b 55%, var(--mx-pill-fg));
  font-weight: 700;
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
  color: var(--text-muted, #9aa0a6);
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.14s ease,
    background 0.14s ease,
    box-shadow 0.14s ease;
}
.mx-viewbar button:hover:not(:disabled) {
  color: var(--text, #e8eaed);
  background: var(--bg-hover);
}
.mx-viewbar button.is-on,
.mx-viewbar button.is-on:hover:not(:disabled) {
  color: var(--accent, #3d8bfd);
  background: var(--accent-18, rgba(61, 139, 253, 0.2));
  box-shadow: inset 0 0 0 1.25px var(--accent, #3d8bfd);
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
.mx-fx-toggle-glyph {
  font-family: Georgia, 'Times New Roman', serif;
  font-style: italic;
  font-weight: 700;
  font-size: 13px;
  letter-spacing: -0.03em;
  line-height: 1;
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
  color: color-mix(in srgb, #d97706 78%, var(--text));
}
.mx-nf-btn.is-state {
  color: color-mix(in srgb, #0284c7 78%, var(--text));
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
.mx-edge-edit-wrap {
  position: absolute;
  transform: translate(-50%, -16px);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}
.mx-edge-edit-bar {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px 3px 3px;
  border: 1.5px solid var(--accent);
  border-radius: 12px;
  background: var(--bg-input, var(--bg-panel));
  box-shadow: 0 6px 18px var(--shadow, rgba(0, 0, 0, 0.35));
}
.mx-edge-formula-input {
  width: 156px;
  padding: 2px 7px;
  border: none;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-family: var(--mono, ui-monospace, monospace);
  outline: none;
}
.mx-edge-edit-preview {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  font-family: var(--mono, ui-monospace, monospace);
  background: rgba(16, 185, 129, 0.15);
  color: color-mix(in srgb, #10b981 78%, var(--text));
  white-space: nowrap;
}
.mx-edge-edit-preview.is-dice {
  background: rgba(244, 63, 94, 0.15);
  color: color-mix(in srgb, #f43f5e 78%, var(--text));
}
.mx-edge-edit-pop {
  min-width: 220px;
  max-width: 320px;
  padding: 6px 8px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  box-shadow: 0 10px 26px var(--shadow, rgba(0, 0, 0, 0.35));
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.mx-edge-edit-syms {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mx-edge-sym-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  font-family: var(--mono, ui-monospace, monospace);
  background: rgba(148, 163, 184, 0.12);
  color: var(--text);
}
.mx-edge-sym-tag b {
  font-weight: 700;
  opacity: 0.9;
}
.mx-edge-sym-tag em {
  font-style: normal;
  opacity: 0.82;
}
.mx-edge-sym-tag.src-param {
  background: rgba(168, 85, 247, 0.16);
  color: color-mix(in srgb, #9333ea 78%, var(--text));
}
.mx-edge-sym-tag.src-node {
  background: rgba(59, 130, 246, 0.16);
  color: color-mix(in srgb, #2563eb 78%, var(--text));
}
.mx-edge-sym-tag.src-state_input {
  background: rgba(14, 165, 233, 0.16);
  color: color-mix(in srgb, #0284c7 78%, var(--text));
}
.mx-edge-sym-tag.src-unknown {
  background: rgba(245, 158, 11, 0.18);
  color: color-mix(in srgb, #d97706 78%, var(--text));
}
.mx-edge-sym-add {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid rgba(245, 158, 11, 0.5);
  background: rgba(245, 158, 11, 0.2);
  color: color-mix(in srgb, #d97706 78%, var(--text));
  font-size: 10px;
  cursor: pointer;
}
.mx-edge-edit-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--border);
}
.mx-edge-qchip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
  font-size: 10.5px;
  font-family: var(--mono, ui-monospace, monospace);
  cursor: pointer;
}
.mx-edge-qchip:hover {
  border-color: var(--accent);
}
.mx-edge-qbadge {
  color: var(--accent, #3d8bfd);
  font-weight: 800;
}
.mx-edge-qchip em {
  font-style: normal;
  opacity: 0.72;
}
.mx-hint {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 14px;
  background: var(--panel-glass, var(--bg-panel));
  border: 1px solid var(--border);
  color: var(--text, #e8eaed);
  border-radius: 999px;
  font-size: 11px;
  box-shadow: 0 4px 16px var(--shadow, rgba(0, 0, 0, 0.3));
  backdrop-filter: blur(8px);
  pointer-events: none;
}

/* 子系统分组框 (Subsystem Group Frames) */
.mx-group-bg {
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
  pointer-events: none;
}
.mx-group-hdr {
  cursor: move;
}
.mx-group.is-locked .mx-group-hdr {
  cursor: default;
}
.mx-group-title {
  font-size: 11.5px;
  font-weight: 700;
  fill: var(--mx-label-fg);
  cursor: move;
}
.mx-group.is-locked .mx-group-title {
  cursor: default;
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
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted, #9aa0a6);
  line-height: 1;
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

/* 拖拽期间禁用高开销 SVG drop-shadow 光栅化滤镜、过渡插值与虚线重绘动画，确保 60fps 丝滑跟随 */
.mx-svg.is-dragging .mx-node.fired path,
.mx-svg.is-dragging .mx-formula-ref-halo,
.mx-svg.is-dragging .mx-edge-pill-bg.is-cond-highlight,
.mx-svg.is-dragging .mx-cond-consumer-halo,
.mx-svg.is-dragging .mx-node-sub-pill.is-cond-highlight,
.mx-svg.is-dragging .mx-edge-endpoint .mx-ep-vis {
  filter: none !important;
}
.mx-svg.is-dragging .mx-edge-pill-bg,
.mx-svg.is-dragging .mx-reg-step-btn circle,
.mx-svg.is-dragging .mx-port-dot .mx-port-vis {
  transition: none !important;
}
.mx-svg.is-dragging .mx-formula-ref-line {
  animation: none !important;
}
</style>
