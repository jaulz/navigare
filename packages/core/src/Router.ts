import PartialRoute from './PartialRoute'
import Route from './Route'
import modal from './modal'
import {
  Redirect,
  RouteMethod,
  Page,
  VisitPreserveOption,
  QueryStringArrayFormat,
  VisitData,
  Routable,
  VisitId,
  VisitOptions,
  RouterLocation,
  RouterOptions,
  RouteDefaults,
  RouterEvents,
  RouterEventListener,
  RawRouteMethod,
  Visit,
  Component,
  RouterEventNames,
  RouterEventDetails,
  ResolvedRoutable,
  PropertyKey,
} from './types'
import {
  isSSR,
  throwError,
  mergeDataIntoQueryString,
  mergePages,
  objectToFormData,
  hasFiles,
  createEmitter,
  mapRouteMethod,
  safeParse,
  serialize,
  getKeys,
  getDeferredPageProperties,
  transformPagePropertyKeys,
  transformPropertyKeys,
  transformPropertyKey,
  castArray,
  cloneDeep,
  debounce,
  isObject,
  isString,
  isDefined,
  clonePage,
} from './utilities'
import {
  default as Axios,
  AxiosResponse,
  AxiosResponseHeaders,
  RawAxiosResponseHeaders,
  AxiosStatic,
} from 'axios'
import { SetRequired } from 'type-fest'

export default class Router<TComponentModule> {
  public options: RouterOptions<TComponentModule>

  protected activeVisit: Visit

  protected internalPages: Page[] = []

  public get pages(): Page[] {
    return this.internalPages.map((page, index) => {
      return {
        ...clonePage(page),
        obsolete: index > this.pageIndex,
      }
    })
  }

  protected pageIndex = 0

  protected get internalPage(): Page {
    return this.internalPages[this.pageIndex]
  }

  protected set internalPage(nextPage: Page) {
    this.internalPages[this.pageIndex] = nextPage
  }

  public get page(): Page {
    return clonePage(this.internalPage)
  }

  protected get internalPreviousPage(): Page | undefined {
    return this.internalPages[this.pageIndex - 1]
  }

  public get previousPage(): Page | undefined {
    return clonePage(this.internalPreviousPage)
  }

  protected get internalLatestPage(): Page {
    return [...this.internalPages].sort((pageA, pageB) => {
      return pageB.timestamp - pageA.timestamp
    })[0]
  }

  public get latestPage(): Page {
    return clonePage(this.internalLatestPage)
  }

  public get location(): RouterLocation {
    return this.page.location
  }

  protected emitter = createEmitter<RouterEvents>({
    before: {
      options: { cancelable: true },
    },
    cancel: {
      options: { cancelable: true },
    },
    error: {},
    exception: {
      options: { cancelable: true },
    },
    finish: {},
    navigate: {},
    progress: {},
    start: {},
    success: {},
  })

  protected componentModules: Record<string, TComponentModule> = {}

  public axios: AxiosStatic

  public constructor(options: RouterOptions<TComponentModule>) {
    const { initialPage, axios = Axios } = options
    this.options = options
    this.activeVisit = this.createVisit({
      location: initialPage.location,
    })
    this.setPage({
      ...initialPage,
      visit: this.activeVisit,
    })
    this.axios = axios

    // Handle initial page
    if (!isSSR()) {
      setTimeout(() => {
        if (this.isBackForwardVisit()) {
          this.handleBackForwardVisit(this.page)
        } else if (this.isRedirect()) {
          this.handleRedirect(this.page)
        } else {
          this.handleInitialPageVisit(this.page)
        }

        // Listen to window events
        this.setupWindowEventListeners()
      }, 0)
    }

    // Attach listeners
    this.on('before', options.events?.before)
    this.on('start', options.events?.start)
    this.on('progress', options.events?.progress)
    this.on('navigate', options.events?.navigate)
    this.on('finish', options.events?.finish)
    this.on('cancel', options.events?.cancel)
    this.on('success', options.events?.success)
    this.on('error', options.events?.error)
    this.on('invalid', options.events?.invalid)
    this.on('exception', options.events?.exception)

    // Log exceptions by default
    this.on('exception', (event) => {
      console.error(event.detail.error)
    })
  }

