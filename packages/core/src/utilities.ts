import {
  DeferredValue,
  Page,
  Fragment,
  Fragments,
  RawRouteMethod,
  RouterOptions,
  VisitData,
  Properties,
  PropertyKey,
} from './types'
import {
  FormDataConvertible,
  RouteMethod,
  QueryStringArrayFormat,
  FragmentOption,
} from './types'
import castArray from 'lodash.castarray'
import cloneDeep from 'lodash.clonedeep'
import debounce from 'lodash.debounce'
import defaults from 'lodash.defaults'
import get from 'lodash.get'
import isBoolean from 'lodash.isboolean'
import isEqual from 'lodash.isequal'
import isFunction from 'lodash.isfunction'
import isNumber from 'lodash.isnumber'
import isObject from 'lodash.isobject'
import isString from 'lodash.isstring'
import isSymbol from 'lodash.issymbol'
import mergeWith from 'lodash.mergewith'
import set from 'lodash.set'
import uniq from 'lodash.uniq'
import { stringify, parse } from 'qs'

export {
  castArray,
  isFunction,
  isObject,
  isString,
  uniq,
  isSymbol,
  debounce,
  get,
  isBoolean,
  isNumber,
  mergeWith,
  set,
  cloneDeep,
  isEqual,
  defaults,
}

export function isArray(value: any): value is any[] {
  return Array.isArray(value)
}

export function isSSR(): boolean {
  return typeof window === 'undefined'
}

export function isDefined<TValue>(value: TValue | undefined): value is TValue {
  return typeof value !== 'undefined'
}

export function throwError(message: string, ..._args: any[]): never {
  throw new Error(`Navigare: ${message}.`)
}

export function shouldInterceptLink(
  event: KeyboardEvent | MouseEvent,
): boolean {
  const { target } = event

  if (!target) {
    return false
  }

  const element = target as HTMLElement

  if (element.isContentEditable) {
    return false
  }

  if (event.defaultPrevented) {
    return false
  }

  // Left mouse click
  if (
    ('which' in event && event.which !== 1) ||
    ('button' in event ? event.button !== 0 : false)
  ) {
    return false
  }

  if (event.altKey) {
    return false
  }

  if (event.ctrlKey) {
    return false
  }

  if (event.metaKey) {
    return false
  }

  if (event.shiftKey) {
    return false
  }

  return true
}

export function mergeDataIntoQueryString(
  method: RouteMethod,
  href: string,
  data: Record<string, FormDataConvertible>,
  queryStringArrayFormat: QueryStringArrayFormat = QueryStringArrayFormat.Indices,
): {
  href: string
  data: Record<string, FormDataConvertible>
  method: RouteMethod
} {
  const hasHost = /^https?:\/\//.test(href)
  const hasAbsolutePath = hasHost || href.startsWith('/')
  const hasRelativePath =
    !hasAbsolutePath && !href.startsWith('#') && !href.startsWith('?')
  const hasSearch =
    href.includes('?') ||
    (method === RouteMethod.GET && Object.keys(data).length)
  const hasHash = href.includes('#')

  const url = new URL(href, 'http://localhost')

  if (method === RouteMethod.GET && Object.keys(data).length) {
    url.search = stringify(
      mergeWith(parse(url.search, { ignoreQueryPrefix: true }), data),
      {
        encodeValuesOnly: true,
        arrayFormat: queryStringArrayFormat,
      },
    )
    data = {}
  }

  return {
    href: [
      hasHost ? `${url.protocol}//${url.host}` : '',
      hasAbsolutePath ? url.pathname : '',
      hasRelativePath ? url.pathname.substring(1) : '',
      hasSearch ? url.search : '',
      hasHash ? url.hash : '',
    ].join(''),
    data,
    method,
  }
}

