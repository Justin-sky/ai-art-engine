import type { InjectionKey } from 'vue'

/** Dive 内嵌时 StudioFloatingWindow 改为铺满宿主，不再 Teleport 浮层 */
export const editorDiveEmbeddedKey: InjectionKey<boolean> = Symbol('editorDiveEmbedded')
