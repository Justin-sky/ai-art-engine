/**
 * Builds the `.d.ts` injected into Monaco for the script node editor.
 *
 * Only declares the capabilities that are currently enabled, so the completion list
 * matches what the node can actually call: a method only appears on `om.` once its
 * capability is checked, mirroring the executor whitelist (see scriptRun.ts).
 */
import { ref } from 'vue'
import type { GraphDocument, ScriptCapability, ScriptPortDecl } from '@shared/graph'

const GRAPH_VALUE_DTS = `
/** A graph value passed between nodes (discriminated by kind; common fields below, other provider fields read as needed). */
type GraphValue =
  | { kind: 'text'; text: string }
  | { kind: 'texts'; items: Array<{ text: string; relativePath?: string }> }
  | { kind: 'image'; dataUrl?: string; relativePath?: string; id?: string }
  | { kind: 'video'; relativePath?: string; dataUrl?: string; id?: string }
  | { kind: 'images'; items: Array<{ dataUrl?: string; relativePath?: string }> }
  | { kind: string; [k: string]: unknown }

/** Sandbox console logger: captured in the node's Console panel and forwarded to task logs. */
declare const console: {
  log(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}
`

/** Capability name -> signature (for display; loose params, follow the docs). */
const CAPABILITY_SIGNATURES: Record<ScriptCapability, string> = {
  generateText:
    'generateText(input: { prompt: string; system?: string; model?: string; images?: string[] }): Promise<{ text: string; model: string }>',
  generateImage:
    'generateImage(input: { prompt: string; model?: string; n?: number; aspectRatio?: string; inputReferences?: string[] }): Promise<{ images: string[]; model: string }>',
  generateVideo:
    'generateVideo(input: { prompt: string; model?: string; duration?: number; firstFrameImageUrl?: string }): Promise<{ assetId: string; relativePath: string; model: string }>',
  generateSpeech:
    'generateSpeech(input: { input: string; model?: string; voice?: string; name?: string }): Promise<{ assetId?: string; relativePath?: string; model: string }>',
  resolveAssetImageUrl: 'resolveAssetImageUrl(assetId: string): Promise<string | null>',
  readProjectImageDataUrl: 'readProjectImageDataUrl(relativePath: string): Promise<string | null>',
  saveMedia:
    'saveMedia(input: { dataUrl: string; key?: string; outputDir?: string }): Promise<string /* project-relative path */>',
  log: 'log(input: { message: string; level?: "info" | "warn" | "error" }): Promise<null>'
}

function portsType(ports: ScriptPortDecl[]): string {
  if (!ports.length) return 'Record<string, GraphValue[]>'
  const lines = ports.map((p) => `    ${JSON.stringify(p.id)}?: GraphValue[]`)
  return `{\n${lines.join('\n')}\n  }`
}

/** Build the global declaration text injected into Monaco. */
export function buildScriptNodeTypings(input: {
  inputs: ScriptPortDecl[]
  outputs: ScriptPortDecl[]
  capabilities: ScriptCapability[]
}): string {
  const omMembers = input.capabilities
    .filter((c) => CAPABILITY_SIGNATURES[c])
    .map((c) => `  ${CAPABILITY_SIGNATURES[c]}`)
    .join('\n')
  const outputKeys = input.outputs.length
    ? input.outputs.map((p) => `  ${JSON.stringify(p.id)}?: GraphValue`).join('\n')
    : '  [portId: string]: GraphValue'
  return `${GRAPH_VALUE_DTS}
interface ScriptInputs ${portsType(input.inputs)}

interface ScriptOm {
${omMembers || '  // No capabilities enabled yet: check one under "Capabilities" and the matching method appears on om.'}
}

interface ScriptArgs {
  /** Snapshot of each upstream input port value. */
  inputs: ScriptInputs
  /** Declared governed capabilities (all go through the app provider / quota / log). */
  om: ScriptOm
  signal: { readonly aborted: boolean }
}

interface ScriptOutputs {
${outputKeys}
}

/** Write a default-exported async function: read inputs, await om.* as needed, return outputs. */
declare const __hint__: (args: ScriptArgs) => Promise<ScriptOutputs>
`
}

/** 画布双击 `script.run` 卡片时，通知 `ScriptRunInspector` 打开全尺寸代码编辑窗 */
export const scriptCodeDialogRequest = ref<{
  hostId: string
  nodeId: string
  seq: number
} | null>(null)

export function requestOpenScriptCodeDialog(hostId: string, nodeId: string): void {
  scriptCodeDialogRequest.value = {
    hostId,
    nodeId,
    seq: (scriptCodeDialogRequest.value?.seq ?? 0) + 1
  }
}

function compactPreviewValue(val: unknown): unknown {
  if (typeof val === 'string') {
    if (val.startsWith('data:') && val.length > 96) {
      const prefix = val.slice(0, 36)
      const kb = (val.length / 1024).toFixed(1)
      return `${prefix}…[${kb}KB]`
    }
    if (val.length > 500) {
      return `${val.slice(0, 500)}…[${val.length} chars]`
    }
    return val
  }
  if (Array.isArray(val)) {
    return val.map(compactPreviewValue)
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = compactPreviewValue(v)
    }
    return out
  }
  return val
}

/**
 * 从当前画布文档的入边与上游节点（runStates 或静态 params）拼出实时 `inputs` 快照预览，
 * 让脚本作者无需盲写就能看清 `inputs.<portId>[0]` 的真实字段结构。
 */
export function buildUpstreamInputsPreview(
  doc: GraphDocument | null,
  nodeId: string,
  inputPorts: readonly ScriptPortDecl[]
): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {}
  for (const port of inputPorts) {
    result[port.id] = []
  }
  if (!doc) return result
  const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))
  for (const edge of doc.edges) {
    if (edge.target !== nodeId) continue
    const targetPort = edge.targetPort || 'in'
    if (!(targetPort in result)) continue
    const sourcePort = edge.sourcePort || 'out'
    const runOut = doc.runStates?.[edge.source]?.outputs?.[sourcePort]
    if (runOut) {
      result[targetPort]!.push(compactPreviewValue(runOut))
      continue
    }
    const sourceNode = nodeById.get(edge.source)
    if (!sourceNode) continue
    const text = sourceNode.params.text?.trim()
    if (text && text !== '…') {
      result[targetPort]!.push(compactPreviewValue({ kind: 'text', text }))
      continue
    }
    const rel = sourceNode.params.previewRelativePath?.trim()
    const dataUrl = sourceNode.params.previewDataUrl?.trim()
    if (rel || dataUrl) {
      result[targetPort]!.push(
        compactPreviewValue({
          kind: sourceNode.assetType === 'video' ? 'video' : 'image',
          ...(rel ? { relativePath: rel } : {}),
          ...(dataUrl ? { dataUrl } : {})
        })
      )
    }
  }
  return result
}
