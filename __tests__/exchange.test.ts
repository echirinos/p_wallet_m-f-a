import {it, expect} from 'vitest';
import {decodeFunctionData} from 'viem';
import {EXCHANGE_ABI, encodePlaceOrder} from '../lib/exchange';

it('encodes placeOrder calldata that round-trips', () => {
  const data = encodePlaceOrder(5_000_000_000_000_000n);
  const {functionName, args} = decodeFunctionData({abi: EXCHANGE_ABI, data});
  expect(functionName).toBe('placeOrder');
  expect(args![1]).toBe(5_000_000_000_000_000n);
});
