/**
 * Human-readable Video Breakdown & Remake Report (`report.md`) & SRT Subtitle Exporter.
 *
 * Follows `rea-video/report.py` reading order:
 *   1. Verdict & Production Mix
 *   2. Content, Hook & Script
 *   3. Cast, Scenes & Props (`@图片` reference locking guide)
 *   4. Sound & Probabilistic Source Attribution
 *   5. Camera, Lighting & Color Grade
 *   6. Vertical Packaging & Embedded Real Material
 *   7. Multi-Route Remake Plan (`G1..Gk`, `S1..Sk`, `C1..Ck`, `K1..Kk`)
 *   8. Shot-by-Shot Forensic Table & Open Questions
 */
import { formatAiEditLabel } from './reaClassify'
import { PRODUCTION_LABEL_META, type BreakdownLang } from './reaTypes'
import type { SemanticTimeline } from './types'

function escCell(val: unknown): string {
  const s = String(val ?? '—').trim()
  return (s || '—').replace(/\|/g, '／').replace(/\r?\n/g, ' ')
}

function mdTable(headers: string[], rows: string[][]): string[] {
  if (!rows.length) return []
  return [
    `| ${headers.map(escCell).join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(escCell).join(' | ')} |`)
  ]
}

function fmtSpan(start: number, end: number): string {
  return `${start.toFixed(1)}–${end.toFixed(1)}s`
}

function fmtFps(fps: number): string {
  if (!Number.isFinite(fps) || fps <= 0) return '30'
  return String(Number(fps.toFixed(2)))
}