  protected async handleInitialPageVisit(page: Page): Promise<void> {
    page.location.hash = window.location.hash
  }

  protected setupWindowEventListeners(): void {
    window.addEventListener('popstate', this.handlePopstateEvent.bind(this))

    document.addEventListener(
      'scroll',
      debounce(this.handleScrollEvent.bind(this), 100),
      true,
    )
  }

  protected scrollRegions(): NodeListOf<Element> {
    return document.querySelectorAll('[scroll-region]')
  }

  protected handleScrollEvent(event: Event): void {
    if (
      typeof (event.target as Element).hasAttribute === 'function' &&
      (event.target as Element).hasAttribute('scroll-region')
    ) {
      this.saveScrollPositions()
    }
  }

  protected saveScrollPositions(): void {
    if (isSSR()) {
      return
    }

    this.replaceState({
      ...this.page,
      scrollRegions: Array.from(this.scrollRegions()).map((region) => {
        return {
          top: region.scrollTop,
          left: region.scrollLeft,
        }
      }),
    })
  }

  protected resetScrollPositions(): void {
    if (isSSR()) {
      return
    }

    window.scrollTo(0, 0)

    this.scrollRegions().forEach((region) => {
      if (typeof region.scrollTo === 'function') {
        region.scrollTo(0, 0)
      } else {
        region.scrollTop = 0
        region.scrollLeft = 0
      }
    })
    this.saveScrollPositions()

    if (window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
    }
  }

  protected restoreScrollPositions(): void {
    if (!this.page.scrollRegions) {
      return
    }

    this.scrollRegions().forEach((region: Element, index: number) => {
      const scrollPosition = this.page.scrollRegions[index]
      if (!scrollPosition) {
        return
      } else if (typeof region.scrollTo === 'function') {
        region.scrollTo(scrollPosition.left, scrollPosition.top)
      } else {
        region.scrollTop = scrollPosition.top
        region.scrollLeft = scrollPosition.left
      }
    })
  }

  protected isBackForwardVisit(): boolean {
    return (
      window.history.state &&
      window.performance &&
      window.performance.getEntriesByType('navigation').length > 0 &&
      (
        window.performance.getEntriesByType(
          'navigation',
        )[0] as PerformanceNavigationTiming
      ).type === 'back_forward'
    )
  }

  protected async handleBackForwardVisit(page: Page): Promise<void> {
    const nextPage = safeParse<Page>(window.history.state)

    if (!nextPage) {
      return
    }

    await this.setPage(
      {
        ...nextPage,
        version: page.version,
      },
      {
        preserveScroll: true,
        preserveState: true,
        replace: true,
      },
    )

    this.restoreScrollPositions()
  }

  protected redirect(
    location: RouterLocation,
    preserveScroll: Redirect['preserveScroll'],
  ): boolean | void {
    try {
      const redirect: Redirect = { preserveScroll }

      window.sessionStorage.setItem('navigareRedirect', serialize(redirect))

      window.location.href = location.href

      if (this.createLocation(window.location.href).href === location.href) {
        window.location.reload()
      }
    } catch (error) {
      return false
    }
  }

  protected isRedirect(): boolean {
    try {
      return window.sessionStorage.getItem('navigareRedirect') !== null
    } catch (error) {
      return false
    }
  }

  protected async handleRedirect(page: Page): Promise<void> {
    const redirect: Redirect = JSON.parse(
      window.sessionStorage.getItem('navigareRedirect') || '',
    )

    window.sessionStorage.removeItem('navigareRedirect')

    page.location.hash = window.location.hash
    page.rememberedState = window.history.state?.rememberedState ?? {}
    page.scrollRegions = window.history.state?.scrollRegions ?? []

    await this.setPage(page, {
      preserveScroll: redirect.preserveScroll,
      preserveState: true,
    })

    if (redirect.preserveScroll) {
      this.restoreScrollPositions()
    }
  }

  protected isRedirectResponse(response: AxiosResponse): boolean {
    if (!response) {
      return false
    }

    if (response.status !== 409) {
      return false
    }

    return true
  }

