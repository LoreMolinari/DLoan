// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./LoanTypes.sol";

contract LoanStorage {
    mapping(uint256 => LoanTypes.LoanRequest) public loanRequests;
    uint256 public totalRequests; //loan requests (not funded already!!)

    mapping(uint256 => LoanTypes.ActiveLoan) public activeLoans;
    uint256 public totalLoans; //loans funded

    function getNextRequestId() internal returns (uint256) {
        return totalRequests++;
    }

    function getNextLoanId() internal returns (uint256) {
        return totalLoans++;
    }
}
