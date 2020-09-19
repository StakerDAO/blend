pragma solidity 0.5.13;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

import {Ownable} from "./Ownable.sol";

contract Registry is Initializable, Ownable {
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
        external
        initializer
    {
        Ownable.initialize(_msgSender());
        blend = blendToken;
        registryBackend = backend;
    }

    /// @notice Sets a new registry backend address. Registry backend
    ///         can set fees and register new tender addresses.
    /// @param newBackend New backend address
    function setRegistryBackend(address newBackend) external onlyOwner {
        registryBackend = newBackend;
    }

    /// @notice Sets a new fee per address for burning the tokens from
    //          this address. The fee is also the minimum amount of tokens
    //          one has to send to a tender address or leave on a tender
    //          address while unlocking the funds.
    /// @param newFee New fee
    function setFeePerAddress(uint256 newFee) external onlyBackend {
        feePerAddress = newFee;
    }

    /// @notice Records a transfer from a regular wallet to a tender address
    /// @param from The address of the token sender
    /// @param tenderAddress The tender address that received the funds
    /// @param amount The number of tokens sent (in the smallest units)
    function recordTransfer(
        address from,
        address tenderAddress,
        uint256 amount
    )
        external
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
    ///         to unlock. Requires that at least `feePerAddress`
    ///         remains locked and associated with the sender's internal
    ///         balance.
    /// @param tenderAddress Tender address to unlock the funds from
    /// @param to Wallet address that receives the unlocked funds
    /// @param amount The number of tokens unlocked
    function recordUnlock(
        address tenderAddress,
        address to,
        uint256 amount
    )
        external
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

        // We need to leave at least `feePerAddress` on the sender's
        // internal balance because we don't want to iterate over _senders
        // list here.
        require(
            _balances[tenderAddress][to].sub(amount) >= feePerAddress,
            "You must leave the fee on the tender address"
        );
        _balances[tenderAddress][to] =
                _balances[tenderAddress][to].sub(amount);
    }

    /// @notice Reduces the internal "balances" of the token senders
    ///         upon burn, i.e. makes sum(_balances[tenderAddress])
    ///         equal to the tender address balance. During this
    ///         operation, we traverse through senders' balances
    ///         starting from the latest one and deduce either:
    ///         1) the total internal balance AND a fee for removing
    ///            the address from the senders list
    ///         2) the remaining order amount – in this case the
    ///            sender remains in the list and the fee is not
    ///            taken.
    ///         The method returns the total fee for all the addresses
    ///         removed from _senders[tenderAddress].
    /// @param tenderAddress Tender address to burn from
    /// @param orderAmount The total amount to burn
    /// @return Fee for the execution
    function dispatchBurn(address tenderAddress, uint256 orderAmount)
        external
        onlyBlend
        returns (uint256 totalFee)
    {
        require(
            isTenderAddress(tenderAddress),
            "Burning from regular addresses is not allowed"
        );
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
                // Deduce the remaining order amount but not liquidate sender
                // since there are some BLND tokens left
                _balances[tenderAddress][sender] = balance.sub(orderRemained);
                orderRemained = 0;
                break;
            }
        }

        require(orderRemained == 0, "Not enough balance on tender address");
        emit BurnDispatched(tenderAddress, totalFee);
        return totalFee;
    }

    /// @notice Adds an address to the set of registered tender addresses
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

    /// @notice Returns the number of addresses that have sent BLND
    ///         to the specified tender address AND are still eligible
    ///         to unlock some nonzero amount of BLND tokens.
    /// @param tenderAddress Tender address
    /// @return The number of senders
    function getSendersCount(address tenderAddress)
        public
        view
        returns (uint)
    {
        return _senders[tenderAddress].length;
    }

    /// @notice Returns the `idx`-th sender from the tender address'
    ///         senders list. Throws if the given index is greater
    ///         than or equal to the number of senders.
    /// @param tenderAddress Tender address
    /// @param idx Index of the sender
    /// @return The address of the corresponding sender
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

    /// @dev Subtracts `b` from `a` if `a` is greater than `b`,
    ///      otherwise returns 0.
    /// @param a Minuend
    /// @param b Subtrahend
    /// @return Difference
    function _subSaturated(uint256 a, uint256 b)
        private
        pure
        returns (uint256)
    {
        if (a > b) return a.sub(b);
        return 0;
    }
}
