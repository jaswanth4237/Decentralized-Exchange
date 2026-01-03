const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);

    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("Token A", "TKA");
    await tokenA.deployed();
    console.log("Token A deployed to:", tokenA.address);

    const tokenB = await MockERC20.deploy("Token B", "TKB");
    await tokenB.deployed();
    console.log("Token B deployed to:", tokenB.address);

    const DEX = await hre.ethers.getContractFactory("DEX");
    const dex = await DEX.deploy(tokenA.address, tokenB.address);
    await dex.deployed();

    console.log("DEX deployed to:", dex.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
