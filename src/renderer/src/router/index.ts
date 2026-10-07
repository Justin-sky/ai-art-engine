import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import StudioView from '../views/StudioView.vue'
import SettingsView from '../views/SettingsView.vue'
import MarketplaceView from '../views/MarketplaceView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/studio', name: 'studio', component: StudioView },
    { path: '/settings', name: 'settings', component: SettingsView },
    /**
     * 插件市场：由主进程单独开一个窗口载入该路由（见 `services/marketplaceWindow.ts`）。
     * 用的是同一套渲染入口，App.vue 在该路由下只渲染本视图、不挂主界面。
     */
    { path: '/marketplace', name: 'marketplace', component: MarketplaceView }
  ]
})

export default router
