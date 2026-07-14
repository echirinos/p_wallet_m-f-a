import {encodeFunctionData, getAddress} from 'viem';

/**
 * Demo "exchange" contract address on Base Sepolia. Policy evaluation only
 * inspects the transaction, so the demo does not require deployed code here.
 */
export const EXCHANGE_ADDRESS = getAddress('0x00000000000000000000000000000000000e2c4a');

export const EXCHANGE_ABI = [
  {
    type: 'function',
    name: 'placeOrder',
    stateMutability: 'payable',
    inputs: [
      {name: 'market', type: 'address'},
      {name: 'amountIn', type: 'uint256'},
      {name: 'minOut', type: 'uint256'},
      {name: 'isBuy', type: 'bool'}
    ],
    outputs: []
  }
] as const;

/** Max order size enforced by the trading policy: 0.01 ETH. */
export const MAX_ORDER_WEI = 10_000_000_000_000_000n;

export function encodePlaceOrder(amountInWei: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: EXCHANGE_ABI,
    functionName: 'placeOrder',
    args: ['0x0000000000000000000000000000000000000000', amountInWei, 0n, true]
  });
}
