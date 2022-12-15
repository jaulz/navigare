import Fragments from './Fragments'
import { defineComponent, h, PropType } from 'vue'

export default defineComponent({
  name: 'DefaultLayout',

  navigare: true,

  props: {
    layout: {
      type: [String, null] as PropType<string | null>,
      required: true,
    },
  },

  setup() {
    return () => {
      const renderSlot = (name: string) => {
        return h(Fragments, {
          name,
        })
      }

      return [renderSlot('default'), renderSlot('modal')]
    }
  },
})
