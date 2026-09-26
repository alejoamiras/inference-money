import { type ContractArtifact, loadContractArtifact } from "@aztec/aztec.js/abi"
import { TokenContractArtifact } from "@aztec-foundation/aztec-standards/artifacts/src/artifacts/Token.js"
// The committed, transpiled artifacts (compile.sh --check keeps them equal to their source). The explicit
// ContractArtifact types keep the multi-megabyte JSON literals out of consumers' type checks.
import bridgeJson from "../../../contracts/aztec/token_bridge/target/token_bridge_contract-TokenBridge.json"
import proxyJson from "../../../contracts/aztec/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json"
import sponsoredFpcJson from "../vendor/sponsored_fpc_contract-SponsoredFPC-5.0.0.json"

export const tokenBridgeArtifact: ContractArtifact = loadContractArtifact(bridgeJson as never)
export const tokenMinterProxyArtifact: ContractArtifact = loadContractArtifact(proxyJson as never)
export const tokenArtifact: ContractArtifact = TokenContractArtifact
/** The 5.0.0 node's SponsoredFPC class (see vendor/README.md); deployed at salt 0. */
export const sponsoredFpcArtifact: ContractArtifact = loadContractArtifact(sponsoredFpcJson as never)
