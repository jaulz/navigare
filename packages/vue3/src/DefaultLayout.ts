import PageFragments from './PageFragments'
import { defineComponent, h } from 'vue'

export default defineComponent({
  name: 'DefaultLayout',

  props: {
    layout: {
      type: String,
    },
  },

  setup() {
    return () => {
      const renderSlot = (name: string) => {
        return h(PageFragments, {
          name,
        })
      }

      return [renderSlot('default'), renderSlot('modal')]
    }
  },
})
