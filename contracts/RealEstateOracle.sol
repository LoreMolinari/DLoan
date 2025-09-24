pragma solidity ^0.8.0;

// Demo-only mock oracle for a Real World Asset
contract RealEstateOracle {
    int256 private indexValue;
    address public owner;

    event IndexUpdated(int256 newValue);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    constructor(int256 initialValue) {
        owner = msg.sender;
        indexValue = initialValue;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        address prev = owner;
        owner = newOwner;
        emit OwnershipTransferred(prev, newOwner);
    }

    function setIndexValue(int256 newValue) external onlyOwner {
        require(newValue > 0, "invalid value");
        indexValue = newValue;
        emit IndexUpdated(newValue);
    }

    function latestIndex() external view returns (int256, uint8) {
        return (indexValue, 8);
    }
}


