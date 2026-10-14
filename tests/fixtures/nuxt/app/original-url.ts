import { encodePath, type RenditionTarget } from "image-renditions"

export default function useOriginalUrl() {
  const { originalsUrl } = useRuntimeConfig().public
  return ({ path }: RenditionTarget) => `${originalsUrl}/${encodePath(path)}`
}
