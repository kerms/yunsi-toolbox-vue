import type { Component } from 'vue'

export interface ToolMeta {
  path: string
  name: string
  desc: string
  icon: string
  color: string
  order: number
}

interface PageModule {
  default: Component
  toolMeta?: ToolMeta
}

const modules = import.meta.glob<PageModule>('./pages/*.vue', { eager: true })

export interface Tool {
  meta: ToolMeta
  component: Component
}

export const tools: Tool[] = Object.values(modules)
  .filter((m): m is PageModule & { toolMeta: ToolMeta } => m.toolMeta !== undefined)
  .map(m => ({ meta: m.toolMeta, component: m.default }))
  .sort((a, b) => a.meta.order - b.meta.order)
