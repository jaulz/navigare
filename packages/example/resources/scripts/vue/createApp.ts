import '../../css/app.css'
import Layout from './Layout.vue'
import { createNavigareApp } from '@navigare/vue3'
import { resolvePageComponent } from 'laravel-vite-plugin/inertia-helpers'
import { createApp as createVueApp, h } from 'vue'

export default function createApp() {
  return createNavigareApp({
    setup({ App, props, plugin: navigarePlugin }) {
      // Create Vue app with Navigare component as root
      const app = createVueApp({
        render: () => {
          return h(App, props)
        },
      })

      // Use Navigare App
      app.use(navigarePlugin)

      return app
    },

    resolveComponent: (name) => {
      return resolvePageComponent(
        `./pages/${name}.vue`,
        import.meta.glob('./pages/**/*.vue'),
      )
    },

    Layout,

    fragments: {
      modal: {
        stacked: true,
      },
    },
  })
}
