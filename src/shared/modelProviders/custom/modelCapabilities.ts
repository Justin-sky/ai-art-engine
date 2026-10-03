/**
 * 自定义提供商（自建 / 中转网关）的模型模态判定。
 *
 * 背景：自定义提供商的模型目录来自网关自己的 `GET /models`，而这类网关（NewAPI / one-api 等）
 * 会把**所有**渠道的模型倒进同一个列表——图片生成模型也会出现在里面。它们被当成文本模型
 * 显示在「文本」页签，用户勾选后拿去对话只会拿到 503 或一段 markdown 图片链接。
 * 官方 OpenAI 有同样的问题，做法是先例：`isOpenAiTextModelId`（openai/modelCapabilities.ts）。
 *
 * 与那边的差别：OpenAI 官方目录可以用 `^(gpt|o[0-9]|chatgpt)` 做白名单，因为官方命名可枚举；
 * 网关后面可能是任意厂商，只能反过来做黑名单——按 id 里的**图片生成**特征排除。
 *
 * 取舍：黑名单只覆盖「明确是图片生成」的命名，宁可漏掉个别多模态模型，也不误伤能对话的模型
 * （误伤的代价是用户在文本页签里找不到它，比多显示一个图片模型更难自查）。
 * 排除不掉的模型仍可由用户在「文本」页签手动填写 id 使用——手填路径不受这里影响。
 *
 * 注：内置 NewAPI 提供商（`newapi/modelCapabilities.ts`）有同一套命名词表，那边还会叠加
 * `/api/pricing` 的端点元数据；这里是拿不到元数据时的通用兜底。
 */

const IMAGE_MODEL_PATTERN =
  /(gpt-image|dall-?e|dalle|stable-?diffusion|sdxl|sd3|sd-?\d|flux|midjourney|\bmj\b|imagen|seedream|cogview|kolors|qwen-image|wanx|doubao-?seedream|nano-?banana|ideogram|recraft|photon|playground-v|firefly|t2i|text-?to-?image|image-?gen|drawing)/i

/** 该模型 id 是否明确属于「图片生成」模型（网关目录里需要从文本页签剔除的那些） */
export function isCustomImageModelId(modelId: string): boolean {
  return IMAGE_MODEL_PATTERN.test(modelId.trim())
}

/** 该模型 id 是否适合放进自定义提供商的「文本」页签 */
export function isCustomTextModelId(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  return !isCustomImageModelId(id)
}
