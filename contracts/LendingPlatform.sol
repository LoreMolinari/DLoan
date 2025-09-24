pragma solidity ^0.8.0;

import "./LoanTypes.sol";
import "./LoanStorage.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

// Mock real estate oracle
interface IRealEstateOracle {
    function latestIndex() external view returns (int256, uint8);
}

contract LendingPlatform is LoanStorage {
    uint256 public constant MAX_INTEREST_RATE = 7;

    // Reentrancy guard
    uint256 private _reentrancyStatus;
    uint256 private constant _ENTERED = 1;
    uint256 private constant _NOT_ENTERED = 2;

    // Chainlink ETH/USD oracle feed (8 decimals)
    AggregatorV3Interface public ethUsdFeed;
    // Demo fixed price used if oracle unset
    uint256 public demoFixedEthUsdPrice = 2000 * 1e18;

    address public realEstateOracle;

    // Owner and pause
    address public owner;
    bool public paused;

    // Configurable parameters
    // Interest as percent (0..7) but penalties and bonuses use basis points (bp)
    uint256 public overdueRepayPenaltyBp = 300; // 3% penalty applied to total USD due when repaid after expiry
    uint256 public liquidationBonusBp = 300; // 3% of collateral awarded to lender
    uint256 public maxPriceStalenessSeconds = 1 hours; // max allowed staleness of oracle price

    modifier nonReentrant() {
        require(_reentrancyStatus != _ENTERED, "ReentrancyGuard: reentrant call");
        _reentrancyStatus = _ENTERED;
        _;
        _reentrancyStatus = _NOT_ENTERED;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Paused");
        _;
    }

    constructor(address _ethUsdFeed) {
        _reentrancyStatus = _NOT_ENTERED;
        // Zero address -> demo price mode
        if (_ethUsdFeed != address(0)) {
            ethUsdFeed = AggregatorV3Interface(_ethUsdFeed);
        }
        owner = msg.sender;
        paused = false;
    }

    event LoanRequested(
        uint256 indexed requestId,
        address indexed borrower,
        uint256 loanAmount,
        uint256 durationInDays,
        uint256 interestRate,
        uint256 stake
    );

    event LoanFunded(
        uint256 indexed loanId,
        uint256 indexed requestId,
        address indexed lender,
        uint256 initialEthPrice
    );

    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed lender,
        uint256 repayAmount
    );

    event LoanLiquidated(
        uint256 indexed loanId,
        address indexed lender,
        uint256 collateralTransferred
    );

    event OwnerUpdated(address indexed oldOwner, address indexed newOwner);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event ParamsUpdated(uint256 overdueRepayPenaltyBp, uint256 liquidationBonusBp, uint256 maxPriceStalenessSeconds);
    event OracleUpdated(address indexed newFeed);
    event RealEstateOracleUpdated(address indexed newOracle);

    function createLoanRequest(
        uint256 _loanAmount,
        uint256 _durationInDays,
        uint256 _interestRate,
        bytes32 _metadataCommitment,
        string calldata _encryptedCid,
        bytes32 _propertyIdCommitment,
        string calldata _appraisalEncryptedCid,
        uint256 _propertyUnits
    ) external payable whenNotPaused {
        require(_loanAmount > 0, "Loan amount must be greater than 0");
        require(_durationInDays > 0, "Duration must be greater than 0");
        // Collateral must be exactly 2x the loan amount
        require(msg.value == _loanAmount * 2, "Collateral must be exactly 2x loan amount");
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
        // Privacy-preserving: store only commitment + encrypted reference
        request.metadataCommitment = _metadataCommitment;
        request.encryptedCid = _encryptedCid;
        // Compliance/audit demo: bind property and encrypted appraisal evidence
        request.propertyIdCommitment = _propertyIdCommitment;
        request.appraisalEncryptedCid = _appraisalEncryptedCid;
        request.propertyUnits = _propertyUnits;

        emit LoanRequested(requestId, msg.sender, _loanAmount, _durationInDays, _interestRate, msg.value);
    }

    function fundLoanRequest(
        uint256 _requestId
    ) external payable nonReentrant whenNotPaused {
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
        loan.interestRate = request.interestRate; // percent (0-7)
        loan.initialEthPrice = _getEthUsdPrice(); // 1e18-scaled USD price
        // Carry forward demo property units so UIs can display after funding
        loan.propertyUnits = request.propertyUnits;

        request.isActive = false;

        // Effects before interactions
        emit LoanFunded(loanId, _requestId, msg.sender, loan.initialEthPrice);

        // index for lookups
        borrowerToLoanIds[request.borrower].push(loanId);
        lenderToLoanIds[msg.sender].push(loanId);

        // call-based ETH transfer
        (bool sentBorrower, ) = payable(request.borrower).call{value: msg.value}("");
        require(sentBorrower, "Borrower transfer failed");
    }

    // Repay loan
    function repayLoan(
        uint256 _loanId,
        uint256 _repayAmount
    ) external payable nonReentrant whenNotPaused {
        LoanTypes.ActiveLoan storage loan = activeLoans[_loanId];

        require(msg.sender == loan.borrower, "Only borrower can repay");
        require(!loan.isRepaid, "Loan already repaid");
        require(msg.value > 0, "Invalid repay amount");

        // Calculate amount due in ETH
        uint256 dueEth = calculateAmountDueEth(_loanId);
        // Overdue penalty
        if (block.timestamp > loan.endTime) {
            uint256 dueEthWithPenalty = _applyOverduePenaltyEth(_loanId, dueEth);
            dueEth = dueEthWithPenalty;
        }
        require(msg.value >= dueEth, "Insufficient repayment");

        // Effects
        loan.isRepaid = true;

        // Interactions
        (bool sentLender, ) = payable(loan.lender).call{value: dueEth}("");
        require(sentLender, "Lender transfer failed");
        (bool sentBorrowerStake, ) = payable(loan.borrower).call{value: loan.stake}("");
        require(sentBorrowerStake, "Collateral return failed");

        // Refund any excess
        uint256 excess = msg.value - dueEth;
        if (excess > 0) {
            (bool refunded, ) = payable(loan.borrower).call{value: excess}("");
            require(refunded, "Refund failed");
        }

        emit LoanRepaid(_loanId, loan.borrower, loan.lender, dueEth);
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
    function liquidateExpiredLoan(uint256 _loanId) external nonReentrant {
        LoanTypes.ActiveLoan storage loan = activeLoans[_loanId];

        require(!loan.isRepaid, "Loan is already repaid");
        require(block.timestamp > loan.endTime, "Loan is not expired yet");

        loan.isRepaid = true;

        // Pay liquidator bonus and the remainder to lender from collateral
        uint256 bonus = (loan.stake * liquidationBonusBp) / 10000;
        uint256 toLender = loan.stake - bonus;

        (bool sentBonus, ) = payable(msg.sender).call{value: bonus}("");
        require(sentBonus, "Bonus transfer failed");
        (bool sentLender, ) = payable(loan.lender).call{value: toLender}("");
        require(sentLender, "Collateral transfer failed");

        emit LoanLiquidated(_loanId, loan.lender, loan.stake);
    }

    // View: calculate amount due in ETH
    function calculateAmountDueEth(uint256 _loanId) public view returns (uint256) {
        LoanTypes.ActiveLoan storage loan = activeLoans[_loanId];
        require(!loan.isRepaid, "Loan repaid");

        uint256 elapsed = block.timestamp > loan.startTimestamp ? (block.timestamp - loan.startTimestamp) : 0;
        // principal in USD (1e18): loanAmount(wei) * price(USD 1e18) / 1e18 (1 ETH = price USD).
        uint256 principalUsd = (loan.loanAmount * loan.initialEthPrice) / 1e18;
        uint256 interestUsd = (principalUsd * loan.interestRate * elapsed) / (365 days * 100);
        uint256 totalUsd = principalUsd + interestUsd; // 1e18-scaled USD
        uint256 currentPrice = _getEthUsdPrice(); // 1e18 USD per ETH
        uint256 dueEth = (totalUsd * 1e18) / currentPrice;
        return dueEth;
    }

    function _getEthUsdPrice() internal view returns (uint256) {
        // Demo mode fallback
        if (address(ethUsdFeed) == address(0)) {
            return demoFixedEthUsdPrice;
        }
        uint80 roundId_;
        int256 answer;
        uint256 startedAt_;
        uint256 updatedAt;
        uint80 answeredInRound_;
        (roundId_, answer, startedAt_, updatedAt, answeredInRound_) = ethUsdFeed.latestRoundData();
        require(answer > 0, "Invalid oracle price");
        // staleness check
        require(block.timestamp - updatedAt <= maxPriceStalenessSeconds, "Stale oracle price");
        // scale to 1e18
        return uint256(answer) * 1e10;
    }

    function _applyOverduePenaltyEth(uint256 _loanId, uint256 baseDueEth) internal view returns (uint256) {
        if (overdueRepayPenaltyBp == 0) return baseDueEth;
        // Convert baseDueEth to USD, apply penalty, back to ETH
        uint256 currentPrice = _getEthUsdPrice();
        uint256 baseDueUsd = (baseDueEth * currentPrice) / 1e18; // 1e18 USD
        uint256 penaltyUsd = (baseDueUsd * overdueRepayPenaltyBp) / 10000;
        uint256 totalUsd = baseDueUsd + penaltyUsd;
        return (totalUsd * 1e18) / currentPrice;
    }

    // Owner controls
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        address old = owner;
        owner = newOwner;
        emit OwnerUpdated(old, newOwner);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function updateParams(uint256 _overdueRepayPenaltyBp, uint256 _liquidationBonusBp, uint256 _maxPriceStalenessSeconds) external onlyOwner {
        require(_liquidationBonusBp <= 5000, "bonus too high");
        require(_overdueRepayPenaltyBp <= 5000, "penalty too high");
        overdueRepayPenaltyBp = _overdueRepayPenaltyBp;
        liquidationBonusBp = _liquidationBonusBp;
        maxPriceStalenessSeconds = _maxPriceStalenessSeconds;
        emit ParamsUpdated(overdueRepayPenaltyBp, liquidationBonusBp, maxPriceStalenessSeconds);
    }

    function updateOracle(address _newFeed) external onlyOwner {
        // Allow zero to switch to demo mode
        if (_newFeed == address(0)) {
            ethUsdFeed = AggregatorV3Interface(address(0));
            emit OracleUpdated(_newFeed);
            return;
        }
        ethUsdFeed = AggregatorV3Interface(_newFeed);
        emit OracleUpdated(_newFeed);
    }

    // Set demo fixed price (1e18-scaled USD per ETH)
    function setDemoFixedEthUsdPrice(uint256 _price) external onlyOwner {
        require(_price > 0, "price=0");
        demoFixedEthUsdPrice = _price;
    }

    function updateRealEstateOracle(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "zero address");
        realEstateOracle = _newOracle;
        emit RealEstateOracleUpdated(_newOracle);
    }

    // Expose current RWA index
    function getRealEstateIndex() external view returns (int256 indexValue, uint8 decimals) {
        require(realEstateOracle != address(0), "RWA oracle not set");
        (int256 v, uint8 d) = IRealEstateOracle(realEstateOracle).latestIndex();
        require(v > 0, "invalid RWA index");
        return (v, d);
    }

    // Borrower/lender indexes
    mapping(address => uint256[]) private borrowerToLoanIds;
    mapping(address => uint256[]) private lenderToLoanIds;

    function getBorrowerLoanIds(address borrower) external view returns (uint256[] memory) {
        return borrowerToLoanIds[borrower];
    }

    function getLenderLoanIds(address lender) external view returns (uint256[] memory) {
        return lenderToLoanIds[lender];
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
