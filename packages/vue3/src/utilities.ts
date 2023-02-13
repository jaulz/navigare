import {
  PartialRoute,
  Routable,
  castArray,
  isArray,
  isFunction,
  isObject,
  Fragment,
} from '@navigare/core'
import { PropType, Slot, VNode } from 'vue'

function getVNodesText(children: VNode[]): string {
  return children
    .map((node) => {
      if (!node.children || typeof node.children === 'string') {
        return node.children || ''
      } else if (isArray(node.children)) {
        return getVNodesText(node.children as VNode[])
      } else if (isObject(node.children) && isFunction(node.children.default)) {
        return getVNodesText(node.children.default())
      }
    })
    .join('')
    .trim()
}

export function getVNodeText(
  vnode: VNode | VNode[] | Slot | undefined,
): string {
  if (!vnode) {
    return ''
  }

  return getVNodesText(isFunction(vnode) ? vnode() : castArray(vnode))
}

export function getRoutePropType(): PropType<
  Routable | [Routable, ...(PartialRoute | string)[]]
> {
  return [String, Object, Array] as any
}

export function getFragmentKey(fragment: Fragment): string {
  return [
    fragment.page?.visit.id,
    // page.value.location.href,
    fragment.component.id,
  ].join('-')
}