  protected isNavigareResponse(
    response: AxiosResponse | undefined,
  ): response is AxiosResponse<Page> {
    if (!this.getHeader(response?.headers, 'X-Navigare')) {
      return false
    }

    return true
  }

  protected async cancelVisit(
    visitId: VisitId,
    interrupt = false,
  ): Promise<void> {
    if (this.activeVisit?.id !== visitId) {
      return
    }

    const { activeVisit: visit } = this

    if (visit.completed || visit.cancelled) {
      return
    }

    visit.cancelToken?.cancel()
    visit.completed = false
    visit.cancelled = true
    visit.interrupted = interrupt ? true : false

    await this.emit(
      'cancel',
      {
        visit,
      },
      visit.events.cancel,
    )
    await this.emit(
      'finish',
      {
        visit,
      },
      visit.events.finish,
    )
  }

  protected async finishVisit(visit: Visit): Promise<void> {
    if (visit.completed || visit.cancelled) {
      return
    }

    visit.completed = true
    visit.cancelled = false
    visit.interrupted = false

    await this.emit(
      'finish',
      {
        visit,
      },
      visit.events.finish,
    )
  }

  protected resolvePreserveOption(
    value: VisitPreserveOption,
    page: Page,
  ): boolean {
    if (typeof value === 'function') {
      return value(page)
    }

    if (value === 'errors') {
      return Object.keys(page.properties.__errors || {}).length > 0
    }

    return !!value
  }

  public async back(fallback?: Routable): Promise<void> {
    // In case we have no history, we allow the user to define a fallback route
    if (this.pageIndex - 1 < 0) {
      if (fallback) {
        await this.visit(fallback)
        return
      } else {
        history.back()
        return
      }
    }

    history.back()
  }

