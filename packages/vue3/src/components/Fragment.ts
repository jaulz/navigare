import useRouter from '../compositions/useRouter'
import provideFragmentContext from './../contexts/provideFragmentContext'
import { Fragment, safe } from '@navigare/core'
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  h,
  markRaw,
  PropType,
  reactive,
  toRefs,
} from 'vue'

export default defineComponent({
  name: 'Fragment',

  navigare: true,

  props: {
    name: {
      type: String,
      required: true,
    },

    fragment: {
      type: Object as PropType<Fragment>,
      required: true,
    },
  },

  setup(props, { slots }) {
    const router = useRouter()
    const fragment = computed(() => {
      return props.fragment
    })
    const component = computed(() => {
      return fragment.value.component
    })
    const properties = computed(() => {
      return {
        ...fragment.value.page!.properties,
        ...fragment.value.properties,
      }
    })
    const rawRoute = computed(() => {
      return fragment.value.page!.rawRoute
    })
    const parameters = computed(() => {
      return fragment.value.page!.parameters
    })
    const defaults = computed(() => {
      return fragment.value.page!.defaults
    })
    const location = computed(() => {
      return fragment.value.page!.location
    })
    const key = computed(() => {
      return location.value.href
    })
    const componentModule = computed(() => {
      const module = router.instance.getComponentModule(component.value)

      if (module instanceof Promise) {
        return markRaw(
          defineAsyncComponent(async () => {
            return module
          }),
        )
      }

      return module
    })

    // Provide context to children
    const context = reactive({
      name: props.name,
      rawRoute,
      parameters,
      defaults,
      location,
      properties,
    })
    Object.assign(window, {
      [props.name]: context,
    })
    provideFragmentContext(context)

    return () => {
      const defaultSlot = slots.default

      // Disable inheritance of attributes
      safe(() => {
        Object.assign(componentModule.value, {
          inheritAttrs: false,
        })
      })

      // Render component
      const renderedComponentModule = h(
        componentModule.value,
        {
          ...properties.value,
        },
        {},
      )

      if (defaultSlot) {
        return defaultSlot(
          reactive({
            ...toRefs(context),
            key: key.value,
            component: markRaw(renderedComponentModule),
          }),
        )
      }

      return renderedComponentModule
    }
  },
})
