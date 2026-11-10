# Extending

Implement an interface from `image-renditions/server` and pass your implementation to `createRenditionServer()`:

- To use other storage, implement `SourceStore` or `ResultStore` and pass it as `source` or `results`.
- To process images with another library, implement `Processor` and pass it as `processor`.
  Implement its `assertRecipe()` to reject recipes it cannot render, such as animations, when the server is created.
  Return `degradation` from its `process()` to report an image that falls short of its recipe to `onDegradation`.
- To share the index of published renditions between replicas in a database other than Redis, implement `ReadinessIndex` and pass it as `readiness.shared`.
  If a call fails or exceeds `indexTimeout`, the server reports the error to `onError` and checks storage instead, while [outdated URLs](./errors#outdated-urls) fail as `unknown-recipe`.
- To render each rendition once across replicas without Redis, implement `Coordinator` as a shared lock and pass it as `coordinator`.
  Bound the wait for the lock, because the server sets no timeout on it.

The built-in stores, processor, readiness index and coordinator implement the same interfaces and serve as examples.