  public async visit(
    routable: Routable,
    options: VisitOptions = {},
  ): Promise<Visit> {
    const {
      forceFormData = false,
      queryStringArrayFormat = QueryStringArrayFormat.Indices,
    } = options
    const {
      location,
      method,
      data,
      options: routeOptions = {},
    } = this.resolveRoutable(routable, options.data, {
      method: options.method,
      forceFormData,
      queryStringArrayFormat,
    })

    // Resolve options
    let {
      preserveScroll = false,
      preserveState = false,
      preserveURL = false,
    } = options
    const {
      fragmentName,
      replace = false,
      properties = routeOptions.properties ?? [],
      headers = routeOptions.headers ?? {},
      errorBag = '',
      events = {},
      background = false,
    } = options

    const visit: Visit = this.createVisit({
      location,
      method,
      data,
      replace,
      background,
      preserveScroll,
      preserveState,
      properties,
      headers,
      errorBag,
      forceFormData,
      queryStringArrayFormat,
      events,
    })

    if (
      !(await this.emit(
        'before',
        {
          visit,
        },
        events?.before,
      ))
    ) {
      return visit
    }

    if (!visit.background) {
      if (this.activeVisit) {
        this.cancelVisit(this.activeVisit.id, true)
      }

      this.saveScrollPositions()

      visit.cancelToken = Axios.CancelToken.source()
      visit.cancel = () => {
        this.cancelVisit(visit.id)
      }
      visit.interrupt = () => {
        this.cancelVisit(visit.id, true)
      }

      this.activeVisit = visit
    }

    await this.emit(
      'start',
      {
        visit,
      },
      events?.start,
    )

    try {
      const response = await this.axios({
        method,

        url: location.href,

        data: method === RouteMethod.GET ? {} : data,

        params: method === RouteMethod.GET ? data : {},

        cancelToken: visit.cancelToken?.token,

        headers: {
          ...headers,
          Accept: 'text/html, application/xhtml+xml',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Navigare': true,
          ...(properties.length
            ? {
                'X-Navigare-Properties': properties,
              }
            : {}),
          ...(errorBag && errorBag.length
            ? { 'X-Navigare-Error-Bag': errorBag }
            : {}),
          ...(this.page.version
            ? { 'X-Navigare-Version': this.page.version }
            : {}),
        },

        onUploadProgress: async (progress) => {
          if (!(data instanceof FormData)) {
            return
          }

          await this.emit(
            'progress',
            {
              visit,
              progress: {
                ...progress,
                percentage: progress.total
                  ? Math.round((100 * progress.loaded) / progress.total)
                  : undefined,
              },
            },
            events?.progress,
          )
        },
      })

      if (!visit.background) {
        if (!this.isNavigareResponse(response)) {
          throw response
        }

        // Prepare next page
        const nextPage: Page = {
          ...response.data,
          visit,
        }

        // Check if we need to manually preserve the scroll area
        preserveScroll = this.resolvePreserveOption(preserveScroll, nextPage)

        // Check if we need to preserve the state
        preserveState = this.resolvePreserveOption(preserveState, nextPage)
        if (preserveState && window.history.state?.rememberedState) {
          nextPage.rememberedState = window.history.state.rememberedState
        }

        // In case the next location is the same as the current location, we will copy the hash
        if (
          location.hash &&
          !nextPage.location.hash &&
          location.href === nextPage.location.href
        ) {
          nextPage.location.hash = location.hash
        }

        // Set new page
        await this.setPage(nextPage, {
          replace,
          preserveScroll,
          preserveState,
          preserveURL: this.resolvePreserveOption(preserveURL, nextPage),
          fragmentName,
        })

        // Check if any errors occurred
        const errors = this.page.properties.__errors || {}
        if (Object.keys(errors).length > 0) {
          const scopedErrors = Object.fromEntries(
            Object.entries(
              errorBag ? (errors[errorBag] ? errors[errorBag] : {}) : errors,
            ).map(([name, message]) => {
              return [this.transformServerPropertyKey(name), castArray(message)]
            }),
          )

          await this.emit(
            'error',
            {
              visit,
              errors: scopedErrors,
              response: response,
            },
            events?.error,
          )
        } else {
          await this.emit(
            'success',
            {
              visit,
              page: this.page,
              response: response,
            },
            events?.success,
          )
        }
      } else {
        await this.emit(
          'success',
          {
            visit,
            page: this.page,
            response: response,
          },
          events?.success,
        )
      }
    } catch (error) {
      let throwException = true

      if (Axios.isAxiosError(error) && error.response) {
        if (this.isNavigareResponse(error.response)) {
          this.setPage(error.response.data)
          throwException = false
        } else if (this.isRedirectResponse(error.response)) {
          const redirectHref = String(
            this.getHeader(error.response.headers, 'X-Navigare-Location'),
          )

          if (!redirectHref) {
            throw new Error(
              '"X-Navigare-Location" header is missing in response',
            )
          }

          // In case the redirect location points to the current location, we will restore the hash
          const redirectLocation = this.createLocation(redirectHref)
          if (
            location.hash &&
            !redirectLocation.hash &&
            location.href === redirectLocation.href
          ) {
            redirectLocation.hash = location.hash
          }

          this.redirect(redirectLocation, preserveScroll === true)
          throwException = false
        } else if (visit.background) {
          await this.emit(
            'error',
            {
              visit,
              errors: {},
              response: error.response,
            },
            events?.error,
          )
          throwException = false
        } else if (
          await this.emit(
            'invalid',
            {
              visit,
              response: error.response,
            },
            events?.invalid,
          )
        ) {
          modal.show(error.response.data as any)
        }
      }

      if (throwException) {
        await this.emit(
          'exception',
          {
            visit,
            error: error as Error,
          },
          events?.exception,
        )
      }
    }

    this.finishVisit(visit)

    return visit
  }

  protected getHeader(
    headers: RawAxiosResponseHeaders | AxiosResponseHeaders | undefined,
    name: string,
  ): string | string[] | number | boolean | null | undefined {
    if (!headers) {
      return undefined
    }

    return headers[name.toLowerCase()]
  }

