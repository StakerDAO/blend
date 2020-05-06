pragma solidity ^0.5.0;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

contract Registry is Ownable {
    address public registryBackend;
    address public blend;
    uint256 public feePerAddress;
    mapping (address => bool) private _tenderAddresses;
    mapping (address => address[]) private _senders;
    mapping (address => mapping (address => uint256)) private _balances;

    using SafeMath for uint256;

    event BurnDispatched(address indexed tenderAddress, uint256 fee);

    modifier onlyBackend() {
        require(
            msg.sender == registryBackend,
            "Unauthorized: sender is not a registry backend"
        );
        _;
    }

    modifier onlyBlend() {
        require(
            msg.sender == blend,
            "Unauthorized: sender is not a Blend token contract"
        );
        _;
    }

    function initialize(address blendToken, address backend)
        public
        initializer
    {
        Ownable.initialize(_msgSender());
        blend = blendToken;
        registryBackend = backend;
    }

    function setRegistryBackend(address newBackend) public onlyOwner {
        registryBackend = newBackend;
    }

    /// @notice Sets a new fee per address for burning the tokens from
    //          this address. The fee is also the minimum amount of tokens
    //          one has to send to a tender address or leave on a tender
    //          address while unlocking the funds.
    /// @param newFee New minimum amount
    function setFeePerAddress(uint256 newFee) public onlyBackend {
        feePerAddress = newFee;
    }

    /// @notice Records a transfer from a regulat wallet to a tender address
    /// @param from The address of the token sender
    /// @param tenderAddress The tender address that received the funds
    /// @param amount The number of tokens sent (in the smallest units)
    function recordTransfer(
        address from,
        address tenderAddress,
        uint256 amount
    )
        public
        onlyBlend
    {
        require(
            isTenderAddress(tenderAddress),
            "Tender address is not registered"
        );
        require(
            amount >= feePerAddress,
            "The amount must not be less than minimum"
        );
        if (_balances[tenderAddress][from] == 0) {
            _senders[tenderAddress].push(from);
        }
        _balances[tenderAddress][from] =
                _balances[tenderAddress][from].add(amount);
    }

    /// @notice Records an unlock transaction that returns funds from
    ///         a tender address. Fails if there are not enough funds
    ///         to unlock.
    /// @param tenderAddress Tender address to unlock the funds from
    /// @param to Wallet address that receives the unlocked funds
    /// @param amount The number of tokens unlocked
    function recordUnlock(
        address tenderAddress,
        address to,
        uint256 amount
    )
        public
        onlyBlend
    {
        require(
            isTenderAddress(tenderAddress),
            "Tender address is not registered"
        );
        require(
            _balances[tenderAddress][to] >= amount,
            "Insufficient locked amount"
        );
        require(
            _balances[tenderAddress][to].sub(amount) >= feePerAddress,
            "You must leave the fee on the tender address"
        );
        _balances[tenderAddress][to] =
                _balances[tenderAddress][to].sub(amount);
    }

    function _subSaturated(uint256 a, uint256 b)
        private
        pure
        returns (uint256)
    {
        if (a > b) return a.sub(b);
        return 0;
    }

    /// @notice
    /// @param tenderAddress Tender address to burn from
    /// @param orderAmount The total amount to burn
    /// @return Fee for the execution
    function dispatchBurn(address tenderAddress, uint256 orderAmount)
        public
        onlyBlend
        returns (uint256 totalFee)
    {
        uint len = _senders[tenderAddress].length;
        uint256 orderRemained = orderAmount;
        totalFee = 0;

        for (uint i = len; i > 0; i--) {
            address sender = _senders[tenderAddress][i - 1];
            uint256 balance = _balances[tenderAddress][sender];

            if (balance <= orderRemained.add(feePerAddress)) {
                // Deduce fee and liquidate sender
                uint256 v = _subSaturated(balance, feePerAddress);
                orderRemained = orderRemained.sub(v);
                totalFee = totalFee.add(balance.sub(v));
                _balances[tenderAddress][sender] = 0;
                _senders[tenderAddress].pop();
            } else {
                // Deduce fee but not liquidate sender since there's some
                // remaining BLEND amount
                _balances[tenderAddress][sender] = balance.sub(orderRemained);
                orderRemained = 0;
                break;
            }
        }

        require(orderRemained == 0, "Not enough balance on tender address");
        emit BurnDispatched(tenderAddress, totalFee);
        return totalFee;
    }

    /// @notice Adds an address to a set of registered tender addresses
    /// @param tenderAddress Tender address to register
    function registerTenderAddress(address tenderAddress) public onlyBackend {
        require(
            _tenderAddresses[tenderAddress] == false,
            "Tender address already registered"
        );
        _tenderAddresses[tenderAddress] = true;
    }

    /// @notice Returns whether `tenderAddress` was registered by
    ///         calling `registry.registerTenderAddress(...)`
    function isTenderAddress(address tenderAddress)
        public
        view
        returns (bool)
    {
        return _tenderAddresses[tenderAddress];
    }

    /// @notice Returns the number of tokens that were ever sent to
    ///         `tenderAddress` by `wallet` and not unlocked since then
    /// @param tenderAddress The tender address we're interested in
    /// @param wallet Wallet that has sent the funds to `tenderAddress`
    /// @return The "balance" of `wallet` on `tenderAddress`, in the
    ///         smallest token units.
    function getLockedAmount(address tenderAddress, address wallet)
        public
        view
        returns (uint256)
    {
        return _balances[tenderAddress][wallet];
    }

    function getSendersCount(address tenderAddress)
        public
        view
        returns (uint256)
    {
        return _senders[tenderAddress].length;
    }

    function getSender(address tenderAddress, uint idx)
        public
        view
        returns (address)
    {
        require(
            idx < _senders[tenderAddress].length,
            "Index out of range"
        );
        return _senders[tenderAddress][idx];
    }
}
