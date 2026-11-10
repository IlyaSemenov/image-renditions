import { defineConfig } from "vitepress"

export default defineConfig({
  title: "image-renditions",
  description:
    "On-demand image transformations that persist every result to durable storage and keep app servers stateless",
  // Served from https://ilyasemenov.github.io/image-renditions/
  base: "/image-renditions/",
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [{ text: "Docs", link: "/getting-started" }],
    sidebar: [
      { text: "Getting Started", link: "/getting-started" },
      {
        text: "Images",
        items: [
          { text: "Presets", link: "/presets" },
          { text: "Showing Images", link: "/showing-images" },
          { text: "Scopes", link: "/scopes" },
          { text: "Originals", link: "/originals" },
          { text: "Animation", link: "/animation" },
        ],
      },
      {
        text: "Server",
        items: [
          { text: "Storage", link: "/storage" },
          { text: "Processing", link: "/processing" },
          { text: "h3 and Other Frameworks", link: "/frameworks" },
          { text: "Rendering Outside Requests", link: "/rendering-outside-requests" },
        ],
      },
      {
        text: "Production",
        items: [
          { text: "How a Request Is Served", link: "/requests" },
          { text: "Concurrency and Timeouts", link: "/limits" },
          { text: "Multiple Replicas", link: "/replicas" },
          { text: "Errors", link: "/errors" },
        ],
      },
      { text: "Extending", link: "/extending" },
      { text: "Limitations", link: "/limitations" },
    ],
    search: { provider: "local" },
    editLink: {
      pattern: "https://github.com/IlyaSemenov/image-renditions/edit/main/docs/:path",
    },
    socialLinks: [{ icon: "github", link: "https://github.com/IlyaSemenov/image-renditions" }],
  },
})
