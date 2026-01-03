# DEX AMM Project

## Overview
A simplified Decentralized Exchange (DEX) using the Automated Market Maker (AMM) model, similar to Uniswap V2. It supports liquidity provision, token swapping, and LP token management.

## Features
- Initial and subsequent liquidity provision
- Liquidity removal with proportional share calculation
- Token swaps using constant product formula (x * y = k)
- 0.3% trading fee for liquidity providers
- LP token minting and burning

## Architecture
The project consists of a main `DEX.sol` contract that handles all AMM logic and a `MockERC20.sol` for testing. The DEX contract manages liquidity pools and executes trades.

## Mathematical Implementation

### Constant Product Formula
The core invariant is `x * y = k`, where x and y are the reserves of the two tokens. During a swap, `(x + dx) * (y - dy) = k` must hold.

### Fee Calculation
A 0.3% fee is applied to the input amount before the swap calculation.
`amountInWithFee = amountIn * 997`
`numerator = amountInWithFee * reserveOut`
`denominator = (reserveIn * 1000) + amountInWithFee`

### LP Token Minting
- **First Provider**: `sqrt(amountA * amountB)`
- **Subsequent**: `min(amountA * totalLiquidity / reserveA, amountB * totalLiquidity / reserveB)`

## Setup Instructions

### Prerequisites
- Docker and Docker Compose installed
- Git

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd dex-amm
```

2. Start Docker environment:
```bash
docker-compose up -d
```

3. Compile contracts:
```bash
docker-compose exec app npm run compile
```

4. Run tests:
```bash
docker-compose exec app npm test
```

5. Check coverage:
```bash
docker-compose exec app npm run coverage
```

6. Stop Docker:
```bash
docker-compose down
```

## Running Tests Locally (without Docker)
```bash
npm install
npm run compile
npm test
```

## Security Considerations
- Checks for zero amounts
- Reentrancy protection (if applied)
- Overflow protection via Solidity >0.8
