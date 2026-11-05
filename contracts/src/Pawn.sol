// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

/**
 * @title Pawn
 * @notice A one-to-one pawn counter.
 * A lender posts an offer with escrowed BOT principal and terms.
 * A borrower accepts by depositing ERC-20 collateral.
 * The borrower repays principal + interest to reclaim collateral.
 * If the due date passes without repayment, the lender can seize the collateral.
 */
contract Pawn {
  enum State {
    Offered,
    Active,
    Repaid,
    Seized,
    Cancelled
  }

  struct Loan {
    address lender;
    address borrower;
    address token;
    State state;
    uint64 offerEnds;
    uint64 termSecs;
    uint64 dueAt;
    uint128 principal;
    uint128 interest;
    uint256 collateral;
  }

  // --- Constants (Spec §2.1) ---
  uint128 public constant MIN_PRINCIPAL = 0.01 ether;
  uint128 public constant MAX_PRINCIPAL = 100_000 ether;
  uint64 public constant MIN_TERM = 1 days;
  uint64 public constant MAX_TERM = 180 days;
  uint64 public constant MIN_OFFER = 1 hours;
  uint64 public constant MAX_OFFER = 30 days;
  uint256 public constant MAX_PAGE = 50;

  // --- State Variables ---
  mapping(uint256 => Loan) private _loans;
  mapping(address => uint256) public pending;
  mapping(address => uint256[]) private _byLender;
  mapping(address => uint256[]) private _byBorrower;
  uint256 public loanCount;

  // Reentrancy guard
  uint256 private _reentrancyStatus = 1;

  modifier nonReentrant() {
    require(_reentrancyStatus == 1, "REENTRANCY");
    _reentrancyStatus = 2;
    _;
    _reentrancyStatus = 1;
  }

  // --- Custom Errors ---
  error BadPrincipal(uint128 min, uint128 max);
  error NotAToken();
  error ZeroCollateral();
  error BadInterest();
  error BadTimes();
  error NoSuchLoan();
  error NotLender();
  error NotBorrower();
  error NotOffered();
  error NotActive();
  error OfferEnded();
  error SelfLoan();
  error WrongPayment(uint256 expected);
  error NotDue(uint64 dueAt);
  error UnsupportedToken();
  error TokenTransferFailed();
  error NothingToWithdraw();
  error TransferFailed();

  // --- Events ---
  event Offered(
    uint256 indexed id,
    address indexed lender,
    address indexed token,
    uint256 collateral,
    uint128 principal,
    uint128 interest,
    uint64 termSecs,
    uint64 offerEnds
  );
  event Taken(uint256 indexed id, address indexed borrower, uint64 dueAt);
  event Repaid(uint256 indexed id);
  event Seized(uint256 indexed id);
  event Cancelled(uint256 indexed id, bool byExpiry);
  event Withdrawn(address indexed to, uint256 amount);

  // --- External Functions ---

  /**
   * @notice Lender posts a loan offer, locking principal (msg.value) in escrow.
   */
  function offer(
    address token,
    uint256 collateral,
    uint128 interest,
    uint64 termSecs,
    uint64 offerSecs
  ) external payable nonReentrant returns (uint256 id) {
    if (msg.value < MIN_PRINCIPAL || msg.value > MAX_PRINCIPAL) {
      revert BadPrincipal(MIN_PRINCIPAL, MAX_PRINCIPAL);
    }
    if (token.code.length == 0) revert NotAToken();
    if (collateral == 0) revert ZeroCollateral();
    if (interest > msg.value) revert BadInterest();
    if (termSecs < MIN_TERM || termSecs > MAX_TERM) revert BadTimes();
    if (offerSecs < MIN_OFFER || offerSecs > MAX_OFFER) revert BadTimes();

    id = ++loanCount;
    uint64 offerEnds = uint64(block.timestamp) + offerSecs;

    _loans[id] = Loan({
      lender: msg.sender,
      borrower: address(0),
      token: token,
      state: State.Offered,
      offerEnds: offerEnds,
      termSecs: termSecs,
      dueAt: 0,
      principal: uint128(msg.value),
      interest: interest,
      collateral: collateral
    });

    _byLender[msg.sender].push(id);

    emit Offered(
      id,
      msg.sender,
      token,
      collateral,
      uint128(msg.value),
      interest,
      termSecs,
      offerEnds
    );
  }

  /**
   * @notice Cancel an offered loan.
   * Lender can cancel anytime before taken.
   * Anyone can cancel after offerEnds, which credits pending[lender].
   */
  function cancel(uint256 id) external nonReentrant {
    if (id == 0 || id > loanCount) revert NoSuchLoan();
    Loan storage loan = _loans[id];

    if (loan.state != State.Offered) revert NotOffered();

    bool isLender = (msg.sender == loan.lender);
    bool isExpired = (block.timestamp > loan.offerEnds);

    if (!isLender && !isExpired) revert NotLender();

    loan.state = State.Cancelled;
    uint256 refund = loan.principal;

    if (isLender && !isExpired) {
      // Direct push to lender
      (bool ok, ) = msg.sender.call{value: refund}("");
      if (!ok) revert TransferFailed();
      emit Cancelled(id, false);
    } else {
      // Expired offer: credit to pending[lender]
      pending[loan.lender] += refund;
      emit Cancelled(id, true);
    }
  }

  /**
   * @notice Borrower accepts an offer by transferring the required ERC-20 collateral.
   * Borrower must have approved this contract. Principal is credited to pending[borrower].
   */
  function take(uint256 id) external nonReentrant {
    if (id == 0 || id > loanCount) revert NoSuchLoan();
    Loan storage loan = _loans[id];

    if (loan.state != State.Offered) revert NotOffered();
    if (block.timestamp > loan.offerEnds) revert OfferEnded();
    if (msg.sender == loan.lender) revert SelfLoan();

    // Pull collateral with balance-delta check (Spec §2.1, conventions §2.3)
    uint256 balBefore = _tokenBalance(loan.token, address(this));
    _safeTransferFrom(loan.token, msg.sender, address(this), loan.collateral);
    uint256 balAfter = _tokenBalance(loan.token, address(this));

    if (balAfter < balBefore || (balAfter - balBefore) != loan.collateral) {
      revert UnsupportedToken();
    }

    loan.borrower = msg.sender;
    loan.dueAt = uint64(block.timestamp) + loan.termSecs;
    loan.state = State.Active;

    _byBorrower[msg.sender].push(id);
    pending[msg.sender] += loan.principal;

    emit Taken(id, msg.sender, loan.dueAt);
  }

  /**
   * @notice Borrower repays principal + interest in BOT to reclaim token collateral.
   * Works until lender seizes, even if past dueAt.
   */
  function repay(uint256 id) external payable nonReentrant {
    if (id == 0 || id > loanCount) revert NoSuchLoan();
    Loan storage loan = _loans[id];

    if (loan.state != State.Active) revert NotActive();
    if (msg.sender != loan.borrower) revert NotBorrower();

    uint256 expected = uint256(loan.principal) + uint256(loan.interest);
    if (msg.value != expected) revert WrongPayment(expected);

    loan.state = State.Repaid;
    pending[loan.lender] += msg.value;

    _safeTransfer(loan.token, msg.sender, loan.collateral);

    emit Repaid(id);
  }

  /**
   * @notice Lender seizes token collateral if loan is active and now > dueAt.
   */
  function seize(uint256 id) external nonReentrant {
    if (id == 0 || id > loanCount) revert NoSuchLoan();
    Loan storage loan = _loans[id];

    if (loan.state != State.Active) revert NotActive();
    if (msg.sender != loan.lender) revert NotLender();
    if (block.timestamp <= loan.dueAt) revert NotDue(loan.dueAt);

    loan.state = State.Seized;

    _safeTransfer(loan.token, msg.sender, loan.collateral);

    emit Seized(id);
  }

  /**
   * @notice Pull payment for pending BOT balances.
   */
  function withdraw() external nonReentrant {
    uint256 amt = pending[msg.sender];
    if (amt == 0) revert NothingToWithdraw();

    pending[msg.sender] = 0;

    (bool ok, ) = msg.sender.call{value: amt}("");
    if (!ok) revert TransferFailed();

    emit Withdrawn(msg.sender, amt);
  }

  // --- Views ---

  function loanOf(uint256 id) external view returns (Loan memory) {
    if (id == 0 || id > loanCount) revert NoSuchLoan();
    return _loans[id];
  }

  function quoteRepay(uint256 id) external view returns (uint256) {
    if (id == 0 || id > loanCount) revert NoSuchLoan();
    Loan storage loan = _loans[id];
    return uint256(loan.principal) + uint256(loan.interest);
  }

  function byLender(
    address addr,
    uint256 offset,
    uint256 count
  ) external view returns (uint256[] memory ids, Loan[] memory list) {
    uint256[] storage all = _byLender[addr];
    uint256 total = all.length;

    if (offset >= total || count == 0) {
      return (new uint256[](0), new Loan[](0));
    }

    if (count > MAX_PAGE) count = MAX_PAGE;
    if (offset + count > total) count = total - offset;

    ids = new uint256[](count);
    list = new Loan[](count);

    for (uint256 i = 0; i < count; i++) {
      uint256 lId = all[total - 1 - (offset + i)];
      ids[i] = lId;
      list[i] = _loans[lId];
    }
  }

  function byBorrower(
    address addr,
    uint256 offset,
    uint256 count
  ) external view returns (uint256[] memory ids, Loan[] memory list) {
    uint256[] storage all = _byBorrower[addr];
    uint256 total = all.length;

    if (offset >= total || count == 0) {
      return (new uint256[](0), new Loan[](0));
    }

    if (count > MAX_PAGE) count = MAX_PAGE;
    if (offset + count > total) count = total - offset;

    ids = new uint256[](count);
    list = new Loan[](count);

    for (uint256 i = 0; i < count; i++) {
      uint256 lId = all[total - 1 - (offset + i)];
      ids[i] = lId;
      list[i] = _loans[lId];
    }
  }

  function latest(
    uint256 offset,
    uint256 count
  ) external view returns (uint256[] memory ids, Loan[] memory list) {
    uint256 total = loanCount;
    if (offset >= total || count == 0) {
      return (new uint256[](0), new Loan[](0));
    }

    if (count > MAX_PAGE) count = MAX_PAGE;
    if (offset + count > total) count = total - offset;

    ids = new uint256[](count);
    list = new Loan[](count);

    for (uint256 i = 0; i < count; i++) {
      uint256 lId = total - offset - i;
      ids[i] = lId;
      list[i] = _loans[lId];
    }
  }

  // --- Inline Safe ERC-20 Helpers (Spec §2.1) ---

  function _tokenBalance(address token, address account) internal view returns (uint256) {
    (bool ok, bytes memory data) = token.staticcall(
      abi.encodeWithSelector(0x70a08231, account) // balanceOf(address)
    );
    if (!ok || data.length < 32) return 0;
    return abi.decode(data, (uint256));
  }

  function _safeTransfer(address token, address to, uint256 value) internal {
    (bool ok, bytes memory data) = token.call(
      abi.encodeWithSelector(0xa9059cbb, to, value) // transfer(address,uint256)
    );
    if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
      revert TokenTransferFailed();
    }
  }

  function _safeTransferFrom(
    address token,
    address from,
    address to,
    uint256 value
  ) internal {
    (bool ok, bytes memory data) = token.call(
      abi.encodeWithSelector(0x23b872dd, from, to, value) // transferFrom(address,address,uint256)
    );
    if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
      revert TokenTransferFailed();
    }
  }
}
