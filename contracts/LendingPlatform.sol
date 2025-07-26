// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./LoanTypes.sol";
import "./LoanStorage.sol";

contract LendingPlatform is LoanStorage {
    uint256 public constant MAX_INTEREST_RATE = 7;

    function createLoanRequest(
        uint256 _loanAmount,
        uint256 _durationInDays,
        uint256 _interestRate
    ) external payable {
        require(_loanAmount > 0, "Loan amount must be greater than 0");
        require(_durationInDays > 0, "Duration must be greater than 0");
        require(msg.value >= _loanAmount * 2, "Insufficient collateral");
        require(
            _interestRate <= MAX_INTEREST_RATE,
            "Interest rate exceeds maximum allowed (7%)"
        );
        require(_interestRate > 0, "Interest rate must be greater than 0");

        // Creating new loan request
        uint256 requestId = getNextRequestId();
        LoanTypes.LoanRequest storage request = loanRequests[requestId];

        request.borrower = msg.sender;
        request.loanAmount = _loanAmount;
        request.duration = _durationInDays;
        request.isActive = true;
        request.stake = msg.value;
        request.interestRate = _interestRate;
    }

    function fundLoanRequest(
        uint256 _requestId,
        uint256 _initialEthPrice
    ) external payable {
        LoanTypes.LoanRequest storage request = loanRequests[_requestId];

        require(request.isActive, "Request is not active");
        require(msg.value == request.loanAmount, "Must send exact loan amount");

        uint256 loanId = getNextLoanId();
        LoanTypes.ActiveLoan storage loan = activeLoans[loanId];

        loan.borrower = request.borrower;
        loan.lender = msg.sender;
        loan.loanAmount = request.loanAmount;
        loan.stake = request.stake;
        loan.startTimestamp = block.timestamp;
        loan.endTime = block.timestamp + (request.duration * 1 days);
        loan.interestRate = request.interestRate;
        loan.initialEthPrice = _initialEthPrice;

        request.isActive = false;

        payable(request.borrower).transfer(msg.value);
    }

    // Borrower repays loan
    function repayLoan(
        uint256 _loanId,
        uint256 _repayAmount
    ) external payable {
        LoanTypes.ActiveLoan storage loan = activeLoans[_loanId];

        require(msg.sender == loan.borrower, "Only borrower can repay");
        require(!loan.isRepaid, "Loan already repaid");

        loan.isRepaid = true;
        payable(loan.lender).transfer(_repayAmount);
        payable(loan.borrower).transfer(loan.stake);
    }

    function checkLoanStatus(
        uint256 _loanId
    )
        external
        view
        returns (
            bool isRepaid,
            uint256 loanAmount,
            uint256 startTimestamp,
            uint256 endTime,
            uint256 interestRate,
            uint256 initialEthPrice
        )
    {
        LoanTypes.ActiveLoan storage loan = activeLoans[_loanId];
        return (
            loan.isRepaid,
            loan.loanAmount,
            loan.startTimestamp,
            loan.endTime,
            loan.interestRate,
            loan.initialEthPrice
        );
    }

    // Liquidate expired loan
    function liquidateExpiredLoan(uint256 _loanId) external {
        LoanTypes.ActiveLoan storage loan = activeLoans[_loanId];

        require(!loan.isRepaid, "Loan is already repaid");
        require(block.timestamp > loan.endTime, "Loan is not expired yet");

        loan.isRepaid = true;
        payable(loan.lender).transfer(loan.stake);
    }

    function getBorrowerActiveLoans(
        address _borrower
    )
        external
        view
        returns (uint256[] memory loanIds, LoanTypes.LoanRequest[] memory loans)
    {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < totalRequests; i++) {
            if (loanRequests[i].borrower == _borrower) {
                activeCount++;
            }
        }

        loanIds = new uint256[](activeCount);
        loans = new LoanTypes.LoanRequest[](activeCount);

        uint256 arrayIndex = 0;
        for (uint256 i = 0; i < totalRequests; i++) {
            if (loanRequests[i].borrower == _borrower) {
                loanIds[arrayIndex] = i; //the ids are sequentially assigned (see LoanStorage)
                loans[arrayIndex] = loanRequests[i];
                arrayIndex++;
            }
        }
    }

    function getAllActiveLoans()
        external
        view
        returns (
            uint256[] memory loanIds,
            LoanTypes.ActiveLoan[] memory loans,
            uint256[] memory requestIds,
            LoanTypes.LoanRequest[] memory requests
        )
    {
        uint256 activeCount = 0;
        uint256 requestCount = 0;

        for (uint256 i = 0; i < totalLoans; i++) {
            if (!activeLoans[i].isRepaid) {
                activeCount++;
            }
        }
        for (uint256 i = 0; i < totalRequests; i++) {
            if (loanRequests[i].isActive) {
                requestCount++;
            }
        }

        loanIds = new uint256[](activeCount);
        loans = new LoanTypes.ActiveLoan[](activeCount);
        requestIds = new uint256[](requestCount);
        requests = new LoanTypes.LoanRequest[](requestCount);

        uint256 loanIndex = 0;
        uint256 requestIndex = 0;
        for (uint256 i = 0; i < totalLoans; i++) {
            if (!activeLoans[i].isRepaid) {
                loanIds[loanIndex] = i;
                loans[loanIndex] = activeLoans[i];
                loanIndex++;
            }
        }
        for (uint256 i = 0; i < totalRequests; i++) {
            if (loanRequests[i].isActive) {
                requestIds[requestIndex] = i;
                requests[requestIndex] = loanRequests[i];
                requestIndex++;
            }
        }
    }
}
