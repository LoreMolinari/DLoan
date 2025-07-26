require("@nomicfoundation/hardhat-toolbox");

// Test account with more funds
const PRIVATE_KEY = "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.17",
  networks: {
    sepolia: {
      url: "https://eth-sepolia.g.alchemy.com/v2/YbuZCbhNu8c8QhXM1cekm2PgPJdHz89A",
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
      gasPrice: 3000000000,
      gas: 2100000,
    }
  }
};