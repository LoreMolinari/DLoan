import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Form, Button, Table, Card, Badge, Toast } from 'react-bootstrap';
import { ethers } from 'ethers';
import LendingPlatformABI from '../contracts/LendingPlatform.json';
import Address from '../contracts/contract-address.json';

const App = () => {
  // State management of data
  const [formData, setFormData] = useState({ 
  amount: '', 
  duration: '', 
  collateral: '',
  interestRate: '',
  // privacy metadata
  metadata: '', // free-text demo (will be hashed)
  encryptedCid: '', // IPFS CID to encrypt
  propertyRef: '', // free-text property reference (will be hashed)
  appraisalEncryptedCid: '' // IPFS CID to encrypt Real Estate
  });
  
  // Core application state
  const [account, setAccount] = useState('');
  const [balance, setBalance] = useState('');
  const [contract, setContract] = useState(null);
  const [myActiveLoans, setMyActiveLoans] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  
  // Toast notification
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVariant, setToastVariant] = useState('success');

  const DEMO_PRIVACY_PLACEHOLDER = (process.env.REACT_APP_DEMO_PRIVACY || 'true') === 'true';

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
      const propertyUnits = Math.floor(Number(formData.propertyUnits || 0));

      // Validate loan duration
      if (durationInDays <= 0) {
        showToastMessage("Repayment date must be in the future", 'warning');
        return;
      }

      // Frontend collateral check (>= 2x loan amount)
      if (Number(formData.collateral) < Number(formData.amount) * 2) {
        showToastMessage("Collateral must be at least 2x the loan amount", 'warning');
        return;
      }

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const nonce = await provider.getTransactionCount(account);

      // Privacy (demo), basic hash
      let encryptedCid;
      let commitment;
      let propertyCommitment;
      let appraisalCid;
      if (DEMO_PRIVACY_PLACEHOLDER) {
        encryptedCid = 'ipfs://PLACEHOLDER_ENCRYPTED_CID';
        commitment = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('PLACEHOLDER_METADATA_V1'));
        propertyCommitment = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('PROPERTY_PLACEHOLDER_V1'));
        appraisalCid = 'ipfs://PLACEHOLDER_APPRAISAL_CID';
      } else {
        const metadataHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(formData.metadata || ''));
        commitment = metadataHash;
        encryptedCid = formData.encryptedCid || '';
        const propertyHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(formData.propertyRef || ''));
        propertyCommitment = propertyHash;
        appraisalCid = formData.appraisalEncryptedCid || '';
      }
      
      // Send transaction
      const tx = await contract.createLoanRequest(
        amountInWei,
        durationInDays,
        interestRate,
        commitment,
        encryptedCid,
        propertyCommitment,
        appraisalCid,
        propertyUnits,
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
      
      setFormData({ amount: '', duration: '', collateral: '', interestRate: '', metadata: '', encryptedCid: '', propertyRef: '', appraisalEncryptedCid: '', propertyUnits: '' });
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
        propertyUnits: (loans[index].propertyUnits ? loans[index].propertyUnits.toString() : '0'),
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
        propertyUnits: (requests[index].propertyUnits ? requests[index].propertyUnits.toString() : '0'),
        initialEthPrice: 'N/A',
        state: "PENDING"
      }));
  
      // Filter by this borrower
      const myActives = activeLoansData.filter(loan => loan.borrower.toLowerCase() === account.toLowerCase());
      const myReqs = requestLoansData.filter(loan => loan.borrower.toLowerCase() === account.toLowerCase());

      setMyActiveLoans(myActives);
      setMyRequests(myReqs);
    } catch (error) {
      console.error("Error loading loans:", error);
      showToastMessage("Error loading loans", 'danger');
    }
  };
  
  // Repay selected loan
  const repayLoan = async (loanId) => {
    if (!contract) return;
    try {
      const dueWei = await contract.calculateAmountDueEth(loanId);
      // Use ethers.BigNumber, avoid BigInt issues
      const due = dueWei; // BigNumber
      const buffer = due.div(1000); // 0.1% buffer
      const minBuffer = ethers.BigNumber.from("1000000000000");
      const valueToSend = due.add(buffer.gt(minBuffer) ? buffer : minBuffer);

      const tx = await contract.repayLoan(loanId, dueWei, { value: valueToSend });

      await tx.wait();
      showToastMessage("Loan repaid successfully", 'success');

      // Update UI
      await updateBalance();
      await loadActiveLoans();
    } catch (error) {
        const msg = error?.reason || error?.data?.message || error?.error?.message || error?.message || "Error repaying loan";
        console.error("Error repaying loan:", error);
        showToastMessage(msg, 'danger');

        // Update UI
        await updateBalance();
        await loadActiveLoans();
    }
  };
  
  
  // Estimate current amount
  const estimateDue = async (loanId) => {
    if (!contract) return;
    try {
      const dueWei = await contract.calculateAmountDueEth(loanId);
      const dueEth = ethers.utils.formatEther(dueWei);
      showToastMessage(`Estimated due now: ${parseFloat(dueEth).toFixed(6)} ETH`, 'info');
    } catch (error) {
      console.error("Error estimating due:", error);
      showToastMessage(error.reason || "Error estimating due", 'danger');
    }
  };

  // Toast notifications
  const showToastMessage = (message, variant) => {
    setToastMessage(message);
    setToastVariant(variant);
    setShowToast(true);
  };

  // Aggregate total property units
  const totalPropertyUnits = [...myActiveLoans, ...myRequests].reduce((sum, loan) => {
    const units = parseInt(loan?.propertyUnits ?? '0', 10);
    return sum + (isNaN(units) ? 0 : units);
  }, 0);

  // Graphics
  return (
    <Container className="mt-5">
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

      <Card className="mb-4">
        <Card.Header as="h5">Borrower Dashboard</Card.Header>
        <Card.Body>
          <Card.Text>Account: {account}</Card.Text>
          <Card.Text>Balance: {parseFloat(balance).toFixed(4)} ETH</Card.Text>
          <Card.Text>Total Properties Pledged (all your loans): {totalPropertyUnits}</Card.Text>
        </Card.Body>
      </Card>

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

            
            {!DEMO_PRIVACY_PLACEHOLDER && (
            <>
              <Form.Group as={Row} className="mb-3">
                <Form.Label column sm={2}>Property Units</Form.Label>
                <Col sm={10}>
                  <Form.Control 
                    type="number" 
                    name="propertyUnits" 
                    min="0"
                    step="1"
                    value={formData.propertyUnits || ''}
                    onChange={handleInputChange}
                    placeholder="Number of properties pledged (demo)"
                  />
                </Col>
              </Form.Group>
              <Form.Group as={Row} className="mb-3">
                <Form.Label column sm={2}>Metadata (private)</Form.Label>
                <Col sm={10}>
                  <Form.Control 
                    type="text" 
                    name="metadata" 
                    value={formData.metadata}
                    onChange={handleInputChange}
                    placeholder="Describe purpose or docs (encrypted off-chain)"
                  />
                  <Form.Text className="text-muted">
                    Will be hashed on-chain; do not include PII in clear text.
                  </Form.Text>
                </Col>
              </Form.Group>

              <Form.Group as={Row} className="mb-3">
                <Form.Label column sm={2}>Encrypted CID</Form.Label>
                <Col sm={10}>
                  <Form.Control 
                    type="text" 
                    name="encryptedCid" 
                    value={formData.encryptedCid}
                    onChange={handleInputChange}
                    placeholder="ipfs://... (encrypted metadata blob)"
                  />
                </Col>
              </Form.Group>

              
              <Form.Group as={Row} className="mb-3">
                <Form.Label column sm={2}>Property Ref (private)</Form.Label>
                <Col sm={10}>
                  <Form.Control 
                    type="text" 
                    name="propertyRef" 
                    value={formData.propertyRef}
                    onChange={handleInputChange}
                    placeholder="e.g., address or registry id (hashed client-side)"
                  />
                  <Form.Text className="text-muted">
                    Only a commitment is stored on-chain; do not include PII in clear text.
                  </Form.Text>
                </Col>
              </Form.Group>

              <Form.Group as={Row} className="mb-3">
                <Form.Label column sm={2}>Appraisal Encrypted CID</Form.Label>
                <Col sm={10}>
                  <Form.Control 
                    type="text" 
                    name="appraisalEncryptedCid" 
                    value={formData.appraisalEncryptedCid}
                    onChange={handleInputChange}
                    placeholder="ipfs://... (encrypted appraisal/deed)"
                  />
                </Col>
              </Form.Group>
            </>
            )}

            <Button variant="primary" type="submit">Create Loan</Button>
          </Form>
        </Card.Body>
      </Card>

      
      <Card className="mb-4">
        <Card.Header as="h5" className="d-flex justify-content-between align-items-center">
          Your Requests
          <Button variant="outline-primary" onClick={loadActiveLoans}>Refresh</Button>
        </Card.Header>
        <Card.Body>
          <Table responsive>
            <thead>
              <tr>
                <th>ID</th>
                <th>Amount</th>
                <th>Duration</th>
                <th>Units</th>
                <th>Interest Rate</th>
                <th>Stake</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {myRequests.map((req) => (
                <tr key={req.loanId}>
                  <td>{req.loanId}</td>
                  <td>{req.loanAmount} ETH</td>
                  <td>{`${req.duration} days`}</td>
                  <td>{req.propertyUnits}</td>
                  <td>{req.interestRate}%</td>
                  <td>{req.stake} ETH</td>
                  <td>
                    <Badge bg={'info'}>PENDING</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      
      <Card>
        <Card.Header as="h5" className="d-flex justify-content-between align-items-center">
          Your Active Loans
          <Button variant="outline-primary" onClick={loadActiveLoans}>Refresh</Button>
        </Card.Header>
        <Card.Body>
          <Table responsive>
            <thead>
              <tr>
                <th>ID</th>
                <th>Amount</th>
                <th>End Time</th>
                <th>Units</th>
                <th>Interest Rate</th>
                <th>Stake</th>
                <th>Initial ETH Price</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {myActiveLoans.map((loan) => (
                <tr key={loan.loanId}>
                  <td>{loan.loanId}</td>
                  <td>{loan.loanAmount} ETH</td>
                  <td>{loan.endTime}</td>
                  <td>{loan.propertyUnits}</td>
                  <td>{loan.interestRate}%</td>
                  <td>{loan.stake} ETH</td>
                  <td>{`$${loan.initialEthPrice}`}</td>
                  <td>
                    <Badge bg={'warning'}>ACTIVE</Badge>
                  </td>
                  <td>
                    <div className="d-flex gap-2">
                      <Button variant="outline-secondary" onClick={() => estimateDue(loan.loanId)}>
                        Estimate Due
                      </Button>
                      <Button variant="primary" onClick={() => repayLoan(loan.loanId)}>
                        Repay
                      </Button>
                    </div>
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