  protected async setPage(
    page: Page,
    options: {
      replace?: boolean
      preserveScroll?: boolean
      preserveState?: boolean
      preserveURL?: boolean
      fragmentName?: string
    } = {},
  ): Promise<Page> {
    const initialVisit = !this.page
    const {
      replace = false,
      preserveScroll = false,
      preserveURL = false,
      fragmentName,
    } = options
    const fragments = fragmentName
      ? {
          ...this.options.fragments,
          [fragmentName]: {
            ...this.options.fragments?.[fragmentName],
            lazy: true,
          },
        }
      : this.options.fragments

    // Merge current and incoming page into next page
    const pageWithBase = page.base
      ? mergePages(
          {
            ...page.base,
            visit: page.visit,
          },
          {
            ...page,
            base: undefined,
          },
          fragments,
        )
      : page
    const nextPage = mergePages(
      this.page,
      transformPagePropertyKeys(
        pageWithBase,
        this.transformServerPropertyKey.bind(this),
      ),
      fragments,
    )

    // Reuse or initialize scroll regions and state
    nextPage.scrollRegions = nextPage.scrollRegions || []
    nextPage.rememberedState = nextPage.rememberedState || {}

    // Either replace the current state or push the next state
    if (
      initialVisit ||
      replace ||
      preserveURL ||
      (!isSSR() && nextPage.location.href === window.location.href)
    ) {
      this.replaceState(nextPage, preserveURL)
    } else if (nextPage.location.href === this.previousPage?.location.href) {
      this.internalPages[this.pageIndex - 1] = {
        ...nextPage,
        visit: this.previousPage.visit,
      }
      this.back()
    } else {
      this.pushState(nextPage)
    }

    // Reset scroll if requested
    if (!preserveScroll) {
      this.resetScrollPositions()
    }

    // Inform listeners about new page
    if (!initialVisit) {
      await this.emit('navigate', {
        page: this.page,
        visit: this.page.visit,
        pages: this.internalPages,
        pageIndex: this.pageIndex,
        replace,
      })
    }

    // Load deferred properties in the background
    const deferredProperties = getDeferredPageProperties(this.page)
    if (!isSSR() && getKeys(deferredProperties).length > 0) {
      setTimeout(() => {
        for (const [, property] of Object.entries(deferredProperties)) {
          if (property) {
            property.__requested = true
          }
        }

        this.reload({
          headers: {
            'X-Navigare-Properties': getKeys(deferredProperties)
              .map((property) => this.transformClientPropertyKey(property))
              .join(','),
          },
        })
      }, 1)
    }

    return nextPage
  }

  protected pushState(page: Page): void {
    // Increase the page index and store the new page
    this.pageIndex++
    this.internalPages.length = this.pageIndex + 1
    this.internalPages[this.pageIndex] = page

    if (!isSSR()) {
      window.history.pushState(serialize(page), '', page.location.href)
    }
  }

  protected replaceState(page: Page, preserveURL: boolean = false): void {
    // Simply replace the page at the current page index
    this.internalPage = page

    if (!isSSR()) {
      window.history.replaceState(
        serialize(page),
        '',
        preserveURL ? undefined : page.location.href,
      )
    }
  }

  protected getComponentId(component: Component): string {
    return component.id
  }

  public getComponentModule(
    component: Component,
  ): TComponentModule | Promise<TComponentModule> {
    const id = this.getComponentId(component)

    // If the component was loaded before we can simply return it's instance
    if (id in this.componentModules) {
      return this.componentModules[this.getComponentId(component)]
    }

    // Otherwise we will resolve it asynchronously
    return new Promise<TComponentModule>(async (resolve) => {
      const module = (await this.resolveComponentModule(component)) as any

      // Remember that we used the module before
      this.componentModules[id] = 'default' in module ? module.default : module

      resolve(this.componentModules[id])
    })
  }

  public async resolveComponentModule(component: Component) {
    const resolveComponentModule =
      this.options.resolveComponentModule ||
      (async (url) => {
        return import(/* @vite-ignore */ url)
      })

    const url = component.path.startsWith('/')
      ? component.path
      : [this.options.base, component.path].join('')

    return await resolveComponentModule(url, component)
  }

