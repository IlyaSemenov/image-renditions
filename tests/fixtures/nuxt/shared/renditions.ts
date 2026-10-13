import { defineCatalog } from "image-renditions"

export default defineCatalog({
  basePath: "/images",
  presets: { avatar: { width: 48, height: 48, enlarge: true, densities: [1, 2] } },
})
