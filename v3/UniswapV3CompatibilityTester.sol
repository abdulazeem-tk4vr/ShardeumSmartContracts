// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.7.6;
pragma abicoder v2;

import '../interfaces/IERC20.sol';

/// @title Uniswap V3 Network Compatibility Tester
/// @notice Performs a set of low-level operations that Uniswap V3 relies on. The goal is NOT to
///         replicate Uniswap logic, but to confirm that the target chain supports the required
///         EVM features (assembly, CREATE2, high-gas transactions, complex math, real token
///         transfers, etc.). Any failure indicates the chain cannot safely host Uniswap V3.
contract UniswapV3CompatibilityTester {
    /*──────────────────────────────────────────────────────────────────────────*
     *                               Data types                                  *
     *──────────────────────────────────────────────────────────────────────────*/

    struct NetworkCapabilities {
        bool supportsCreate2;
        bool supportsAssembly;
        bool supportsComplexMath;
        bool supportsLargeContracts;
        bool supportsHighGasOperations;
        uint256 maxContractSize;
        uint256 maxGasPerTx;
    }

    /*──────────────────────────────────────────────────────────────────────────*
     *                               Storage                                      *
     *──────────────────────────────────────────────────────────────────────────*/

    mapping(uint256 => uint256) private _stressMap; // used during gas-heavy loops

    /*──────────────────────────────────────────────────────────────────────────*
     *                               Events                                       *
     *──────────────────────────────────────────────────────────────────────────*/

    event StressOperationComplete(string label, uint256 gasLeft);
    event TokenSwapCompleted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);

    /*──────────────────────────────────────────────────────────────────────────*
     *                         Public test functions                              *
     *──────────────────────────────────────────────────────────────────────────*/

    /// @notice Exercises sqrt & fixed-point math similar to Uniswap core math.
    function testComplexMath(uint256 amount, uint256 price) external pure returns (uint256 result) {
        uint256 sqrtPrice = _sqrt(price * 2 ** 96);
        uint256 fixedPoint = (amount * sqrtPrice) / 2 ** 96;
        require(fixedPoint <= type(uint128).max, 'Overflow');
        result = (fixedPoint << 96) | (sqrtPrice >> 96);
    }

    /// @notice Basic inline assembly sanity-check.
    function testAssemblyOperations(uint256 a, uint256 b) external pure returns (uint256 res) {
        assembly {
            res := mul(a, b)
            if gt(res, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff) {
                revert(0, 0)
            }
        }
    }

    /// @notice Transfers tokens and charges a 0.3 % fee to confirm ERC-20 flows work.
    /// @dev Does NOT attempt to replicate the Uniswap swap math – that is out-of-scope here.
    function testRealTokenSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        IERC20 inToken = IERC20(tokenIn);
        IERC20 outToken = IERC20(tokenOut);
        require(inToken.transferFrom(msg.sender, address(this), amountIn), 'transferFrom failed');
        uint256 fee = (amountIn * 3000) / 1_000_000; // 0.3 %
        amountOut = amountIn - fee;
        require(amountOut >= minAmountOut, 'slippage');
        require(outToken.balanceOf(address(this)) >= amountOut, 'liquidity');
        require(outToken.transfer(recipient, amountOut), 'transfer failed');
        emit TokenSwapCompleted(tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Gas-heavy loop + storage writes to approximate worst-case V3 interactions.
    function testHighGasOperations() external returns (bool ok) {
        for (uint256 i = 0; i < 100; i++) {
            _stressMap[i] = i * i;
        }
        uint256 sum;
        for (uint256 i = 0; i < 500; i++) {
            sum += this.testComplexMath(i + 1, (i + 1) * 1_000);
        }
        emit StressOperationComplete('high-gas', gasleft());
        ok = sum > 0;
    }

    /// @notice Deterministic deployment check (used by Uniswap pools).
    function testCreate2Deployment(bytes32 salt) external returns (address deployed) {
        bytes memory bytecode = abi.encodePacked(type(_Create2Test).creationCode);
        assembly {
            deployed := create2(0, add(bytecode, 0x20), mload(bytecode), salt)
            if iszero(deployed) {
                revert(0, 0)
            }
        }
        require(_contractSize(deployed) > 0, 'create2 failed');
    }

    /// @notice Returns the size of this contract’s code (sanity-check for size limits).
    function getContractSize() external view returns (uint256) {
        return _contractSize(address(this));
    }

    /// @notice Aggregates individual checks into a capability report.
    function assessNetworkCapabilities() external returns (NetworkCapabilities memory caps) {
        uint256 gasStart = gasleft();
        caps.supportsCreate2 = _safeBoolCall(
            bytes4(keccak256('testCreate2Deployment(bytes32)')),
            abi.encode(bytes32('caps'))
        );
        caps.supportsAssembly = _safeBoolCall(
            bytes4(keccak256('testAssemblyOperations(uint256,uint256)')),
            abi.encode(uint256(1), uint256(1))
        );
        caps.supportsComplexMath = _safeBoolCall(
            bytes4(keccak256('testComplexMath(uint256,uint256)')),
            abi.encode(uint256(1), uint256(1))
        );
        caps.supportsHighGasOperations = _safeBoolCall(bytes4(keccak256('testHighGasOperations()')), '');
        caps.maxContractSize = _contractSize(address(this));
        caps.supportsLargeContracts = caps.maxContractSize > 40_000; // V3 pools ≈ 50 KB
        caps.maxGasPerTx = gasStart - gasleft();
    }

    /*──────────────────────────────────────────────────────────────────────────*
     *                         Internal helpers                                  *
     *──────────────────────────────────────────────────────────────────────────*/

    function _sqrt(uint256 x) private pure returns (uint256 r) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        r = x;
        while (z < r) {
            r = z;
            z = (x / z + z) / 2;
        }
    }

    function _contractSize(address account) private view returns (uint256 size) {
        assembly {
            size := extcodesize(account)
        }
    }

    function _safeBoolCall(bytes4 selector, bytes memory args) private returns (bool ok) {
        (ok, ) = address(this).call(abi.encodePacked(selector, args));
    }
}

/*──────────────────────────────────────────────────────────────────────────────*/
/// @dev Minimal contract deployed via CREATE2 for deterministic-address check.
contract _Create2Test {
    uint256 public constant dummy = 42;
}
