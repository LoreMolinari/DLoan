import React, { useState, useEffect } from 'react';
import { Container, Button, Table, Card, Badge, Toast } from 'react-bootstrap';
import { ethers } from 'ethers';
import LendingPlatformABI from '../contracts/LendingPlatform.json';
import Address from '../contracts/contract-address.json'

const LoanState = { REPAID: "Repaid", ACTIVE: "Active", EXPIRED: "Expired" };

const Lender = () => {
  // Core application state
  const [account, setAccount] = useState('');
  const [balance, setBalance] = useState('');
  const [contract, setContract] = useState(null);
  const [loanRequests, setLoanRequests] = useState([]);
  const [activeLoans, setActiveLoans] = useState([]);
  const [toast, setToast] = useState({ show: false, message: '', variant: 'success' });
  

  // Initialize smart contract 
  useEffect(() => {
    const init = async () => {
      try {
        await connectWallet();
        await loadContract();
        await loadLoanRequests();
        await loadActiveLoans();
      } catch (error) {
        console.error("Initialization error:", error);
        showToast("Error initializing app", 'danger');
      }
    };
    init();
  }, []);

  // Connect wallet, set up account listener
  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);
        await updateBalance(accounts[0]);

        // Listen for account changes when account changing on metamask
        window.ethereum.on('accountsChanged', async (newAccounts) => {
          setAccount(newAccounts[0]);
          await updateBalance(newAccounts[0]);
        });
  
        //Update UI
        await loadLoanRequests();
        await loadActiveLoans();
      } catch (error) {
        console.error("Error connecting wallet:", error);
        showToast("Error connecting to wallet", 'danger');
      }
    } else {
      showToast('Metamask not detected', 'danger');
    }
  };


  // Initialize smart contract
  const loadContract = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const provider = new ethers.providers.Web3Provider(window.ethereum);
        const signer = provider.getSigner();
        const contractAddress = Address.LendingPlatform;
        const contractInstance = new ethers.Contract(contractAddress, LendingPlatformABI.abi, signer);
        setContract(contractInstance);

        //Update UI
        await loadLoanRequests();
        await loadActiveLoans();
      } catch (error) {
        console.error("Error loading contract:", error);
        showToast("Error loading contract", 'danger');
      }
    }
  };


  // account ETH balance
  const updateBalance = async (address) => {
    if (typeof window.ethereum !== 'undefined') {
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const balance = await provider.getBalance(address);
      setBalance(ethers.utils.formatEther(balance));
    }
  };

  // Load active loan requests that can be funded
  const loadLoanRequests = async () => {
    if (!contract || !account) return;
    try {
      const [, , requestIds, requests] = await contract.getAllActiveLoans();
      const requestsData = requestIds.map((id, index) => ({
        requestId: id.toString(),
        borrower: requests[index].borrower,
        amount: ethers.utils.formatEther(requests[index].loanAmount),
        duration: requests[index].duration.toString(),
        stake: ethers.utils.formatEther(requests[index].stake),
        interestRate: requests[index].interestRate.toString(),
        propertyUnits: (requests[index].propertyUnits ? requests[index].propertyUnits.toString() : '0'),
        propertyCommitment: requests[index].propertyIdCommitment,
        isActive: requests[index].isActive
      }));

      // Filter inactive requests and lender's own requests
      setLoanRequests(requestsData.filter(req => 
        req.isActive && req.borrower.toLowerCase() !== account.toLowerCase()
      ));
    } catch (error) {
      console.error("Error loading requests:", error);
      showToast("Error loading loan requests", 'danger');
    }
  };

  // Load loans funded by lender
  const loadActiveLoans = async () => {
    if (!contract || !account) return;
    try {
      const [loanIds, loans, , ] = await contract.getAllActiveLoans();
      const activeLoansData = loans
        .map((loan, index) => ({
          loanId: loanIds[index].toString(),
          borrower: loan.borrower,
          lender: loan.lender,
          amount: ethers.utils.formatEther(loan.loanAmount),
          stake: ethers.utils.formatEther(loan.stake),
          endTime: new Date(Number(loan.endTime) * 1000).toLocaleString(),
          interestRate: loan.interestRate.toString(),
          propertyUnits: (loan.propertyUnits ? loan.propertyUnits.toString() : '0'),
          initialEthPrice: ethers.utils.formatUnits(loan.initialEthPrice, 18),
          state: loan.isRepaid ? LoanState.REPAID : (Date.now() > Number(loan.endTime) * 1000 ? LoanState.EXPIRED : LoanState.ACTIVE)
        }))
        .filter(loan => loan.lender.toLowerCase() === account.toLowerCase());
      setActiveLoans(activeLoansData);
    } catch (error) {
      console.error("Error loading active loans:", error);
      showToast("Error loading active loans", 'danger');
    }
  };

  // Load parameters (penalty)
  const [params, setParams] = useState({ bonusBp: '', penaltyBp: '' });
  useEffect(() => {
    const loadParams = async () => {
      if (!contract) return;
      try {
        const bonusBp = await contract.liquidationBonusBp();
        const penaltyBp = await contract.overdueRepayPenaltyBp();
        setParams({ bonusBp: bonusBp.toString(), penaltyBp: penaltyBp.toString() });
      } catch (e) {
        // ignore if without params
      }
    };
    loadParams();
  }, [contract]);
  
  // Fund selected loan
  const fundLoan = async (requestId, amount) => {
    if (!contract) return;
    try {
      const amountInWei = ethers.utils.parseEther(amount);
  
      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const nonce = await provider.getTransactionCount(account);
      
      const tx = await contract.fundLoanRequest(
        requestId,
        { value: amountInWei, nonce, gasLimit: ethers.utils.hexlify(1000000) }
      );
      
      await tx.wait();

      //Update UI
      await loadLoanRequests();
      await loadActiveLoans();
      await updateBalance(account);
      showToast("Loan funded successfully", 'success');
    } catch (error) {
      console.error("Error funding loan:", error);
      showToast(error.reason || "Error funding loan", 'danger');
    }
  };


  
  

  // Liquidate expired loan
  const liquidateExpiredLoan = async (loanId) => {
    if (!contract) return;
    try {
      const tx = await contract.liquidateExpiredLoan(loanId);
      showToast("Processing liquidation...", 'info');
      await tx.wait();
      showToast("Loan liquidated successfully", 'success');
      
      //Update UI
      await loadLoanRequests();
      await loadActiveLoans();
      await updateBalance(account);
    } catch (error) {
      console.error("Error liquidating loan:", error);
      showToast(error.reason || "Error liquidating loan", 'danger');
    }
  };

  // Toast notifications
  const showToast = (message, variant) => setToast({ show: true, message, variant });

  // Graphics
  return (
    <Container className="mt-5">
      <Toast 
        show={toast.show} 
        onClose={() => setToast({ ...toast, show: false })} 
        delay={3000} 
        autohide 
        style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999 }}
      >
        <Toast.Header><strong className="me-auto">Notification</strong></Toast.Header>
        <Toast.Body className={`bg-${toast.variant} text-white`}>{toast.message}</Toast.Body>
      </Toast>

      <Card className="mb-4">
        <Card.Header as="h5">Lender Dashboard</Card.Header>
        <Card.Body>
          <Card.Text>Connected Account: {account}</Card.Text>
          <Card.Text>Balance: {parseFloat(balance).toFixed(4)} ETH</Card.Text>
        </Card.Body>
      </Card>

      <Card className="mb-4">
        <Card.Header as="h5" className="d-flex justify-content-between align-items-center">
          Available Loan Requests
          <Button variant="outline-primary" onClick={loadLoanRequests}>Refresh Requests</Button>
        </Card.Header>
        <Card.Body>
        
        {params.bonusBp && (
          <div className="mb-3 text-muted">Current liquidator bonus: {Number(params.bonusBp)/100}%</div>
        )}
        <Table responsive>
            <thead>
              <tr>
                <th>Loan ID</th>
                <th>Borrower</th>
                <th>Amount</th>
                <th>Stake</th>
                <th>Duration</th>
                <th>Interest Rate</th>
                <th>Units</th>
                <th>Property Commitment</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loanRequests.map((request) => (
                <tr key={request.requestId}>
                  <td>{request.requestId}</td>
                  <td>{request.borrower}</td>
                  <td>{request.amount} ETH</td>
                  <td>{request.stake} ETH</td>
                  <td>{request.duration} days</td>
                  <td>{request.interestRate}%</td>
                  <td>{request.propertyUnits}</td>
                  <td><code style={{fontSize:'0.8em'}}>{request.propertyCommitment}</code></td>
                  <td>
                    <Badge bg='success'>
                      ACTIVE
                    </Badge>
                  </td>
                  <td>
                    <Button
                      variant="primary"
                      onClick={() => fundLoan(request.requestId, request.amount)}
                    >
                      Fund
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header as="h5" className="d-flex justify-content-between align-items-center">
          Your Funded Loans
          <Button variant="outline-primary" onClick={loadActiveLoans}>Refresh Loans</Button>
        </Card.Header>
        <Card.Body>
          <Table responsive>
            <thead>
              <tr>
                <th>Loan ID</th>
                <th>Borrower</th>
                <th>Amount</th>
                <th>Stake</th>
                <th>End Time</th>
                <th>Units</th>
                <th>Interest Rate</th>
                <th>Initial ETH Price</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeLoans.map((loan) => (
                <tr key={loan.loanId}>
                  <td>{loan.loanId}</td>
                  <td>{loan.borrower}</td>
                  <td>{loan.amount} ETH</td>
                  <td>{loan.stake} ETH</td>
                  <td>{loan.endTime}</td>
                  <td>{loan.propertyUnits}</td>
                  <td>{loan.interestRate}%</td>
                  <td>${loan.initialEthPrice}</td>
                  <td>
                    <Badge bg={loan.state === LoanState.ACTIVE ? 'warning' : 
                              (loan.state === LoanState.REPAID ? 'success' : 'danger')}>
                      {loan.state}
                    </Badge>
                  </td>
                  <td>
                    {loan.state === LoanState.EXPIRED && (
                      <Button 
                        variant="danger" 
                        onClick={() => liquidateExpiredLoan(loan.loanId)}
                      >
                        Liquidate
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

export { Lender };