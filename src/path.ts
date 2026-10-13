/** Longest accepted logical path or storage key, in UTF-16 code units. */
const MAX_PATH_LENGTH = 1024

/**
 * Checks that a slash-separated path addresses exactly one storage object.
 *
 * Unsafe or ambiguous paths are rejected rather than normalized, so one object never gets several URLs:
 * no leading, trailing or repeated slashes, no `.` or `..` segments, no backslashes, which Windows file systems treat as separators, no NUL characters, which end strings in file system APIs, and no unpaired surrogates, which have no URL encoding.
 */
export function isSafePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    // oxlint-disable-next-line no-control-regex -- NUL is exactly what is rejected
    !/[\\\u0000]|\p{Cs}/u.test(path) &&
    path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..")
  )
}

/** Percent-encodes each segment of a slash-separated path for use in a URL path. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/")
}

/** Checks that a scope is a short token that needs no URL encoding. */
export function isSafeScope(scope: string): boolean {
  return /^[\w-]{1,64}$/.test(scope)
}
