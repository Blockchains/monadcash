// Deterministic executor: requestId = keccak256(abi.encode(chainId, contract, nonceKey, recipient, amount)).
// Pre-checks policy off-chain (simulate) before sending; never retries a consumed requestId.
import { keccak256, encodeAbiParameters } from 'viem';
export function requestId(chainId, contract, key, recipient, amount) {
  return keccak256(encodeAbiParameters(
    [{type:'uint256'},{type:'address'},{type:'string'},{type:'address'},{type:'uint256'}],
    [BigInt(chainId), contract, key, recipient, BigInt(amount)]));
}
export async function executeRequest({ pub, wallet, abi, address, key, recipient, amount }) {
  const chainId = await pub.getChainId();
  const id = requestId(chainId, address, key, recipient, amount);
  if (await pub.readContract({ address, abi, functionName: 'executed', args: [id] }))
    return { id, status: 'SKIPPED_ALREADY_EXECUTED' };
  try {
    const { request } = await pub.simulateContract({ address, abi, functionName: 'execute', args: [id, recipient, BigInt(amount)], account: wallet.account });
    const hash = await wallet.writeContract(request);
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    return { id, status: rcpt.status === 'success' ? 'EXECUTED' : 'REVERTED', hash, block: Number(rcpt.blockNumber) };
  } catch (e) { return { id, status: 'REJECTED_BY_POLICY', reason: e.cause?.data?.errorName ?? e.walk?.(x=>x.data?.errorName)?.data?.errorName ?? e.shortMessage }; }
}
