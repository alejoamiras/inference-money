import { describe, expect, it } from "bun:test"
import { Writable } from "node:stream"
import { describeError, redact, runRedacted } from "./redact"
import { secretNeedles } from "./secrets"

const KEY = `0x${"0b".repeat(32)}` as const
const RPC = "https://eth-sepolia.example.com/v2/Abc123DefGhi456Jkl"

const sink = () => {
	let text = ""
	const stream = new Writable({
		write(chunk, _enc, done) {
			text += String(chunk)
			done()
		},
	})
	return { stream, text: () => text }
}

describe("output redaction", () => {
	it("masks each secret form in any case, and a URL's API key on its own", () => {
		const needles = secretNeedles({ l1PrivateKey: KEY, sepoliaRpcUrl: RPC }, {})
		const out = redact(`k=${KEY.toUpperCase()} bare=${KEY.slice(2)} url=${RPC} key=abc123defghi456jkl`, needles)
		expect(out).toBe("k=[redacted] bare=[redacted] url=[redacted] key=[redacted]")
	})

	it("masks a basic-auth URL as a library prints it with the userinfo stripped, and a short path key", () => {
		const url = "https://alice:hunter22@rpc.example.com/v2/short-key"
		const needles = secretNeedles({ sepoliaRpcUrl: url }, {})
		expect(redact("URL: https://rpc.example.com/v2/short-key", needles)).toBe("URL: [redacted]")
		expect(redact("path /v2/short-key; auth alice:hunter22", needles)).toBe("path [redacted]; auth [redacted]")
	})

	it("redacts a child's output even when a secret straddles two writes, and keeps its exit code", async () => {
		const [out, err] = [sink(), sink()]
		const script = `process.stdout.write("a=${KEY.slice(0, 30)}"); setTimeout(() => { process.stdout.write("${KEY.slice(30)}\\n"); console.error("${RPC}"); process.exit(3) }, 50)`
		const code = await runRedacted(["-e", script], secretNeedles({ l1PrivateKey: KEY, sepoliaRpcUrl: RPC }, {}), out.stream, err.stream)
		expect([code, out.text(), err.text()]).toEqual([3, "a=[redacted]\n", "[redacted]\n"])
	})

	it("reaps a descendant the child leaves behind instead of waiting on the pipes it holds", async () => {
		const [out, err] = [sink(), sink()]
		const script = `const g = require("node:child_process").spawn("sleep", ["30"], { stdio: "inherit" }); console.log(g.pid); process.exit(0)`
		const started = Date.now()
		expect(await runRedacted(["-e", script], [], out.stream, err.stream)).toBe(0)
		expect(Date.now() - started).toBeLessThan(5_000)
		const grandchild = Number(out.text().trim())
		await new Promise((r) => setTimeout(r, 200))
		expect(() => process.kill(grandchild, 0)).toThrow()
	})

	it("describes an error through its causes", () => {
		const e = new Error("outer", { cause: new TypeError("inner") })
		expect(describeError(e)).toBe("Error: outer\n  caused by: TypeError: inner")
	})
})
