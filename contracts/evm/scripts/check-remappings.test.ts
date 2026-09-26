import { describe, expect, it } from "bun:test"
import { remappingProblems } from "./check-remappings"

const DECLARED = ["@oz/=node_modules/@openzeppelin/contracts/", "forge-std/=node_modules/forge-std/src/"]

describe("remappingProblems", () => {
	it("passes when every target exists and forge applies exactly the declared set", () => {
		expect(remappingProblems(DECLARED, [...DECLARED].reverse(), () => true)).toEqual([])
	})

	it("names the unresolved target and flags auto-detected extras", () => {
		const problems = remappingProblems(DECLARED, [...DECLARED, "circuits/=node_modules/x/"], (p) => !p.includes("forge-std"))
		expect(problems).toHaveLength(2)
		expect(problems[0]).toStartWith("forge-std/=")
		expect(problems[1]).toContain("circuits/=")
	})
})
