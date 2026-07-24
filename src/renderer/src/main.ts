import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import i18n, { initLocaleFromSettings } from './i18n'
import {
  activateBuiltinExtensions,
  loadExternalExtensions
} from './editor/extensions'
import { initEditorPreferences } from './editor/preferences'
import 'dockview-vue/dist/styles/dockview.css'
import './styles/main.css'

async function bootstrap(): Promise<void> {
  await initLocaleFromSettings()
  await initEditorPreferences()
  activateBuiltinExtensions()
  await loadExternalExtensions()
  const { default: App } = await import('./App.vue')
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.use(i18n)
  app.mount('#app')
}

void bootstrap()
