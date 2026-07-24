import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import StudioView from '../views/StudioView.vue'
import SettingsView from '../views/SettingsView.vue'
import DirectorStageWindowView from '../views/DirectorStageWindowView.vue'
import ShotPreviewWindowView from '../views/ShotPreviewWindowView.vue'
import ShotEditorWindowView from '../views/ShotEditorWindowView.vue'
import ShotTableWindowView from '../views/ShotTableWindowView.vue'
import WorldEditorWindowView from '../views/WorldEditorWindowView.vue'
import WorldTableWindowView from '../views/WorldTableWindowView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/studio', name: 'studio', component: StudioView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/stage', name: 'stage', component: DirectorStageWindowView },
    { path: '/shot-preview', name: 'shot-preview', component: ShotPreviewWindowView },
    { path: '/shot-editor', name: 'shot-editor', component: ShotEditorWindowView },
    { path: '/shot-table', name: 'shot-table', component: ShotTableWindowView },
    { path: '/world-editor', name: 'world-editor', component: WorldEditorWindowView },
    { path: '/world-table', name: 'world-table', component: WorldTableWindowView }
  ]
})

export default router
