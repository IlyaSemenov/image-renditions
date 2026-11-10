# image-renditions

Resize and re-encode uploaded images when a page first shows them, store each result in your S3 bucket or a directory, and serve it from there.

See the [documentation](https://ilyasemenov.github.io/image-renditions/).

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

With an S3 bucket, or a directory that outlives deploys and is shared by every replica, app servers keep no image files: renditions survive redeploys, and any replica serves any of them.

## Install

```sh
npm install image-renditions sharp
```

See [Getting Started](https://ilyasemenov.github.io/image-renditions/getting-started) to set it up in a Nuxt app, and the [documentation](https://ilyasemenov.github.io/image-renditions/) for h3 and other frameworks, storage, scopes, and replicas.
