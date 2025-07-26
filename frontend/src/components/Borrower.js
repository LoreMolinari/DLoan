import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button, Table, Card, Badge, Toast } from 'react-bootstrap';
import { ethers } from 'ethers';
import LendingPlatformABI from '../contracts/LendingPlatform.json';
import Address from '../contracts/contract-address.json';

const App = () => {
  // State management of data
  const [formData, setFormData] = useState({ 
    amount: '', 
    date: '', 
    collateral: '',
    interestRate: ''
  });
  
  // Core application state
  const [account, setAccount] = useState('');
  const [balance, setBalance] = useState('');
  const [contract, setContract] = useState(null);
  const [activeLoans, setActiveLoans] = useState([]);
  
  // Toast notification
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState('success');

  // Initialize application
  useEffect(() => {
    const init = async () => {
      await connectWallet();
      await loadContract();
      await loadActiveLoans();
    };
    init();
  }, []);

  // Initialize smart contract 
  const loadContract = async () => {
    try {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const contractAddress = Address.LendingPlatform;
      const contract = new ethers.Contract(contractAddress, LendingPlatformABI.abi, signer);
      setContract(contract);
    } catch (error) {
      console.error("Error loading contract:", error);
      showToastMessage("Error loading contract", 'danger');
    }
  };

  // Connect wallet, set up account listener
  const connectWallet = async () => {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const balance = await provider.getBalance(accounts[0]);
      setBalance(ethers.utils.formatEther(balance));
      
      // Listen for account changes when account changing on metamask
      window.ethereum.on('accountsChanged', async (accounts) => {
        setAccount(accounts[0]);
        const newBalance = await provider.getBalance(accounts[0]);
        setBalance(ethers.utils.formatEther(newBalance));
      });
    } catch (error) {
      console.error("Error connecting:", error);
      showToastMessage("Error connecting to wallet", 'danger');
    }
  };

  // account ETH balance
  const updateBalance = async () => {
    const provider = new ethers.providers.Web3Provider(window.ethereum);
    const newBalance = await provider.getBalance(account);
    setBalance(ethers.utils.formatEther(newBalance));
  };

  // Handle interest rate validation
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    
    if (name === 'interestRate') {
      const rate = parseFloat(value);
      if (rate > 7) {
        showToastMessage("Interest rate cannot exceed 7%", 'warning');
        return;
      }
      if (rate < 0) {
        showToastMessage("Interest rate cannot be negative", 'warning');
        return;
      }
    }
    
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // New loan request
  const createLoanRequest = async (e) => {
    e.preventDefault();
    if (!contract) return;

    try {
      // Convert values to appropriate formats
      const amountInWei = ethers.utils.parseEther(formData.amount);
      const collateralInWei = ethers.utils.parseEther(formData.collateral);
      const durationInDays = Number(formData.duration);
      const interestRate = Math.floor(Number(formData.interestRate));

      // Validate loan duration
      if (durationInDays <= 0) {
        showToastMessage("Repayment date must be in the future", 'warning');
        return;
      }

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const nonce = await provider.getTransactionCount(account);
      
      // Send transaction
      const tx = await contract.createLoanRequest(
        amountInWei,
        durationInDays,
        interestRate,
        {
          value: collateralInWei,
          nonce,
          gasLimit: ethers.utils.hexlify(1000000)
        }
      );
      
      await tx.wait();
      
      // Update UI
      await updateBalance();
      await loadActiveLoans();
      
      setFormData({ amount: '', duration: '', collateral: '', interestRate: '' });
      showToastMessage("Loan request created successfully", 'success');
    } catch (error) {
      console.error("Error:", error);
      showToastMessage(error.reason || "Transaction failed", 'danger');
    }
  };

  // Load all active loans and loan requests
  const loadActiveLoans = async () => {
    if (!contract || !account) return;
    try {
      const [loanIds, loans, requestIds, requests] = await contract.getAllActiveLoans();
      
      // Active loans
      const activeLoansData = loanIds.map((id, index) => ({
        loanId: id.toString(),
        borrower: loans[index].borrower,
        loanAmount: ethers.utils.formatEther(loans[index].loanAmount),
        endTime: new Date(loans[index].endTime.toNumber() * 1000).toLocaleDateString(),
        interestRate: loans[index].interestRate.toString(),
        stake: ethers.utils.formatEther(loans[index].stake),
        initialEthPrice: ethers.utils.formatUnits(loans[index].initialEthPrice, 18),
        state: "ACTIVE"
      }));
  
      // Loan requests
      const requestLoansData = requestIds.map((id, index) => ({
        loanId: id.toString(),
        borrower: requests[index].borrower,
        loanAmount: ethers.utils.formatEther(requests[index].loanAmount),
        duration: requests[index].duration.toString(),
        stake: ethers.utils.formatEther(requests[index].stake),
        interestRate: requests[index].interestRate.toString(),
        initialEthPrice: 'N/A',
        state: "PENDING"
      }));
  
      // Filtering by user's loans
      const combinedLoans = [...activeLoansData, ...requestLoansData]
        .filter(loan => loan.borrower.toLowerCase() === account.toLowerCase());
  
      setActiveLoans(combinedLoans);
    } catch (error) {
      console.error("Error loading loans:", error);
      showToastMessage("Error loading loans", 'danger');
    }
  };
  
  // Repay selected loan
  const repayLoan = async (loanId) => {
    if (!contract) return;
    try {
      const loan = await contract.activeLoans(loanId);
      const currentEthPrice = await getEthPrice();
      
      if (!currentEthPrice) {
        showToastMessage("Error fetching ETH price", 'danger');
        return;
      }
  
      // Adapt the loan by the price of USD
      const loanAmountInEth = ethers.utils.formatEther(loan.loanAmount);
      const loanAmountInUSD = parseFloat(loanAmountInEth) * parseFloat(ethers.utils.formatUnits(loan.initialEthPrice, 18));
      const interestInUSD = (loanAmountInUSD * loan.interestRate * (Date.now() / 1000 - loan.startTimestamp)) / (365 * 24 * 60 * 60 * 100);
      const totalDueInUSD = loanAmountInUSD + interestInUSD;
      
      const ethToRepay = totalDueInUSD / currentEthPrice;
  
      console.log("Loan amount in ETH:", loanAmountInEth);
      console.log("Initial ETH price:", ethers.utils.formatUnits(loan.initialEthPrice, 18));
      console.log("Current ETH price:", currentEthPrice);
      console.log("Total due in USD:", totalDueInUSD);
      console.log("ETH to repay:", ethToRepay);

      const ethToRepayInWei = ethers.utils.parseEther(ethToRepay.toFixed(18));


      // Smart contract Loan Repay
      const tx = await contract.repayLoan(loanId, ethToRepayInWei, { value: ethToRepayInWei });

      await tx.wait();
      showToastMessage("Loan repaid successfully", 'success');

      // Update UI
      await updateBalance();
      await loadActiveLoans();
    } catch (error) {
        console.error("Error repaying loan:", error);
        showToastMessage(error.reason || "Error repaying loan", 'danger');

        // Update UI
        await updateBalance();
        await loadActiveLoans();
    }
  };
  
  
  // API to retrieve USD-ETH price
  const getEthPrice = async () => {
    try {
      const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const data = await response.json();
      return data.ethereum.usd;
    } catch (error) {
      console.error("Error fetching ETH price:", error);
      return null;
    }
  };

  // Toast notifications
  const showToastMessage = (message, variant) => {
    setToastMessage(message);
    setToastVariant(variant);
    setShowToast(true);
  };

  // Graphics
  return (
    <Container className="mt-5">
      {/* Here there is toast Notification */}
      <Toast 
        show={showToast} 
        onClose={() => setShowToast(false)} 
        delay={3000} 
        autohide 
        style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999 }}
      >
        <Toast.Header>
          <strong className="me-auto">Notification</strong>
        </Toast.Header>
        <Toast.Body className={`bg-${toastVariant} text-white`}>{toastMessage}</Toast.Body>
      </Toast>

      {/* Here there is account Information */}
      <Card className="mb-4">
        <Card.Header as="h5">Borrower Dashboard</Card.Header>
        <Card.Body>
          <Card.Text>Account: {account}</Card.Text>
          <Card.Text>Balance: {parseFloat(balance).toFixed(4)} ETH</Card.Text>
        </Card.Body>
      </Card>

      {/* Here there is loan Request Form */}
      <Card className="mb-4">
        <Card.Header as="h5">Create Loan Request</Card.Header>
        <Card.Body>
          <Form onSubmit={createLoanRequest}>
            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm={2}>Amount (ETH)</Form.Label>
              <Col sm={10}>
                <Form.Control 
                  type="number" 
                  step="0.01"
                  name="amount" 
                  value={formData.amount} 
                  onChange={handleInputChange} 
                  required 
                  placeholder="Enter loan amount in ETH"
                />
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm={2}>Interest Rate (%)</Form.Label>
              <Col sm={10}>
                <Form.Control 
                  type="number"
                  step="0.1"
                  min="0"
                  max="7"
                  name="interestRate" 
                  value={formData.interestRate} 
                  onChange={handleInputChange}
                  required 
                  placeholder="Enter interest rate (max 7%)"
                />
                <Form.Text className="text-muted">
                  Maximum interest rate allowed is 7%
                </Form.Text>
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm={2}>Duration</Form.Label>
              <Col sm={10}>
                <Form.Control 
                  type="number"
                  name="duration" 
                  value={formData.duration || ""}
                  onChange={handleInputChange} 
                  required 
                  placeholder="Enter duration in days"
                />
              </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-3">
              <Form.Label column sm={2}>Collateral (ETH)</Form.Label>
              <Col sm={10}>
                <Form.Control 
                  type="number"
                  step="0.01" 
                  name="collateral" 
                  value={formData.collateral} 
                  onChange={handleInputChange} 
                  required 
                  placeholder="Enter collateral amount in ETH"
                />
                <Form.Text className="text-muted">
                  Collateral must be at least 2x the loan amount
                </Form.Text>
              </Col>
            </Form.Group>

            <Button variant="primary" type="submit">Create Loan</Button>
          </Form>
        </Card.Body>
      </Card>

      {/* Active Loans Table */}
      <Card>
        <Card.Header as="h5" className="d-flex justify-content-between align-items-center">
          Active Loans
          <Button variant="outline-primary" onClick={loadActiveLoans}>Refresh Requests</Button>
        </Card.Header>
        <Card.Body>
        <Table responsive>
            <thead>
              <tr>
                <th>ID</th>
                <th>Amount</th>
                <th>Duration</th>
                <th>Interest Rate</th>
                <th>Stake</th>
                <th>Initial ETH Price</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeLoans.map((loan) => (
                <tr key={loan.loanId}>
                  <td>{loan.loanId}</td>
                  <td>{loan.loanAmount} ETH</td>
                  <td>{loan.state === 'ACTIVE' ? loan.endTime : `${loan.duration} days`}</td>
                  <td>{loan.interestRate}%</td>
                  <td>{loan.stake || 'N/A'} ETH</td>
                  <td>{loan.state === 'ACTIVE' ? `$${loan.initialEthPrice}` : 'N/A'}</td>
                  <td>
                    <Badge bg={loan.state === 'ACTIVE' ? 'warning' : 'info'}>
                      {loan.state}
                    </Badge>
                  </td>
                  <td>
                    {loan.state === 'ACTIVE' && (
                      <Button variant="primary" onClick={() => repayLoan(loan.loanId)}>
                        Repay
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </Container>
  );
};

export { App };