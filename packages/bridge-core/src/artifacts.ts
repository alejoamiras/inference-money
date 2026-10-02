import { type ContractArtifact, loadContractArtifact } from "@aztec-labs/aztec.js/abi"
import { SponsoredFPCContractArtifact } from "@aztec-labs/noir-contracts.js/SponsoredFPC"
// The committed, transpiled artifacts (compile.sh --check keeps them equal to their source). The explicit
// ContractArtifact types keep the multi-megabyte JSON literals out of consumers' type checks.
import tokenJson from "../../../contracts/aztec/token/target/merchant_token-Token.json"
import bridgeJson from "../../../contracts/aztec/token_bridge/target/token_bridge_contract-TokenBridge.json"
import proxyJson from "../../../contracts/aztec/token_minter_proxy/target/token_minter_proxy-TokenMinterProxy.json"

export const tokenBridgeArtifact: ContractArtifact = loadContractArtifact(bridgeJson as never)
export const tokenMinterProxyArtifact: ContractArtifact = loadContractArtifact(proxyJson as never)
/** The merchant token: aztec-standards' Token, every function unchanged, plus the merchant list and its rules. */
export const tokenArtifact: ContractArtifact = loadContractArtifact(tokenJson as never)
/** The canonical SponsoredFPC class, deployed at salt 0. */
export const sponsoredFpcArtifact: ContractArtifact = SponsoredFPCContractArtifact
