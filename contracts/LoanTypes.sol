pragma solidity ^0.8.0;

contract LoanTypes {
    struct LoanRequest {
        address borrower;
        uint256 loanAmount;
        uint256 duration;
        bool isActive;
        uint256 stake;
        uint256 interestRate;
        //Privacy preserving
        bytes32 metadataCommitment;
        string encryptedCid;
        bytes32 propertyIdCommitment;
        string appraisalEncryptedCid;
        uint256 propertyUnits;
    }

    struct ActiveLoan {
        address borrower;
        address lender;
        uint256 loanAmount;
        uint256 startTimestamp;
        uint256 stake;
        uint256 endTime;
        uint256 interestRate;
        bool isRepaid;
        uint256 initialEthPrice;
        uint256 propertyUnits;
    }
}
