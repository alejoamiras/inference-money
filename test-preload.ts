import { expect } from "bun:test"

// bun test injects its expect into @aztec/foundation on a cold transpile, and that module then calls Jest's
// expect.addEqualityTesters, which bun:test lacks; the no-op keeps bun's structural equality. A warm transpiler cache
// hides this locally.
if (!("addEqualityTesters" in expect)) Object.assign(expect, { addEqualityTesters: () => {} })
