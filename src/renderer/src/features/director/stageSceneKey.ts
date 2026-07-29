import type { InjectionKey } from 'vue'
import type { DirectorStageSceneApi } from './useDirectorStageScene'

export type { DirectorMediaGalleryTab } from './useDirectorStageScene'
export const directorStageSceneKey: InjectionKey<DirectorStageSceneApi> = Symbol('directorStageScene')
