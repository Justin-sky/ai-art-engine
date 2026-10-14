/**
 * `script.run` 执行器：装配 inputs → 跑受限沙箱 → 校验输出形状 → 写回端口。
 *
 * 沙箱里的代码只能 `await om.<cap>(args)`；每个 `om.<cap>` 在这里转发到应用治理过的
 * `ctx` 能力（提供商 / 密钥 / 配额 / 日志）。能力面是**白名单**：只有节点 `capabilities`
 * 声明过、且本执行环境真的注入了对应 ctx 能力的，才会出现在 `om` 上。
 */
import type { GraphValue, NodeExecuteContext } from './types'
import type { ScriptHostCall, ScriptSandbox } from './scriptSandbox'
import { readScriptNodeParams, type ScriptCapability, type ScriptNodeParams } from '../scriptNode'

/** 把一个 host 调用名映射到 ctx 能力；返回 null 表示本环境没有该能力 */
function resolveHostCall(
  ctx: NodeExecuteContext,
  name: ScriptCapability
): ((args: unknown) => Promise<unknown>) | null {
  switch (name) {
    case 'generateText':
      return ctx.generateText
        ? (a) =>
            ctx.generateText!(a as Parameters<NonNullable<NodeExecuteContext['generateText']>>[0])
        : null
    case 'generateImage':
      return ctx.generateImage
        ? (a) =>
            ctx.generateImage!(a as Parameters<NonNullable<NodeExecuteContext['generateImage']>>[0])
        : null
    case 'generateVideo':
      return ctx.generateVideo
        ? (a) =>
            ctx.generateVideo!(a as Parameters<NonNullable<NodeExecuteContext['generateVideo']>>[0])
        : null
    case 'generateSpeech':
      return ctx.generateSpeech
        ? (a) =>
            ctx.generateSpeech!(
              a as Parameters<NonNullable<NodeExecuteContext['generateSpeech']>>[0]
            )
        : null
    case 'resolveAssetImageUrl':
      return ctx.resolveAssetImageUrl
        ? async (a) => (await ctx.resolveAssetImageUrl!(String(a ?? ''))) ?? null
        : null
    case 'readProjectImageDataUrl':
      return ctx.readProjectImageDataUrl
        ? async (a) => (await ctx.readProjectImageDataUrl!(String(a ?? ''))) ?? null
        : null
    case 'saveMedia':
      return ctx.saveRunMedia
        ? async (a) => {
            const input = (a ?? {}) as { dataUrl?: string; key?: string; outputDir?: string }
            if (!input.dataUrl) throw new Error('saveMedia requires { dataUrl }')
            return ctx.saveRunMedia!({
              dataUrl: input.dataUrl,
              key: String(input.key ?? 'script'),
              ...(input.outputDir ? { outputDir: input.outputDir } : {}),
              node: ctx.node
            })
          }
        : null
    case 'log':
      return async (a) => {
        const input = (a ?? {}) as { message?: unknown; level?: 'info' | 'warn' | 'error' }
        ctx.log?.(String(input.message ?? ''), input.level)
        return null
      }
    default:
      return null
  }
}

/** inputs 快照：只保留纯 JSON（dataUrl 等太大的字段也原样带，沙箱按需取） */
function snapshotInputs(
  ctx: NodeExecuteContext,
  params: ScriptNodeParams
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const port of params.ports.inputs) {
    const values = ctx.inputs[port.id] ?? []
    // 结构化克隆安全：GraphValue 本身是纯数据对象
    out[port.id] = JSON.parse(JSON.stringify(values))
  }
  return out
}

export interface ScriptRunDeps {
  sandbox: ScriptSandbox
}

/** 执行器工厂：注入沙箱实现（真实用 QuickJS，单测可注入假沙箱） */
export function createScriptRunNodeExecutor(deps: ScriptRunDeps) {
  return async function executeScriptRunNode(
    ctx: NodeExecuteContext
  ): Promise<Record<string, GraphValue>> {
    const params = readScriptNodeParams(ctx.node.params as Record<string, unknown>)

    // 组装允许的 host 调用：声明过 + 本环境真有该能力
    const bridge = new Map<string, (args: unknown) => Promise<unknown>>()
    const unavailable: string[] = []
    for (const cap of params.capabilities) {
      const fn = resolveHostCall(ctx, cap)
      if (fn) bridge.set(cap, fn)
      else unavailable.push(cap)
    }
    if (unavailable.length) {
      ctx.log?.(
        `脚本声明的能力在当前环境不可用，已忽略：${unavailable.join('、')}`, // cjk-ok
        'warn'
      )
    }

    const hostCall = async (call: ScriptHostCall): Promise<unknown> => {
      const fn = bridge.get(call.name)
      if (!fn) throw new Error(`capability not available: ${call.name}`)
      return fn(call.args)
    }

    const result = await deps.sandbox.run({
      code: params.code,
      inputs: snapshotInputs(ctx, params),
      allowedHostCalls: [...bridge.keys()],
      limits: params.limits,
      hostCall,
      ...(ctx.signal ? { signal: ctx.signal } : {})
    })

    if (!result.ok) {
      throw new Error(
        (ctx.locale ?? '').toLowerCase().startsWith('en')
          ? `script node failed: ${result.error}`
          : `脚本节点执行失败：${result.error}` // cjk-ok
      )
    }

    // 输出形状校验：只认声明过的输出端口，且值必须是带 kind 的对象（GraphValue）
    const declared = new Set(params.ports.outputs.map((p) => p.id))
    const outputs: Record<string, GraphValue> = {}
    for (const [portId, value] of Object.entries(result.outputs)) {
      if (!declared.has(portId)) continue
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(
          (ctx.locale ?? '').toLowerCase().startsWith('en')
            ? `output port "${portId}" must be a GraphValue object`
            : `输出端口「${portId}」必须是 GraphValue 对象` // cjk-ok
        )
      }
      if (typeof (value as { kind?: unknown }).kind !== 'string') {
        throw new Error(
          (ctx.locale ?? '').toLowerCase().startsWith('en')
            ? `output port "${portId}" is missing a "kind" field`
            : `输出端口「${portId}」缺少 kind 字段` // cjk-ok
        )
      }
      outputs[portId] = value as GraphValue
    }
    return outputs
  }
}
