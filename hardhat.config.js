require("@nomicfoundation/hardhat-toolbox");

// Test account with more funds
const PRIVATE_KEY = "@APIKEY";

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
