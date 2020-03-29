registryBackendpragma solidity ^0.5.0;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

contract Registry is Ownable {
    address public registryBackend;
    address public blend;
    mapping (address => bool) private _tenderAddresses;
    mapping (address => mapping (address => uint256)) private _balances;

    using SafeMath for uint256;

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
        _balances[tenderAddress][to] =
                _balances[tenderAddress][to].sub(amount);
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
}
