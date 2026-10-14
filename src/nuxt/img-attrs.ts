/** Attributes of an `img` element that belong to the rendition alone. */
const RENDITION_ATTRS = ["src", "srcset", "width", "height"]

/** Name of a default attribute that would set a rendition attribute, in any letter case as HTML ignores it, if there is one. */
export function findRenditionAttr(imgAttrs: object | undefined) {
  return Object.keys(imgAttrs ?? {}).find(name => RENDITION_ATTRS.includes(name.toLowerCase()))
}