  public async resolvePage(page: Page): Promise<void> {
    const components = Object.values(page.fragments).reduce(
      (cumulatedComponents, fragments) => {
        if (!fragments) {
          return cumulatedComponents
        }

        return [
          ...cumulatedComponents,
          ...fragments?.map((fragment) => fragment?.component ?? undefined),
        ].filter(isDefined)
      },
      [] as Component[],
    )

    await Promise.all(
      components.map(async (component) => {
        return await this.getComponentModule(component)
      }),
    )

    if (page.base) {
      await this.resolvePage(page.base)
    }
  }

  protected async handlePopstateEvent(event: PopStateEvent): Promise<void> {
    const nextPage = safeParse<Page>(event.state)

    if (!nextPage) {
      history.back()
      return
    }

    // Cancel pending visit
    if (this.activeVisit) {
      this.cancelVisit(this.activeVisit.id, true)
    }

    // Try to find page via visit id
    const nextPageIndex = nextPage
      ? this.internalPages.findIndex((page) => {
          return page.visit.id === nextPage.visit.id
        })
      : -1

    // In case we cannot find it, it belongs to a session before a refresh
    if (nextPageIndex < 0) {
      window.location.reload()
      /*this.replaceState(nextPage)
      this.resetScrollPositions()*/
    } else {
      this.pageIndex = nextPageIndex

      this.restoreScrollPositions()
    }

    await this.emit('navigate', {
      visit: this.page.visit,
      page: this.page,
      pageIndex: this.pageIndex,
      pages: this.internalPages,
      replace: false,
    })
  }

  public async reload(
    options: Exclude<VisitOptions, 'preserveScroll' | 'preserveState'> = {},
  ): Promise<Visit> {
    return await this.visit(this.location.href, {
      ...options,
      replace: true,
      preserveScroll: true,
      preserveState: true,
    })
  }

  public async get(
    routable: Routable,
    data: VisitData = {},
    options: Exclude<VisitOptions, 'method' | 'data'> = {},
  ): Promise<Visit> {
    return await this.visit(routable, {
      ...options,
      method: 'GET',
      data,
    })
  }

  public async post(
    routable: Routable,
    data: VisitData = {},
    options: Exclude<VisitOptions, 'method' | 'data'> = {},
  ): Promise<Visit> {
    return await this.visit(routable, {
      preserveState: true,
      ...options,
      method: 'POST',
      data,
    })
  }

  public async put(
    routable: Routable,
    data: VisitData = {},
    options: Exclude<VisitOptions, 'method' | 'data'> = {},
  ): Promise<Visit> {
    return await this.visit(routable, {
      preserveState: true,
      ...options,
      method: 'PUT',
      data,
    })
  }

  public async patch(
    routable: Routable,
    data: VisitData = {},
    options: Exclude<VisitOptions, 'method' | 'data'> = {},
  ): Promise<Visit> {
    return await this.visit(routable, {
      preserveState: true,
      ...options,
      method: 'PATCH',
      data,
    })
  }

  public async delete(
    routable: Routable,
    options: Exclude<VisitOptions, 'method'> = {},
  ): Promise<Visit> {
    return await this.visit(routable, {
      preserveState: true,
      ...options,
      method: 'DELETE',
    })
  }

  public remember(data: unknown, key = 'default'): void {
    this.replaceState({
      ...this.page,
      rememberedState: {
        ...this.page.rememberedState,
        [key]: cloneDeep(data),
      },
    })
  }

  public restore(key = 'default'): unknown {
    if (isSSR()) {
      return
    }

    const page = safeParse<Page>(window.history.state)

    return page?.rememberedState?.[key]
  }

