---
layout: home

hero:
  name: image-renditions
  text: On-demand image renditions in your own storage
  tagline: Resize and re-encode uploaded images when a page first shows them, store each result in your S3 bucket or a directory, and serve it from there.
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/IlyaSemenov/image-renditions

features:
  - title: Presets, not URL options
    details: Sizes and formats live in a catalog in your code. A URL carries a hash of a preset, so it needs no secret and can be built in the browser.
  - title: Rendered once
    details: The first request renders a rendition and writes it to storage; later requests redirect to it, and your bucket or CDN serves the image.
  - title: Stateless app servers
    details: With an S3 bucket, or a directory that outlives deploys and is shared by every replica, renditions survive redeploys, and any replica serves any of them.
  - title: Nuxt, h3 and beyond
    details: A Nuxt module with a type-checked image component, an h3 event handler, and a framework-neutral handler for other servers.
---

```vue
<RenditionImg preset="avatar" src="avatars/42.jpg" alt="" />
```

```html
<img
  src="/_renditions/v1/avatars/42.jpg/avatar.faf7e221f65d.avif"
  srcset="
    /_renditions/v1/avatars/42.jpg/avatar.faf7e221f65d.avif    1x,
    /_renditions/v1/avatars/42.jpg/avatar@2x.b62b90cf6c3e.avif 2x
  "
  alt=""
/>
```

The handler redirects such a URL to the stored file:

```http
GET /_renditions/v1/avatars/42.jpg/avatar.faf7e221f65d.avif HTTP/1.1

HTTP/1.1 307 Temporary Redirect
Location: https://renditions.example.com/avatars/42.jpg/faf7e221f65d.avif
```

- The first request for such a URL renders a 48×48 AVIF from `avatars/42.jpg` and writes it to storage before the redirect.
- Later requests redirect at once, and your bucket or CDN serves the image.
- Changing the `avatar` preset gives it new URLs, so no browser or CDN keeps showing the old version.

See [Getting Started](./getting-started) to set it up.
