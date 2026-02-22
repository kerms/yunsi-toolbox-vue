import { createRouter, createWebHashHistory } from 'vue-router'
import HomePage from './pages/HomePage.vue'
import { tools } from './tools'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomePage },
    ...tools.map(t => ({ path: t.meta.path, component: t.component })),
  ],
})
