require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.17",
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/REPLACE_ME",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : undefined,
      chainId: 11155111,
    }
  }
};