export function mergeFragments<TComponentModule>(
  allCurrentFragments: Fragments,
  allNextFragments: Fragments,
  options: RouterOptions<TComponentModule>['fragments'] = {},
): Fragments {
  return uniq([
    ...getKeys(allCurrentFragments),
    ...getKeys(allNextFragments),
  ]).reduce((allCumulatedFragments, name) => {
    let cumulatedFragments: (Fragment | null)[] | null | undefined =
      allCumulatedFragments[name]
    const nextFragments = allNextFragments[name] as
      | (Fragment | null)[]
      | null
      | undefined

    // For simplicity we assume that there is only one next fragment
    const nextFragment = castArray(nextFragments)[0]
    const nextLocation = nextFragment?.page?.location.href
    const nextComponentId = nextFragment?.component.id

    // Resolve all options
    const resolveOption = <TReturn>(
      option: FragmentOption<TReturn>,
      defaultValue: NonNullable<TReturn>,
    ): NonNullable<TReturn> => {
      if (!isDefined(option)) {
        return defaultValue
      }

      if (isFunction(option)) {
        return (
          option({
            name,
            currentFragments: allCurrentFragments,
            nextFragments: allNextFragments,
          }) ?? defaultValue
        )
      }

      return option ?? defaultValue
    }
    const stacked = resolveOption(
      options[name]?.stacked,
      resolveOption(options[name]?.modal, false),
    )
    const inert = resolveOption(
      options[name]?.inert,
      (() => {
        return Object.keys(allNextFragments).some((nextFragmentName) => {
          return resolveOption(options[nextFragmentName]?.modal, false)
        })
      })(),
    )
    const lazy = resolveOption(options[name]?.lazy, true)

    if (nextFragment) {
      if (cumulatedFragments) {
        cumulatedFragments = [...cumulatedFragments]

        let index = 0
        for (const currentFragment of cumulatedFragments) {
          let stop = !stacked
          const currentLocation = currentFragment?.page?.location.href
          const currentComponentId = currentFragment?.component.id

          // Replace previous fragment
          if (
            (nextFragment.fallback && currentFragment) ||
            !stacked ||
            (!!stacked && currentLocation === nextLocation)
          ) {
            nextFragment.properties = {
              ...currentFragment?.properties,
              ...nextFragment.properties,
            }

            // Reuse component by using the same visit
            if (
              (lazy && currentComponentId === nextComponentId) ||
              currentLocation === nextLocation
            ) {
              nextFragment.page!.visit = currentFragment?.page?.visit!
            }

            cumulatedFragments.splice(index, 9e9, nextFragment)
            stop = true
          } else {
            cumulatedFragments.push(nextFragment)
          }

          // In case this fragment is not stacked, we can safely stop after the first iteration
          if (stop) {
            break
          }

          index++
        }
      } else if (cumulatedFragments === null && nextFragment?.fallback) {
        cumulatedFragments = null
      } else {
        cumulatedFragments = [nextFragment]
      }
    } else if (nextFragment === null) {
      cumulatedFragments = null
    } else if (!nextFragment && !inert) {
      cumulatedFragments = null
    }

    if (!isDefined(cumulatedFragments)) {
      return allCumulatedFragments
    }

    return {
      ...allCumulatedFragments,
      [name]: cumulatedFragments,
    }
  }, allCurrentFragments)
}

export function assignPageToFragments(page: Page) {
  for (const fragments of Object.values(page.fragments)) {
    for (const fragment of castArray(fragments).filter(isNotNull)) {
      if (fragment.page) {
        continue
      }

      const { fragments, ...pageWithoutFragments } = page
      fragment.page = pageWithoutFragments
    }
  }
}

export function mergePages<TComponentModule>(
  page: Page | undefined,
  nextPage: Page,
  options: RouterOptions<TComponentModule>['fragments'] = {},
): Page {
  // Merge properties
  nextPage.properties = {
    ...page?.properties,
    ...nextPage.properties,
  }

  // Assign pages to fragments
  if (page) {
    assignPageToFragments(page)
  }

  assignPageToFragments(nextPage)

  // Merge fragments
  nextPage.fragments = mergeFragments(
    page?.fragments || {},
    nextPage.fragments,
    options,
  )

  return nextPage
}

export function isNull<TValue>(value: TValue | null): value is null {
  return value === null
}

export function isNotNull<TValue>(value: TValue | null): value is TValue {
  return value !== null
}

export function getKeys<TValue extends {}>(value: TValue): (keyof TValue)[] {
  return Object.keys(value) as unknown as (keyof TValue)[]
}

export function objectToFormData(
  source: Record<string, FormDataConvertible> = {},
  form: FormData = new FormData(),
  parentKey: string | null = null,
): FormData {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      appendToFormData(form, composeKey(parentKey, key), source[key])
    }
  }

  return form
}

const composeKey = (parent: string | null, key: string): string => {
  return parent ? `${parent}[${key}]` : key
}

