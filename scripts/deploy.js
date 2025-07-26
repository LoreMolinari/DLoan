// scripts/deploy.js
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying the contracts with the account:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance));

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

  // Deploy LendingPlatform
  const LendingPlatform = await hre.ethers.getContractFactory("LendingPlatform");
  const lendingPlatform = await LendingPlatform.deploy();
  await lendingPlatform.waitForDeployment();
  const lendingPlatformAddress = await lendingPlatform.getAddress();

  console.log("LoanTypes deployed to:", loanTypesAddress);
  console.log("LoanStorage deployed to:", loanStorageAddress);
  console.log("LendingPlatform deployed to:", lendingPlatformAddress);

  // Save frontend files
  await saveFrontendFiles({
    lendingPlatformAddress,
    loanTypesAddress,
    loanStorageAddress
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
      LoanStorage: addresses.loanStorageAddress
    }, undefined, 2)
  );

  // Save ABIs
  const contractNames = ["LendingPlatform", "LoanTypes", "LoanStorage"];
  
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