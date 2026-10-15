/**
 * Function that sends one Redis command, given as its name followed by its arguments, and resolves to the reply.
 *
 * It adapts a client of any library, such as `(args) => client.sendCommand(args)` of node-redis.
 * It also gets the only key the command touches, for a cluster client that routes commands by key.
 * It must resolve to the reply as clients decode it by default: a status such as `OK` as a string, an integer as a number, and a missing value as `null`.
 */
export type RedisSendCommand = (args: string[], key: string) => Promise<unknown>

/** Prefix of the keys unless the application passes another. */
export const DEFAULT_PREFIX = "image-renditions:"
