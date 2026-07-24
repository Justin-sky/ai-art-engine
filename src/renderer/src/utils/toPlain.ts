/** Deep-clone into a structured-cloneable plain object (strips Vue proxies). */
export function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
