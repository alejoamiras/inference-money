export const USERS = ["alice", "bob"] as const
export const MERCHANTS = ["galactica", "supplier"] as const
export const ACTORS = [...USERS, ...MERCHANTS] as const
export type User = (typeof USERS)[number]
export type Merchant = (typeof MERCHANTS)[number]
export type Actor = User | Merchant

export const isUser = (a: Actor): a is User => (USERS as readonly string[]).includes(a)
