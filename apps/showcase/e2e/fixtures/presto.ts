/**
 * Presto for a browser run: presto-server (started by `e2e/presto.sh`) speaks HTTP only, while the page's SDK proves over
 * HTTPS only, so each test runs this proxy on the run's HTTPS port. presto-server approves any localhost origin, so the
 * proxy is what refuses every origin but the run's own.
 */
import { createHash, X509Certificate } from "node:crypto"
import { readFileSync } from "node:fs"
import { request } from "node:http"
import { createServer } from "node:https"
import type { PrestoRun } from "../env"

export interface ProxiedRequest {
	method: string
	path: string
	status: number
}

export interface PrestoProxy {
	/** Every request the proxy received, in order, with the status it answered. */
	readonly seen: ProxiedRequest[]
	start(): Promise<void>
	/** Closes the port and every open connection: the page then finds no Presto over HTTPS. */
	stop(): Promise<void>
}

/** The run's certificate as the browser pins it: the SHA-256 of its public key, base64 (`--ignore-certificate-errors-spki-list`). */
export function spkiPin(tlsDir: string): string {
	const key = new X509Certificate(readFileSync(`${tlsDir}/cert.pem`)).publicKey.export({ type: "spki", format: "der" })
	return createHash("sha256").update(key).digest("base64")
}

/** The two origins the page reaches Presto at: HTTPS to prove, HTTP for the SDK's witness-free health diagnostic only. */
export const prestoOrigins = (p: PrestoRun): [https: string, http: string] => [
	`https://127.0.0.1:${p.tlsPort}`,
	`http://127.0.0.1:${p.port}`,
]

export function prestoProxy(p: PrestoRun, webOrigin: string): PrestoProxy {
	const seen: ProxiedRequest[] = []
	const server = createServer({ key: readFileSync(`${p.tlsDir}/key.pem`), cert: readFileSync(`${p.tlsDir}/cert.pem`) }, (req, res) => {
		const entry: ProxiedRequest = { method: req.method ?? "", path: req.url ?? "", status: 0 }
		seen.push(entry)
		if (req.headers.origin !== webOrigin) {
			entry.status = 403
			res.writeHead(403).end()
			return
		}
		const upstream = request(
			{
				host: "127.0.0.1",
				port: p.port,
				method: req.method,
				path: req.url,
				headers: { ...req.headers, host: `127.0.0.1:${p.port}` },
			},
			(up) => {
				entry.status = up.statusCode ?? 502
				res.writeHead(entry.status, up.headers)
				up.pipe(res)
			},
		)
		upstream.on("error", () => {
			entry.status = 502
			if (!res.headersSent) res.writeHead(502)
			res.end()
		})
		req.pipe(upstream)
	})
	return {
		seen,
		start: () =>
			new Promise((resolve, reject) => {
				server.once("error", reject)
				server.listen(p.tlsPort, "127.0.0.1", () => resolve())
			}),
		stop: () =>
			new Promise((resolve) => {
				if (!server.listening) return resolve()
				server.close(() => resolve())
				server.closeAllConnections()
			}),
	}
}
