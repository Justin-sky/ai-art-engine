/**
 * Builds the `.d.ts` injected into Monaco for the script node editor.
 *
 * Only declares the capabilities that are currently enabled, so the completion list
 * matches what the node can actually call: a method only appears on `om.` once its
 * capability is checked, mirroring the executor whitelist (see scriptRun.ts).
 */
import type { ScriptCapability, ScriptPortDecl } from '@shared/graph'

const GRAPH_VALUE_DTS = `
/** A graph value passed between nodes (discriminated by kind; common fields below, other provider fields read as needed). */
type GraphValue =
  | { kind: 'text'; text: string }
  | { kind: 'image'; dataUrl?: string; relativePath?: string; id?: string }
  | { kind: 'video'; relativePath?: string; dataUrl?: string; id?: string }
  | { kind: 'images'; items: Array<{ dataUrl?: string; relativePath?: string }> }
  | { kind: string; [k: string]: unknown }
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