  public resolveRoutable(
    routable: Routable,
    data: VisitData = {},
    options: {
      method?: RawRouteMethod
      forceFormData?: boolean
      queryStringArrayFormat?: QueryStringArrayFormat
    } = {
      queryStringArrayFormat: QueryStringArrayFormat.Indices,
    },
  ): ResolvedRoutable {
    let finalHref =
      routable instanceof URL
        ? routable.href
        : routable instanceof Route || isObject(routable)
        ? routable.getHref(this.location, this.page.defaults, {
            queryStringArrayFormat: options.queryStringArrayFormat,
          })
        : routable
    let finalData = data
    let method =
      routable instanceof Route
        ? routable.method
        : mapRouteMethod(options.method) ?? RouteMethod.GET
    const components = routable instanceof Route ? routable.components : []
    const routeOptions = routable instanceof Route ? routable.options : {}

    // Check if the route was resolved
    if (!finalHref) {
      throwError(
        `the routable "${JSON.stringify(
          routable,
        )}" could not be resolved properly`,
      )
    }

    // Check if there is potentially an issue with the setup
    if (
      isObject(routable) &&
      !(routable instanceof Route) &&
      !(routable instanceof URL)
    ) {
      console.warn(
        `It seems that there is an issue with Navigare. Maybe you have two different versions of \`@navigare/core\` installed?`,
      )
    }

    if (
      (hasFiles(data) || options.forceFormData) &&
      !(data instanceof FormData)
    ) {
      finalData = objectToFormData(data)
    }

    // During form submissions replace method with POST to allow file uploads
    if (finalData instanceof FormData) {
      finalData.append('_method', method)
      method = RouteMethod.POST
    } else {
      // Otherwise merge data into query string
      const merged = mergeDataIntoQueryString(
        method,
        finalHref,
        finalData,
        options.queryStringArrayFormat,
      )

      finalHref = merged.href
      finalData = transformPropertyKeys(
        merged.data,
        this.transformClientPropertyKey.bind(this),
      )
    }

    return {
      method,
      location: this.createLocation(finalHref),
      data: finalData,
      components,
      options: routeOptions,
    }
  }

  protected createVisit(visit: SetRequired<Partial<Visit>, 'location'>): Visit {
    return {
      id: Math.random().toString(36),
      method: RouteMethod.GET,
      data: {},
      replace: false,
      background: false,
      preserveScroll: false,
      preserveState: false,
      preserveURL: false,
      properties: [],
      headers: {},
      errorBag: null,
      forceFormData: false,
      queryStringArrayFormat: QueryStringArrayFormat.Indices,
      completed: false,
      cancelled: false,
      interrupted: false,
      events: visit.events || {},
      ...visit,
    }
  }

  protected createLocation(href: string): RouterLocation {
    const url = new URL(href, this.location.href)

    // Create version without hash
    const urlWithoutHash = new URL(url)
    urlWithoutHash.hash = ''

    return {
      href: urlWithoutHash.href,
      host: url.host,
      hostname: url.hostname,
      origin: url.origin,
      pathname: url.pathname,
      port: url.port,
      protocol: url.protocol,
      search: url.search,
      hash: url.hash,
    }
  }

  public match(
    comparableRoute: Routable | PartialRoute,
    route: Route,
    location: RouterLocation,
    defaults: RouteDefaults,
  ): boolean {
    // Check if the route matches the other route
    return route.match(comparableRoute, location, defaults)
  }

  public on<TEventName extends RouterEventNames>(
    name: TEventName,
    listener?: RouterEventListener<TEventName>,
  ): () => void {
    if (!listener) {
      return () => undefined
    }

    return this.emitter.on(name, listener)
  }

  public off<TEventName extends RouterEventNames>(
    name: TEventName,
    listener: RouterEventListener<TEventName>,
  ): void {
    return this.emitter.off(name, listener)
  }

  public async emit<TEventName extends RouterEventNames>(
    name: TEventName,
    details: RouterEventDetails<TEventName>,
    initialListener?: RouterEventListener<TEventName>,
  ): Promise<boolean> {
    return this.emitter.emit(name, details, initialListener)
  }

  public isRoutable(routable: any): routable is Routable {
    return (
      routable instanceof Route || routable instanceof URL || isString(routable)
    )
  }

  public transformClientPropertyKey(key: PropertyKey): string {
    return transformPropertyKey(
      key,
      this.options.transformClientPropertyKey?.bind(this),
    )
  }

  public transformServerPropertyKey(key: PropertyKey): string {
    return transformPropertyKey(
      key,
      this.options.transformServerPropertyKey?.bind(this),
    )
  }

  public reportError(error: unknown) {
    this.emit('exception', {
      visit: this.activeVisit,
      error: error as Error,
    })
  }
}
