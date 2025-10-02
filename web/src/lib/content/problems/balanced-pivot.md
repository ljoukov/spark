## Problem
You are given an integer array `nums`. A pivot index is an index where the sum of all the numbers strictly to the left of the index is equal to the sum of all the numbers strictly to the right of the index.

Return the leftmost pivot index. If no such index exists, return `-1`.

The array can include negative numbers. Your solution should run in linear time.

## Tasks
- Return the first index that balances the array.
- If multiple pivots exist, choose the smallest index.
- If no pivot satisfies the condition, return `-1`.

## Constraints
- `1 <= nums.length <= 10^5`
- `-10^3 <= nums[i] <= 10^3`

## Examples

### Example 1

Input

```
nums = [1, 7, 3, 6, 5, 6]
```

Output: `3`

Explanation: The sum of the numbers to the left of index 3 (1 + 7 + 3 = 11) equals the sum of the numbers to the right (5 + 6 = 11).

### Example 2

Input

```
nums = [2, 1, -1]
```

Output: `0`

Explanation: 0 is a pivot index because the left side sum is 0 (no elements) and the right side sum is `1 + (-1) = 0`.

### Example 3

Input

```
nums = [2, 1, 1]
```

Output: `-1`

Explanation: There is no index where the left and right sums are equal.

## Discussion
A single pass with a running prefix sum and the total sum lets you determine whether the current index is a pivot in constant time. Updating your running totals as you go keeps the solution linear.