const appendToFormData = (
  form: FormData,
  key: string,
  value: FormDataConvertible,
): void => {
  if (Array.isArray(value)) {
    return Array.from(value.keys()).forEach((index) =>
      appendToFormData(form, composeKey(key, index.toString()), value[index]),
    )
  }

  if (value instanceof Date) {
    return form.append(key, value.toISOString())
  }

  if (value instanceof File) {
    return form.append(key, value, value.name)
  }

  if (value instanceof Blob) {
    return form.append(key, value)
  }

  if (typeof value === 'boolean') {
    return form.append(key, value ? '1' : '0')
  }

  if (typeof value === 'string') {
    return form.append(key, value)
  }

  if (typeof value === 'number') {
    return form.append(key, `${value}`)
  }

  if (value === null || value === undefined) {
    return form.append(key, '')
  }

  objectToFormData(value, form, key)
}

export function hasFiles(data: VisitData | FormDataConvertible): boolean {
  if (isSSR()) {
    return false
  }

  if (data instanceof File) {
    return true
  }

  if (data instanceof Blob) {
    return true
  }

  if (data instanceof FileList && data.length > 0) {
    return true
  }

  if (
    data instanceof FormData &&
    Array.from(data.values()).some((value) => hasFiles(value))
  ) {
    return true
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    Object.values(data).some((value) => hasFiles(value))
  ) {
    return true
  }

  return false
}

export function createEmitter<
  TEvents extends Record<
    string,
    {
      details: Record<any, any>
      result: any
    }
  >,
>(
  events: Partial<{
    [TEventName in keyof TEvents]: Partial<{
      options: Partial<EventInit>
      handle: (result: TEvents[TEventName]['result']) => boolean
    }>
  }>,
) {
  const all: Partial<Record<keyof TEvents, ((event: any) => void)[]>> = {}

  const control: {
    off: <
      TEventName extends keyof TEvents,
      TListener extends (event: CustomEvent) => void = (
        event: CustomEvent<TEvents[TEventName]['details']>,
      ) => TEvents[TEventName]['result'],
    >(
      name: TEventName,
      listener: TListener,
    ) => void

    on: <
      TEventName extends keyof TEvents,
      TListener extends (event: CustomEvent) => void = (
        event: CustomEvent<TEvents[TEventName]['details']>,
      ) => TEvents[TEventName]['result'],
    >(
      name: TEventName,
      listener: TListener,
    ) => () => void

    emit: <
      TEventName extends keyof TEvents,
      TListener extends (event: CustomEvent) => any = (
        event: CustomEvent<TEvents[TEventName]['details']>,
      ) => TEvents[TEventName]['result'],
    >(
      name: TEventName,
      details: TEvents[TEventName]['details'],
      priorityListeners?: TListener | (TListener | undefined)[],
    ) => Promise<TEvents[TEventName]['result']>
  } = {
    on: (name, listener) => {
      const listeners = all[name]

      if (listeners) {
        listeners.push(listener)
      } else {
        all[name] = [listener]
      }

      return () => {
        return control.off(name, listener)
      }
    },
    off: (name, listener?) => {
      const listeners = all[name]

      if (listeners) {
        if (listener) {
          listeners.splice(listeners.indexOf(listener) >>> 0, 1)
        } else {
          all[name] = []
        }
      }
    },
    emit: async (name, details, priorityListeners?) => {
      const event = new CustomEvent(String(name), {
        ...events[name]?.options,
        detail: details,
      })

      // Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise.
      const listeners = [
        ...castArray(priorityListeners),
        ...(all[name] ?? []),
      ].filter(isDefined)

      for (const listener of listeners) {
        const result = await listener?.(event as any)

        if (result) {
          return result
        }

        if (!event.cancelable) {
          continue
        }

        if (event.defaultPrevented) {
          return false
        }
      }

      return true
    },
  }

  return control
}

export function mapRouteMethod(
  method: RawRouteMethod | undefined,
): RouteMethod {
  switch (method) {
    case 'GET':
      return RouteMethod.GET
    case 'POST':
      return RouteMethod.POST
    case 'PUT':
      return RouteMethod.PUT
    case 'PATCH':
      return RouteMethod.PATCH
    case 'DELETE':
      return RouteMethod.DELETE
  }

  return RouteMethod.GET
}

