import React from "react";
import { NoWalletDetected } from "./NoWalletDetected";
import { ConnectWallet } from "./ConnectWallet";
import { Lender as LenderInterface } from './Lender';
import { App as BorrowerInterface } from "./Borrower"

import { Container, Card, Button, Alert, Nav, Navbar } from 'react-bootstrap';

const HARDHAT_NETWORK_ID = '31337';

export class Dapp extends React.Component {
  constructor(props) {
    super(props);

    this.initialState = {
      selectedAddress: undefined,
      loanRequests: [],
      approvedLoans: [],
      userRole: undefined,
      networkError: undefined,
    };

    this.state = this.initialState;
  }

  render() {
    if (window.ethereum === undefined) {
      return <NoWalletDetected />;
    }

    if (!this.state.selectedAddress) {
      return (
        <ConnectWallet
          connectWallet={() => this._connectWallet()}
          networkError={this.state.networkError}
          dismiss={() => this._dismissNetworkError()}
        />
      );
    }

    const { selectedAddress, userRole } = this.state;

    return (
      <div className="dapp-wrapper">
        <Navbar bg="dark" variant="dark" expand="lg">
          <Container>
            <Navbar.Brand href="#" onClick={() => this._goHome()}>DLoan Platform</Navbar.Brand>
            <Navbar.Toggle aria-controls="basic-navbar-nav" />
            <Navbar.Collapse id="basic-navbar-nav">
              <Nav className="me-auto">
                <Nav.Link href="#" onClick={() => this._goHome()}>Home</Nav.Link>
              </Nav>
              <Navbar.Text className="ml-3">
                Signed in as: <a href="#login">{selectedAddress}</a>
              </Navbar.Text>
            </Navbar.Collapse>
          </Container>
        </Navbar>

        <Container className="mt-4">
          {!userRole ? (
            <Card className="text-center">
              <Card.Header as="h5">Welcome to DLoan</Card.Header>
              <Card.Body>
                <Card.Title>Choose Your Role</Card.Title>
                <Card.Text>
                  Select your role to get started with our decentralized loan platform.
                </Card.Text>
                <Button 
                  variant="primary" 
                  className="me-2 mr-5 ml-5"
                  onClick={() => this.setState({ userRole: 'borrower' })}
                >
                  I'm a Borrower
                </Button>
                <Button 
                  variant="secondary"
                  className="me-2 mr-5 ml-5"
                  onClick={() => this.setState({ userRole: 'lender' })}
                >
                  I'm a Lender
                </Button>
              </Card.Body>
            </Card>
          ) : (
            <>
              <Alert variant="info">
                You are logged in as: <strong>{userRole}</strong>
              </Alert>

              {userRole === 'borrower' && (
                <BorrowerInterface />
              )}

              {userRole === 'lender' && (
                <LenderInterface />
              )}
            </>
          )}
        </Container>
      </div>
    );
  }


  async _connectWallet() {
    const [selectedAddress] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    this._checkNetwork();
    this._initialize(selectedAddress);

    window.ethereum.on("accountsChanged", ([newAddress]) => {
      if (newAddress === undefined) {
        return this._resetState();
      }
      this._initialize(newAddress);
    });
  }

  _initialize(userAddress) {
    this.setState({ selectedAddress: userAddress });
  }

  _dismissNetworkError() {
    this.setState({ networkError: undefined });
  }

  _resetState() {
    this.setState(this.initialState);
  }

  async _switchChain() {
    const chainIdHex = `0x${HARDHAT_NETWORK_ID.toString(16)}`;
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    await this._initialize(this.state.selectedAddress);
  }

  _checkNetwork() {
    if (window.ethereum.networkVersion !== HARDHAT_NETWORK_ID) {
      this._switchChain();
    }
  }

  _goHome() {
    // Reset role selection
    this.setState({ userRole: undefined });
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (_) {
      window.scrollTo(0, 0);
    }
  }
}