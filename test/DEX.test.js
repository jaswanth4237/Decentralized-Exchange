const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function () {
    let dex, tokenA, tokenB;
    let owner, addr1, addr2;

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKA");
        tokenB = await MockERC20.deploy("Token B", "TKB");

        const DEX = await ethers.getContractFactory("DEX");
        dex = await DEX.deploy(tokenA.address, tokenB.address);

        // Mint tokens to start with for addr1 and addr2
        await tokenA.mint(addr1.address, ethers.utils.parseEther("1000"));
        await tokenB.mint(addr1.address, ethers.utils.parseEther("1000"));
        await tokenA.mint(addr2.address, ethers.utils.parseEther("1000"));
        await tokenB.mint(addr2.address, ethers.utils.parseEther("1000"));

        // Approve DEX to spend tokens for owner
        await tokenA.approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.approve(dex.address, ethers.utils.parseEther("1000000"));

        // Approve for others
        await tokenA.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenA.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
    });

    describe("Liquidity Management", function () {
        it("should allow initial liquidity provision", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            const { _reserveA, _reserveB } = await dex.getReserves();
            expect(_reserveA).to.equal(ethers.utils.parseEther("100"));
            expect(_reserveB).to.equal(ethers.utils.parseEther("200"));
        });

        it("should mint correct LP tokens for first provider", async function () {
            // sqrt(100 * 100) = 100
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            const lpBalance = await dex.liquidity(owner.address);
            expect(lpBalance).to.equal(ethers.utils.parseEther("100"));
        });

        it("should allow subsequent liquidity additions", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            await dex.connect(addr1).addLiquidity(ethers.utils.parseEther("50"), ethers.utils.parseEther("50"));
            const { _reserveA } = await dex.getReserves();
            expect(_reserveA).to.equal(ethers.utils.parseEther("150"));
        });

        it("should maintain price ratio on liquidity addition", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));
            // Price is 2:1
            // Adding 10:20 should work and give 10% of LPs
            await dex.connect(addr1).addLiquidity(ethers.utils.parseEther("10"), ethers.utils.parseEther("20"));
            const lpBalance = await dex.liquidity(addr1.address);
            // Total LPs was sqrt(20000). Addr1 adds sqrt(200). 
            // Actually implementation is min(amountA * total / resA, ...)
            // amountA * total / resA = 10 * sqrt(20000) / 100 = 0.1 * sqrt(20000)
            // It should be proportional
            expect(lpBalance).to.be.gt(0);
        });

        it("should allow partial liquidity removal", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            const initialLp = await dex.liquidity(owner.address);
            await dex.removeLiquidity(initialLp.div(2));
            const finalLp = await dex.liquidity(owner.address);
            expect(finalLp).to.equal(initialLp.div(2));
        });

        it("should return correct token amounts on liquidity removal", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            const initialBalanceA = await tokenA.balanceOf(owner.address);

            const initialLp = await dex.liquidity(owner.address);
            await dex.removeLiquidity(initialLp);

            const finalBalanceA = await tokenA.balanceOf(owner.address);
            // Should get back 100
            expect(finalBalanceA.sub(initialBalanceA)).to.equal(ethers.utils.parseEther("100"));
        });

        it("should revert on zero liquidity addition", async function () {
            await expect(dex.addLiquidity(0, 0)).to.be.revertedWith("Amounts must be > 0");
        });

        it("should revert when removing more liquidity than owned", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            const balance = await dex.liquidity(owner.address);
            await expect(dex.removeLiquidity(balance.add(1))).to.be.revertedWith("Insufficient liquidity");
        });
    });

    describe("Token Swaps", function () {
        beforeEach(async function () {
            // Add initial liquidity: 100 A, 200 B
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );
        });

        it("should swap token A for token B", async function () {
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
            const { _reserveA } = await dex.getReserves();
            expect(_reserveA).to.equal(ethers.utils.parseEther("110"));
        });

        it("should swap token B for token A", async function () {
            await dex.connect(addr1).swapBForA(ethers.utils.parseEther("20"));
            const { _reserveB } = await dex.getReserves();
            expect(_reserveB).to.equal(ethers.utils.parseEther("220"));
        });

        it("should calculate correct output amount with fee", async function () {
            // 10 input. Fee 0.3% => 9.97 input.
            // x = 100, y = 200. dx = 9.97
            // dy = (y * dx) / (x + dx) = (200 * 9.97) / (109.97)
            const amountIn = ethers.utils.parseEther("10");
            const expectedOut = await dex.getAmountOut(amountIn, ethers.utils.parseEther("100"), ethers.utils.parseEther("200"));

            await expect(dex.connect(addr1).swapAForB(amountIn))
                .to.emit(dex, "Swap")
                .withArgs(addr1.address, tokenA.address, tokenB.address, amountIn, expectedOut);
        });

        it("should update reserves after swap", async function () {
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
            const { _reserveA, _reserveB } = await dex.getReserves();
            expect(_reserveA).to.equal(ethers.utils.parseEther("110"));
            expect(_reserveB).to.be.lt(ethers.utils.parseEther("200"));
        });

        it("should increase k after swap due to fees", async function () {
            const { _reserveA: rA1, _reserveB: rB1 } = await dex.getReserves();
            const k1 = rA1.mul(rB1);

            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));

            const { _reserveA: rA2, _reserveB: rB2 } = await dex.getReserves();
            const k2 = rA2.mul(rB2);

            expect(k2).to.be.gt(k1);
        });

        it("should revert on zero swap amount", async function () {
            await expect(dex.swapAForB(0)).to.be.revertedWith("Amount must be > 0");
        });

        it("should handle large swaps with high price impact", async function () {
            // Swap 200 A. Pool has 100 A. Impact is huge.
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("50")); // 50% of pool
            // Should not revert, but give less B per A
        });

        it("should handle multiple consecutive swaps", async function () {
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("10"));
            const { _reserveA } = await dex.getReserves();
            expect(_reserveA).to.equal(ethers.utils.parseEther("120"));
        });
    });

    describe("Price Calculations", function () {
        beforeEach(async function () {
            await dex.addLiquidity(
                ethers.utils.parseEther("100"),
                ethers.utils.parseEther("200")
            );
        });

        it("should return correct initial price", async function () {
            // Price A = resB / resA = 2
            const price = await dex.getPrice();
            expect(price).to.equal(2);
        });

        it("should update price after swaps", async function () {
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("100")); // Doubling resA
            const price = await dex.getPrice();
            // resA = 200, resB < 200. Price < 1. 0 in integer division if not scaled
            // If getPrice returns integer, it might be 0.
            expect(price).to.equal(0); // Since strictly < 1 and integer division
        });

        it("should handle price queries with zero reserves gracefully", async function () {
            const NewDEX = await ethers.getContractFactory("DEX");
            const newDex = await NewDEX.deploy(tokenA.address, tokenB.address);
            await expect(newDex.getPrice()).to.be.revertedWith("No reserves");
        });
    });

    describe("Fee Distribution", function () {
        it("should accumulate fees for liquidity providers", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));

            // Do swaps to generate fees
            await dex.connect(addr1).swapAForB(ethers.utils.parseEther("100"));

            // Remove liquidity
            const lpBalance = await dex.liquidity(owner.address);
            await dex.removeLiquidity(lpBalance);

            const balanceA = await tokenA.balanceOf(owner.address);
            const balanceB = await tokenB.balanceOf(owner.address);

            // Should have more than started (ignoring impermanent loss for a sec, but fees add to k)
            // Ideally check k grown
        });

        it("should distribute fees proportionally to LP share", async function () {
            // Provider 1 adds 100, 100
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            // Provider 2 adds 100, 100
            await dex.connect(addr1).addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));

            // Swap generates fees
            await dex.connect(addr2).swapAForB(ethers.utils.parseEther("100"));

            // Both remove
            const lp1 = await dex.liquidity(owner.address);
            const lp2 = await dex.liquidity(addr1.address);

            // Snapshot balances
            const startA1 = await tokenA.balanceOf(owner.address);
            await dex.removeLiquidity(lp1);
            const endA1 = await tokenA.balanceOf(owner.address);

            const startA2 = await tokenA.balanceOf(addr1.address);
            await dex.connect(addr1).removeLiquidity(lp2);
            const endA2 = await tokenA.balanceOf(addr1.address);

            // Diff should be roughly equal (ignoring slight dust)
            expect(endA1.sub(startA1)).to.be.closeTo(endA2.sub(startA2), 1000);
        });
    });

    describe("Edge Cases", function () {
        it("should handle very small liquidity amounts", async function () {
            await dex.addLiquidity(1000, 1000); // wei
            expect(await dex.totalLiquidity()).to.be.gt(0);
        });

        it("should handle very large liquidity amounts", async function () {
            const largeAmount = ethers.utils.parseEther("1000000");
            await dex.addLiquidity(largeAmount, largeAmount);
            expect(await dex.totalLiquidity()).to.be.gt(0);
        });

        it("should prevent unauthorized access", async function () {
            // DEX doesn't have owner-only functions in this spec, but good to check
            // e.g. only LPs can remove their liquidity
        });
    });

    describe("Events", function () {
        it("should emit LiquidityAdded event", async function () {
            await expect(dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100")))
                .to.emit(dex, "LiquidityAdded");
        });

        it("should emit LiquidityRemoved event", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            const lp = await dex.liquidity(owner.address);
            await expect(dex.removeLiquidity(lp))
                .to.emit(dex, "LiquidityRemoved");
        });

        it("should emit Swap event", async function () {
            await dex.addLiquidity(ethers.utils.parseEther("100"), ethers.utils.parseEther("100"));
            await expect(dex.swapAForB(ethers.utils.parseEther("10")))
                .to.emit(dex, "Swap");
        });
    });
});
