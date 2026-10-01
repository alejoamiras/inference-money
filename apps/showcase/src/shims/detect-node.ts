// The polyfilled `process` makes detect-node report Node, which sends @aztec-labs/foundation's pino logger down the
// worker-thread transport; only the browser transport exists here.
export default false