function srtTimestamp(sec: number): string {
  const totalMs = Math.max(0, Math.round(sec * 1000))
  const ms = totalMs % 1000
  const s = Math.floor(totalMs / 1000) % 60
  const m = Math.floor(totalMs / 60000) % 60
  const h = Math.floor(totalMs / 3600000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

/** Export timeline dialogue / subtitle layers as standard `.srt` text. */
export function exportTimelineSubtitlesSrt(doc: SemanticTimeline): string {
  const lines = (doc.dialogue ?? [])
    .filter((d) => d.text?.trim())
    .map((d) => ({ start: d.range.start, end: d.range.end, text: d.text.trim() }))

  if (lines.length === 0) {
    for (const s of doc.shots ?? []) {
      if (s.removed) continue
      for (const l of s.layers ?? []) {
        if ((l.kind === 'subtitle' || l.kind === 'huazi') && l.text?.trim()) {
          lines.push({ start: l.start, end: l.end, text: l.text.trim() })
        }
      }
    }
  }

  lines.sort((a, b) => a.start - b.start)
  return lines
    .map(
      (item, idx) =>
        `${idx + 1}\n${srtTimestamp(item.start)} --> ${srtTimestamp(Math.max(item.start + 0.2, item.end))}\n${item.text}\n`
    )
    .join('\n')
}

export function renderBreakdownReportMd(doc: SemanticTimeline, lang: BreakdownLang = 'zh'): string {
  const b = doc.breakdown
  const shots = (doc.shots ?? []).filter((s) => !s.removed)
  const isEn = lang === 'en'
  const L: string[] = []

  L.push(
    isEn
      ? `# Video Reverse-Engineering & Remake Report (${doc.id})`
      : `# 视频逆向拆解与复刻报告（${doc.id}）` // cjk-ok
  )
  L.push('')

  if (!b) {
    const fpsLabel = fmtFps(doc.source.fps)
    L.push(
      isEn
        ? `> Duration: ${doc.source.duration.toFixed(1)}s · ${doc.source.width}×${doc.source.height} · ${fpsLabel}fps · Shots: ${shots.length}`
        : `> 时长：${doc.source.duration.toFixed(1)}s · ${doc.source.width}×${doc.source.height} · ${fpsLabel}fps · 镜头数：${shots.length}` // cjk-ok
    )
    return L.join('\n')
  }

  const s = b.summary
  const fpsLabel = fmtFps(doc.source.fps)
  L.push(
    isEn ? `**Verdict**: ${s.verdictEn}` : `**拆解结论**：${s.verdict}` // cjk-ok
  )
  L.push('')
  const transStr =
    Object.entries(s.transitions)
      .map(([k, v]) => `${k}×${v}`)
      .join(', ') || '—'
  L.push(
    isEn
      ? `- **Specs**: ${doc.source.duration.toFixed(1)}s · ${doc.source.width}×${doc.source.height} · ${fpsLabel}fps · ${s.shotCount} shots (avg ${s.avgShotSec}s) · Transitions: ${transStr}`
      : `- **基础规格**：${doc.source.duration.toFixed(1)}s · ${doc.source.width}×${doc.source.height} · ${fpsLabel}fps · 共 ${s.shotCount} 镜（平均 ${s.avgShotSec}s）· 转场：${transStr}` // cjk-ok
  )
  L.push(
    isEn
      ? `- **Confidence**: ${Math.round(s.confidence * 100)}% (decided by: \`${s.decidedBy}\`)`
      : `- **综合置信度**：${Math.round(s.confidence * 100)}%（判定方式：\`${s.decidedBy}\`）` // cjk-ok
  )
  L.push(
    isEn
      ? `- **Remake Summary**: ${b.productionPlan.summaryEn}`
      : `- **复刻路径概览**：${b.productionPlan.summaryZh}` // cjk-ok
  )
  if (b.provenance.evidence.length > 0) {
    L.push(
      isEn
        ? `- **Container Provenance**: ${b.provenance.evidence.join('; ')}`
        : `- **容器溯源线索**：${b.provenance.evidence.join('；')}` // cjk-ok
    )
  }
  const openQs = b.wholeVideo?.openQuestions ?? []
  if (openQs.length > 0) {
    L.push(
      isEn
        ? `- **Open Questions (${openQs.length})**: ${openQs[0]}`
        : `- **待确认项（${openQs.length} 处）**：${openQs[0]}` // cjk-ok
    )
  }
  L.push('')

  if (s.productionMix.length > 0) {
    L.push(
      ...mdTable(
        isEn ? ['Base Production Type', 'Duration', 'Share'] : ['底层画面类型', '时长', '占比'], // cjk-ok
        s.productionMix.map((m) => [
          isEn ? m.labelEn : m.labelZh,
          `${m.seconds.toFixed(1)}s`,
          `${Math.round(m.ratio * 100)}%`
        ])
      )
    )
    L.push('')
  }

  // 2. Content & Script
  const w = b.wholeVideo
  L.push(isEn ? '## 1. Structure & Script' : '## 一、内容结构与台词脚本') // cjk-ok
  L.push('')
  if (w?.summary) L.push(isEn ? `- **Summary**: ${w.summary}` : `- **内容概括**：${w.summary}`) // cjk-ok
  if (w?.hook) L.push(isEn ? `- **Opening Hook**: ${w.hook}` : `- **黄金钩子**：${w.hook}`) // cjk-ok
  if (w?.segments?.length) {
    L.push('')
    L.push(
      ...mdTable(
        isEn ? ['Span', 'Beat', 'Copy', 'Audio'] : ['时间段', '段落作用', '核心文案', '声音设计'], // cjk-ok
        w.segments.map((sg) => [
          fmtSpan(sg.start, sg.end),
          sg.beat,
          sg.copy ?? '—',
          sg.audio ?? '—'
        ])
      )
    )
  }
  if ((doc.dialogue ?? []).length > 0) {
    L.push('')
    L.push(
      ...mdTable(
        isEn ? ['Time', 'Speaker', 'Line'] : ['时间', '说话人', '台词 / 旁白'], // cjk-ok
        (doc.dialogue ?? []).map((d) => [
          fmtSpan(d.range.start, d.range.end),
          d.speaker || (isEn ? 'Narrator' : '旁白'), // cjk-ok
          d.text
        ])
      )
    )
  }
  L.push('')

  // 3. Cast, Scenes & Props
  const cast = w?.cast
  if (cast && (cast.characters.length || cast.scenes.length || cast.props.length)) {
    L.push(
      isEn ? '## 2. Cast, Scenes & Reference Assets' : '## 二、角色、场景与参考资产锁定' // cjk-ok
    )
    L.push('')
    if (cast.characters.length) {
      L.push(
        ...mdTable(
          isEn
            ? ['Ref', 'Name', 'Consistent Appearance', 'Shots']
            : ['参考槽位', '角色名', '统一外观描述（写入首帧提示词）', '出场镜头'], // cjk-ok
          cast.characters.map((c) => [c.refTag, c.name, c.look, c.shotIds.join(', ')])
        )
      )
      L.push('')
    }
    if (cast.props.length) {
      L.push(
        ...mdTable(
          isEn
            ? ['Ref', 'Prop / Product', 'Real Asset?', 'Note']
            : ['参考槽位', '道具/商品', '需真实素材', '说明'], // cjk-ok
          cast.props.map((p) => [
            p.refTag ?? '—',
            p.name,
            p.realMaterial ? (isEn ? 'Yes' : '是') : isEn ? 'No' : '否', // cjk-ok
            p.note ?? '—'
          ])
        )
      )
      L.push('')
    }
  }

  // 4. Audio Forensics
  const aud = b.audioAnalysis
  if (aud) {
    L.push(isEn ? '## 3. Sound & Source Forensics' : '## 三、多轨声音与来源取证') // cjk-ok
    L.push('')
    if (!aud.hasAudio) {
      L.push(isEn ? '- Silent video (no audio stream).' : '- 无音轨（静音视频）。') // cjk-ok
    } else {
      if (aud.rmsDbfs != null) {
        L.push(
          isEn
            ? `- **Loudness**: ${aud.rmsDbfs.toFixed(1)} dBFS RMS (peak ${aud.peakDbfs?.toFixed(1) ?? '—'} dBFS)`
            : `- **响度指标**：均值 ${aud.rmsDbfs.toFixed(1)} dBFS，峰值 ${aud.peakDbfs?.toFixed(1) ?? '—'} dBFS` // cjk-ok
        )
      }
      if (aud.perClipAudio) {
        L.push(
          aud.perClipAudio.resetsAtCuts
            ? isEn
              ? `- **Cut Continuity**: Background jumps ${aud.perClipAudio.atCutsDb.toFixed(1)}dB at cuts vs ${aud.perClipAudio.withinShotsDb.toFixed(1)}dB within shots -> per-clip native audio`
              : `- **切点连续性**：切镜处底噪跳变 ${aud.perClipAudio.atCutsDb.toFixed(1)}dB（镜内 ${aud.perClipAudio.withinShotsDb.toFixed(1)}dB）→ 画面片段自带原生音频特征` // cjk-ok
            : isEn
              ? `- **Cut Continuity**: Continuous bed across cuts (${aud.perClipAudio.atCutsDb.toFixed(1)}dB vs ${aud.perClipAudio.withinShotsDb.toFixed(1)}dB) -> post-laid audio track`
              : `- **切点连续性**：声音跨切镜连续（切点 ${aud.perClipAudio.atCutsDb.toFixed(1)}dB vs 镜内 ${aud.perClipAudio.withinShotsDb.toFixed(1)}dB）→ 后期整轨铺设` // cjk-ok
        )
      }
      if (aud.soundSources) {
        L.push(
          isEn
            ? `- **Source Attribution**: ${aud.soundSources.summaryEn}`
            : `- **声源判定**：${aud.soundSources.summaryZh}` // cjk-ok
        )
      }
      if (aud.music.present) {
        const musicBits = [
          aud.music.bpm ? `${aud.music.bpm} BPM` : '',
          aud.music.key ?? '',
          aud.music.beatSyncedCutRatio != null
            ? isEn
              ? `beat-synced cuts ${Math.round(aud.music.beatSyncedCutRatio * 100)}%`
              : `卡点率 ${Math.round(aud.music.beatSyncedCutRatio * 100)}%` // cjk-ok
            : ''
        ].filter(Boolean)
        if (musicBits.length) {
          L.push(
            isEn
              ? `- **Music Metrics**: ${musicBits.join(' · ')}`
              : `- **配乐节拍与调性**：${musicBits.join(' · ')}` // cjk-ok
          )
        }
      }
    }
    L.push('')
  }

  // 5. Remake Production Plan
  const plan = b.productionPlan
  L.push(isEn ? '## 4. Multi-Route Remake Plan' : '## 四、分流复刻执行方案') // cjk-ok
  L.push('')
  if (plan.units.length > 0) {
    L.push(
      isEn ? '### AI Generation Units (`G1..Gk`)' : '### 1) AI 视频生成单元（`G1..Gk` 同场景合并）' // cjk-ok
    )
    L.push('')
    for (const u of plan.units) {
      L.push(
        `- **${u.id}** (${u.shotIds.join(', ')} · ${u.durationSec}s · \`${u.conditioningMode}\`${u.referenceTags.length ? ` · ${u.referenceTags.join(' ')}` : ''})`
      )
      L.push(
        isEn
          ? `  - **First-Frame Prompt**: ${u.imagePrompt}`
          : `  - **首帧图提示词**：${u.imagePrompt}` // cjk-ok
      )
      L.push(
        isEn ? `  - **Video Prompt**: ${u.videoPrompt}` : `  - **视频动作提示词**：${u.videoPrompt}` // cjk-ok
      )
    }
    L.push('')
  }
  if (plan.localUnits.length > 0) {
    L.push(
      isEn
        ? '### Zero-Cost Local FFmpeg Units (`K1..Kk`)'
        : '### 2) 本地 FFmpeg 零成本推拉/静帧单元（`K1..Kk`）' // cjk-ok
    )
    L.push('')
    L.push(
      ...mdTable(
        isEn
          ? ['Unit', 'Shot', 'Mode', 'Duration', 'Zoom/s', 'Pan/s']
          : ['单元', '镜头', '模式', '时长', '每秒缩放', '每秒平移'], // cjk-ok
        plan.localUnits.map((k) => [
          k.id,
          k.shotId,
          k.mode === 'ken_burns' ? 'Ken Burns' : 'Static Hold',
          `${k.durationSec}s`,
          `${(k.zoomPerSec * 100).toFixed(1)}%`,
          `${(k.panPxPerSec * 100).toFixed(1)}%`
        ])
      )
    )
    L.push('')
  }
  if (plan.shootingSetups.length > 0) {
    L.push(
      isEn ? '### Live-Action Shooting Setups (`S1..Sk`)' : '### 3) 实拍机位与布光方案（`S1..Sk`）' // cjk-ok
    )
    L.push('')
    for (const st of plan.shootingSetups) {
      L.push(
        `- **${st.id}** (${st.shotIds.join(', ')}) — ${[st.sceneLabel, st.shotSize, st.lightingSetup].filter(Boolean).join(' · ')}`
      )
      if (st.gear.length) {
        L.push(
          isEn ? `  - **Gear**: ${st.gear.join('; ')}` : `  - **建议器材**：${st.gear.join('；')}` // cjk-ok
        )
      }
    }
    L.push('')
  }
  if (plan.codeSpecs.length > 0) {
    L.push(
      isEn ? '### Code / Template Render Specs (`C1..Ck`)' : '### 4) 代码与动效模板规范（`C1..Ck`）' // cjk-ok
    )
    L.push('')
    for (const c of plan.codeSpecs) {
      L.push(
        `- **${c.id}** (\`${c.codeStyle}\`, ${c.durationSec}s, shots: ${c.shotIds.join(', ')}) — ${isEn ? c.recipeEn : c.recipeZh}`
      )
      if (c.palette.length) L.push(`  - Palette: \`${c.palette.join(', ')}\``)
    }
    L.push('')
  }
  if (plan.userAssetsNeeded.length > 0) {
    L.push(
      isEn
        ? '### Embedded Real Assets Required (Cannot Be AI-Faked)'
        : '### 5) 需准备的真实素材清单（不可由生成模型伪造）' // cjk-ok
    )
    L.push('')
    for (const ua of plan.userAssetsNeeded) {
      L.push(`- **${ua.shotId}** [${ua.kind}]: ${ua.description}`)
    }
    L.push('')
  }

  // 6. Shot-by-Shot Forensic Table
  L.push(isEn ? '## 5. Shot-by-Shot Breakdown' : '## 五、逐镜取证与路由明细') // cjk-ok
  L.push('')
  L.push(
    ...mdTable(
      isEn
        ? ['#', 'Span', 'Base Type', 'Conf', 'Route', 'Key Evidence']
        : ['#', '时间', '底层类型', '置信度', '复刻路由', '核心证据'], // cjk-ok
      shots.map((sh, idx) => {
        const lbl = sh.base?.label ?? 'live_action'
        const meta = PRODUCTION_LABEL_META[lbl]
        const edits = (sh.base?.aiEdits ?? [])
          .map((e) => `+${formatAiEditLabel(e.kind, lang)}`)
          .join('')
        return [
          `#${idx + 1}`,
          fmtSpan(sh.range.start, sh.range.end),
          `${isEn ? meta.shortEn : meta.shortZh}${edits}`,
          `${Math.round((sh.base?.confidence ?? 0.6) * 100)}%`,
          [sh.replication?.executor, sh.replication?.unitId].filter(Boolean).join(' · '),
          (sh.base?.evidence ?? []).slice(0, 2).join('; ')
        ]
      })
    )
  )
  L.push('')

  if (openQs.length > 0) {
    L.push(isEn ? '## 6. Open Questions' : '## 六、待确认与不确定点') // cjk-ok
    L.push('')
    for (const q of openQs) L.push(`- ${q}`)
    L.push('')
  }

  return L.join('\n')
}
