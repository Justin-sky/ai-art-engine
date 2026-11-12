import { createApp } from 'vue'
import '@renderer/styles/main.css'
import PlaygroundApp from './PlaygroundApp.vue'
import { playgroundI18n } from './i18n'

const app = createApp(PlaygroundApp)
app.use(playgroundI18n)
app.mount('#app')
