// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract DEX {
    using SafeERC20 for IERC20;

    // State variables
    address public tokenA;
    address public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidity;
    
    // Events
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidityMinted);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidityBurned);
    event Swap(address indexed trader, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    
    /// @notice Initialize the DEX with two token addresses
    /// @param _tokenA Address of first token
    /// @param _tokenB Address of second token
    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token address");
        require(_tokenA != _tokenB, "Tokens must be different");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }
    
    /// @notice Add liquidity to the pool
    /// @param amountA Amount of token A to add
    /// @param amountB Amount of token B to add
    /// @return liquidityMinted Amount of LP tokens minted
    function addLiquidity(uint256 amountA, uint256 amountB) 
        external 
        returns (uint256 liquidityMinted) {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");

        if (totalLiquidity == 0) {
            liquidityMinted = Math.sqrt(amountA * amountB);
        } else {
            uint256 liquidityA = (amountA * totalLiquidity) / reserveA;
            uint256 liquidityB = (amountB * totalLiquidity) / reserveB;
            liquidityMinted = Math.min(liquidityA, liquidityB);
        }
        
        require(liquidityMinted > 0, "Insufficient liquidity minted");

        // Update state
        liquidity[msg.sender] += liquidityMinted;
        totalLiquidity += liquidityMinted;
        
        // Transfer tokens from user to DEX
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        
        // Sync reserves
        _updateReserves(IERC20(tokenA).balanceOf(address(this)), IERC20(tokenB).balanceOf(address(this)));
        
        emit LiquidityAdded(msg.sender, amountA, amountB, liquidityMinted);
    }
    
    /// @notice Remove liquidity from the pool
    /// @param liquidityAmount Amount of LP tokens to burn
    /// @return amountA Amount of token A returned
    /// @return amountB Amount of token B returned
    function removeLiquidity(uint256 liquidityAmount) 
        external 
        returns (uint256 amountA, uint256 amountB) {
        require(liquidityAmount > 0, "Amount must be > 0");
        require(liquidity[msg.sender] >= liquidityAmount, "Insufficient liquidity");

        amountA = (liquidityAmount * reserveA) / totalLiquidity;
        amountB = (liquidityAmount * reserveB) / totalLiquidity;
        
        require(amountA > 0 && amountB > 0, "Insufficient amounts");

        liquidity[msg.sender] -= liquidityAmount;
        totalLiquidity -= liquidityAmount;

        IERC20(tokenA).safeTransfer(msg.sender, amountA);
        IERC20(tokenB).safeTransfer(msg.sender, amountB);
        
        // Sync reserves
        _updateReserves(IERC20(tokenA).balanceOf(address(this)), IERC20(tokenB).balanceOf(address(this)));
        
        emit LiquidityRemoved(msg.sender, amountA, amountB, liquidityAmount);
    }
    
    /// @notice Swap token A for token B
    /// @param amountAIn Amount of token A to swap
    /// @return amountBOut Amount of token B received
    function swapAForB(uint256 amountAIn) 
        external 
        returns (uint256 amountBOut) {
        require(amountAIn > 0, "Amount must be > 0");
        
        amountBOut = getAmountOut(amountAIn, reserveA, reserveB);
        
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountAIn);
        IERC20(tokenB).safeTransfer(msg.sender, amountBOut);
        
        _updateReserves(IERC20(tokenA).balanceOf(address(this)), IERC20(tokenB).balanceOf(address(this)));
        
        emit Swap(msg.sender, tokenA, tokenB, amountAIn, amountBOut);
    }
    
    /// @notice Swap token B for token A
    /// @param amountBIn Amount of token B to swap
    /// @return amountAOut Amount of token A received
    function swapBForA(uint256 amountBIn) 
        external 
        returns (uint256 amountAOut) {
        require(amountBIn > 0, "Amount must be > 0");

        amountAOut = getAmountOut(amountBIn, reserveB, reserveA);
        
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBIn);
        IERC20(tokenA).safeTransfer(msg.sender, amountAOut);
        
        _updateReserves(IERC20(tokenA).balanceOf(address(this)), IERC20(tokenB).balanceOf(address(this)));
        
        emit Swap(msg.sender, tokenB, tokenA, amountBIn, amountAOut);
    }
    
    /// @notice Get current price of token A in terms of token B
    /// @return price Current price (reserveB / reserveA)
    function getPrice() external view returns (uint256 price) {
        require(reserveA > 0 && reserveB > 0, "No reserves");
        // Returning price with 18 decimals precision if needed, or just ratio.
        // Prompt asks for reserveB / reserveA. Integer division might be 0.
        // Assuming just simple division as per prompt "Price of Token A = y / x"
        // But in Solidity usually we scale it.
        // The prompt says: "If the pool has 100 ETH and 200,000 USDC, then 1 ETH = 2,000 USDC"
        // 200000 / 100 = 2000.
        return reserveB / reserveA;
    }
    
    /// @notice Get current reserves
    /// @return _reserveA Current reserve of token A
    /// @return _reserveB Current reserve of token B
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }
    
    /// @notice Calculate amount of token B received for given amount of token A
    /// @param amountIn Amount of token A input
    /// @param reserveIn Reserve of input token
    /// @param reserveOut Reserve of output token
    /// @return amountOut Amount of token B output (after 0.3% fee)
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) 
        public 
        pure 
        returns (uint256 amountOut) {
        require(amountIn > 0, "Amount must be > 0");
        require(reserveIn > 0 && reserveOut > 0, "Insufficient liquidity");
        
        // Fee is 0.3% => 99.7% of amountIn is used involves multiplier 997/1000
        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function _updateReserves(uint256 balanceA, uint256 balanceB) private {
        reserveA = balanceA;
        reserveB = balanceB;
    }
}