export function safeParse<TOutput = unknown, TErrorOutput = undefined>(
  input: string | undefined | null,
  errorCallback?: (error: unknown) => TErrorOutput,
): TOutput | TErrorOutput {
  return safe<TOutput, TErrorOutput>(() => {
    if (!input) {
      throw Error('invalid input')
    }

    return JSON.parse(input)
  }, errorCallback)
}

export function safe<TOutput, TErrorOutput = undefined>(
  callback: () => TOutput,
  errorCallback?: (error: unknown) => TErrorOutput,
): TOutput | TErrorOutput {
  try {
    return callback()
  } catch (error) {
    return errorCallback?.(error) as TErrorOutput
  }
}

export function serialize<TInput>(input: TInput): string {
  return JSON.stringify(input, (_key, value) => {
    if (isFunction(value)) {
      return undefined
    }

    return value
  })
}

export function isDeferred<TInput>(
  input: TInput | DeferredValue,
): input is DeferredValue {
  if (!isObject(input)) {
    return false
  }

  return '__deferred' in input && input.__deferred === true
}

export function getPageProperties(page: Page): Properties {
  const allFragmentProperties = Object.values(page.fragments)
    .flat()
    .filter(isNotNull)
    .filter((fragment) => {
      return fragment.page?.location.href === page.location.href
    })
    .reduce((cumulatedProperties, fragment) => {
      const getPropertySelectors = (properties: Record<string, any>) => {
        return Object.fromEntries(
          Object.entries(properties).map(([propertyName, value]) => {
            return [`${fragment.name}/${propertyName}`, value]
          }),
        )
      }

      if (!fragment) {
        return cumulatedProperties
      }

      return {
        ...cumulatedProperties,
        ...getPropertySelectors(fragment.properties),
      }
    }, {})

  return {
    ...page.properties,
    ...allFragmentProperties,
  }
}

export function getDeferredPageProperties(
  page: Page,
): Record<string, DeferredValue> {
  return Object.fromEntries(
    Object.entries(getPageProperties(page)).filter(([, property]) => {
      return isDeferred(property) && !property.__requested
    }),
  ) as Record<string, DeferredValue>
}

export function transformPropertyKey(
  property: PropertyKey,
  transform: (value: PropertyKey) => PropertyKey = (value) => value,
): string {
  if (isString(property) && property.includes('.')) {
    return property
      .split('.')
      .map((part) => transform(part))
      .join('.')
  }

  return String(transform(property))
}

export function transformPropertyKeys(
  properties: Properties,
  transform: (value: PropertyKey) => PropertyKey = (value) => value,
): Properties {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      return [
        // We don't want `__errors` or `__flash` to be transformed
        key.startsWith('__') ? key : transform(key),
        isObject(value) &&
        !isArray(value) &&
        !(value instanceof Blob) &&
        !(value instanceof Date)
          ? transformPropertyKeys(value, transform)
          : value,
      ]
    }),
  )
}

export function transformPagePropertyKeys(
  page: Page,
  transform: (key: PropertyKey) => PropertyKey = (key) => key,
): Page {
  page.properties = transformPropertyKeys(page.properties, transform)
  page.fragments = Object.fromEntries(
    Object.entries(page.fragments).map(([name, fragments]) => {
      if (fragments) {
        for (const fragment of fragments) {
          if (!fragment) {
            continue
          }

          fragment.properties = transformPropertyKeys(
            fragment.properties,
            transform,
          )
        }
      }

      return [name, fragments]
    }),
  )

  return page
}

export function createQueue<TOutput = void>(
  options: Partial<{
    debounce: number
    max: number
  }> = {},
): {
  push: (task: () => Promise<TOutput>, clear?: boolean) => void
  size: number
} {
  const queue: (() => Promise<TOutput>)[] = []
  let running: boolean = false

  const run = async () => {
    running = true

    while (queue.length) {
      const task = queue.shift()!

      await task()
    }

    running = false
  }
  const start = debounce(() => {
    if (running) {
      return
    }

    run()
  }, options.debounce ?? 0)

  return {
    push: (task) => {
      queue.splice(0, queue.length - Math.max(options.max ?? 1, 1))
      queue.push(task)

      start()
    },
    get size() {
      return queue.length
    },
  }
}

export function clonePage<TPage extends Page | undefined>(page: TPage): TPage {
  // This is just a dummy but maybe it becomes handy in the future
  return page
}
