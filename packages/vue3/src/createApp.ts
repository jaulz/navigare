import Root from './components/Root'
import devToolsPlugin from './devToolsPlugin'
import plugin from './plugin'
import { Options, App } from './types'
import {
  Page,
  throwError,
  isSSR,
  safeParse,
  Router,
  RouterOptions,
  getKeys,
} from '@navigare/core'
import { createHead } from '@vueuse/head'
import { DefineComponent } from 'vue'

export default function createApp({
  id = 'app',
  setup,
  resolveComponentModule,
  fragments = {
    modal: {
      stacked: true,
    },
  },
  ...restOptions
}: Options): (initialPage?: Page) => Promise<App> {
  return async (initialPage) => {
    // Determine initial page
    let initialPageWithFallback: Page | null = initialPage ?? null
    let base = '/'

    if (!isSSR()) {
      const element = document.getElementById(id)

      if (element) {
        initialPageWithFallback = safeParse(element.dataset.page, () => null)
        base = element.dataset.base ?? base
      }
    }

    if (!initialPageWithFallback) {
      throwError('Navigare: no initial page is specified')
    }

    // Create Router instance
    const options: RouterOptions<DefineComponent> = {
      initialPage: initialPageWithFallback,
      resolveComponentModule,
      fragments,
      base,
      ...restOptions,
    }
    const router = new Router<DefineComponent>(options)

    // Preload initial page
    await router.resolvePage(initialPageWithFallback)

    // Create root instance
    const root = setup({
      Root,
      props: {
        router,
        layout: options.initialPage.layout ?? null,
      },
      initialPage: initialPageWithFallback,
      router,
      plugin,
    })

    // Provide router
    root.config.globalProperties.router = router

    // Add plugins
    const head = createHead()
    root.use(head)
    root.use(plugin)

    // Add development pugin
    if (
      process.env.NODE_ENV === 'development' ||
      '__VUE_PROD_DEVTOOLS__' in globalThis
    ) {
      root.use(devToolsPlugin)
    }

    // Remove page from dataset
    if (!isSSR()) {
      const element = document.getElementById(id)

      if (element) {
        for (const key of getKeys(element.dataset)) {
          delete element.dataset[key]
        }
      }
    }

    return {
      id,
      page: initialPageWithFallback,
      head,
      root,
    }
  }
}
