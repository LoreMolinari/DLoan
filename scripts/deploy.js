// scripts/deploy.js
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying the contracts with the account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance));

  // Detect network
  const net = await hre.ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  console.log("Network:", net.name || "unknown", "chainId:", chainId);

  // Deploy LoanTypes
  const LoanTypes = await hre.ethers.getContractFactory("LoanTypes");
  const loanTypes = await LoanTypes.deploy();
  await loanTypes.waitForDeployment();
  const loanTypesAddress = await loanTypes.getAddress();

  // Deploy LoanStorage
  const LoanStorage = await hre.ethers.getContractFactory("LoanStorage");
  const loanStorage = await LoanStorage.deploy();
  await loanStorage.waitForDeployment();
  const loanStorageAddress = await loanStorage.getAddress();

  // Deploy LendingPlatform with Demo or Chainlink ETH/USD change
  // For localhost test, demo price mode by passing zero address and fixed price.
  let chainlinkEthUsdFeed;
  if (chainId === 31337) {
    chainlinkEthUsdFeed = hre.ethers.ZeroAddress;
    console.log("Using demo price mode (no oracle)");
  } else {
    chainlinkEthUsdFeed = process.env.CHAINLINK_ETH_USD_FEED || "Put here the address of the Chainlink ETH/USD feed";
    console.log("Using external ETH/USD feed:", chainlinkEthUsdFeed);
  }
  const LendingPlatform = await hre.ethers.getContractFactory("LendingPlatform");
  const lendingPlatform = await LendingPlatform.deploy(chainlinkEthUsdFeed);
  await lendingPlatform.waitForDeployment();
  const lendingPlatformAddress = await lendingPlatform.getAddress();

  // If in demo mode, set a fixed ETH/USD price (1e18-scaled USD per ETH)
  if (chainId === 31337) {
    const demoPrice = hre.ethers.parseUnits("2000", 18); // 2000 USD per ETH
    const txPrice = await lendingPlatform.setDemoFixedEthUsdPrice(demoPrice);
    await txPrice.wait();
    console.log("Demo fixed ETH/USD price set to:", demoPrice.toString());
  }

  // Deploy demo RealEstateOracle
  const initialRwaIndex = process.env.RWA_INDEX_INITIAL || "30000000000000";
  const RealEstateOracle = await hre.ethers.getContractFactory("RealEstateOracle");
  const realEstateOracle = await RealEstateOracle.deploy(initialRwaIndex);
  await realEstateOracle.waitForDeployment();
  const realEstateOracleAddress = await realEstateOracle.getAddress();

  // Wire RWA oracle into LendingPlatform
  const txSetRwa = await lendingPlatform.updateRealEstateOracle(realEstateOracleAddress);
  await txSetRwa.wait();

  console.log("LoanTypes deployed to:", loanTypesAddress);
  console.log("LoanStorage deployed to:", loanStorageAddress);
  console.log("LendingPlatform deployed to:", lendingPlatformAddress);
  console.log("RealEstateOracle deployed to:", realEstateOracleAddress);

  // Save frontend files
  await saveFrontendFiles({
    lendingPlatformAddress,
    loanTypesAddress,
    loanStorageAddress,
    realEstateOracleAddress
  });
}

async function saveFrontendFiles(addresses) {
  const fs = require("fs");
  const contractsDir = path.join(__dirname, "..", "frontend", "src", "contracts");

  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }
  
  // Save addresses
  fs.writeFileSync(
    path.join(contractsDir, "contract-address.json"),
    JSON.stringify({
      LendingPlatform: addresses.lendingPlatformAddress,
      LoanTypes: addresses.loanTypesAddress,
      LoanStorage: addresses.loanStorageAddress,
      RealEstateOracle: addresses.realEstateOracleAddress
    }, undefined, 2)
  );

  // Save ABIs
  const contractNames = ["LendingPlatform", "LoanTypes", "LoanStorage", "RealEstateOracle"];
  
  for (const contractName of contractNames) {
    const artifact = await hre.artifacts.readArtifact(contractName);
    fs.writeFileSync(
      path.join(contractsDir, `${contractName}.json`),
      JSON.stringify(artifact, null, 2)
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });