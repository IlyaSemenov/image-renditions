import { encodePath } from "image-renditions"

export default defineRenditionOriginalUrl(() => {
  const { originalsUrl } = useRuntimeConfig().public
  return ({ path }) => `${originalsUrl}/${encodePath(path)}`
})
