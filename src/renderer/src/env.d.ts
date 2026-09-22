/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module '*?raw' {
  const src: string
  export default src
}

declare module 'virtual:three-module-source' {
  const src: string
  export default src
}
