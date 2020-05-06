pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/ownership/Ownable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

import {Registry} from "./Registry.sol";
import {BlendToken} from "./BlendToken.sol";

contract Orchestrator is Ownable {
    IERC20 public usdc;
    BlendToken public blend;
    Registry public registry;
    address public distributionBackend;
    address public usdcPool;
    uint256 public feePerSenderAddress;

    uint256 constant PRICE_MULTIPLIER = 10_000;

    using SafeMath for uint256;

    struct Order {
        address redeemerTenderAddress;
        address redeemerWallet;
        uint256 price;
        uint256 amount;
    }

    modifier onlyBackend() {
        require(
            msg.sender == distributionBackend,
            "Unauthorized: sender is not a distribution backend"
        );
        _;
    }

    constructor(
        address _backend,
        address _blend,
        address _registry,
        address _pool,
        address _usdc
    )
        public
    {
        distributionBackend = _backend;
        blend = BlendToken(_blend);
        registry = Registry(_registry);
        usdcPool = _pool;
        usdc = IERC20(_usdc);
        Ownable.initialize(_msgSender());
    }

    /// @notice Rotates the key of the distribution backend
    /// @param newBackend New backend address
    function setDistributionBackend(address newBackend) public onlyOwner {
        distributionBackend = newBackend;
    }

    /// @notice Sets a new USDC pool address. Tokens from USDC pool
    ///         will be used during orders execution.
    /// @param pool The address of the pool
    function setUsdcPool(address pool) public onlyOwner {
        usdcPool = pool;
    }

    /// @notice Sets a BLND fee for one address in tender address
    ///         senders list.
    /// @param newFee new fee
    function setFee(uint256 newFee) public onlyBackend {
        feePerSenderAddress = newFee;
    }

    /// @notice Starts token distribution. This prohibits token
    ///         unlocks and allows burning tokens from tender
    ///         addresses.
    function startDistribution() public onlyBackend {
        blend.startDistributionPhase();
    }

    /// @notice Ends token distribution. This action reverts BLND
    ///         to the regurlar phase, i.e. unlocks are allowed,
    ///         and burns are prohibited.
    function stopDistribution() public onlyBackend {
        blend.stopDistributionPhase();
    }

    /// @notice Executes orders from lowest price to highest.
    ///         If there is not enough funds on either BLND
    ///         balance or USDC balance, order is executed
    ///         partially. If the specified tender address
    ///         does not exist, the order is skipped.
    /// @param orders The orders to execute
    function executeOrders(Order[] memory orders) public onlyBackend {
        require(
            blend.distributionPhase(),
            "Current phase does not allow distribution"
        );
        uint256 lastPrice = 0;
        for (uint i = 0; i < orders.length; i++) {
            require(orders[i].price >= lastPrice, "Orders must be sorted");
            uint256 usdcLeft = usdc.balanceOf(usdcPool);
            uint256 allowanceLeft = usdc.allowance(usdcPool, address(this));
            uint256 maxUsdc = _min(usdcLeft, allowanceLeft);
            if (maxUsdc > 0) {
                _executeOrder(orders[i], maxUsdc);
                lastPrice = orders[i].price;
            } else {
                break;
            }
        }
    }

    /// @notice Sends all BLEND tokens associated with the Orchestrator
    ///         to the owner of the contract.
    function collectBlend() public onlyOwner {
        blend.transfer(owner(), blend.balanceOf(address(this)));
    }

    /// @dev Executes a single order, possibly partially in case of not enough
    ///      USDC. Fails in case the order can not be executed (due to
    ///      insufficient BLND balance or non-existent tender address).
    /// @param order The order to execute
    /// @param maxUsdc Maximum amount of USDC that can be spent on execution
    /// @return Whether the order has been executed
    function _executeOrder(Order memory order, uint256 maxUsdc) internal {
        uint256 blendAmount = order.amount;
        uint256 usdcAmount = _blendToUsdc(blendAmount, order.price);
        if (usdcAmount > maxUsdc) {
            usdcAmount = maxUsdc;
            blendAmount = _usdcToBlend(usdcAmount, order.price);
        }

        blend.burn(order.redeemerTenderAddress, blendAmount);
        usdc.transferFrom(usdcPool, order.redeemerWallet, usdcAmount);
    }

    /// @dev Given some fixed-point price, converts BLEND to USDC.
    ///      The integral result may be LESS than the actual fixed-point
    ///      value but never more, i.e. this function may UNDERESTIMATE
    ///      the required amount of USDC.
    /// @param blendAmount BLEND amount
    /// @param price Fixed-point price (actual price * PRICE_MULTIPLIER)
    /// @return USDC amount
    function _blendToUsdc(uint256 blendAmount, uint256 price)
        internal
        pure
        returns (uint256 usdcAmount)
    {
        uint256 usdcAmountScaled = blendAmount.mul(price);
        return usdcAmountScaled.div(PRICE_MULTIPLIER);
    }

    /// @dev Given some fixed-point price, converts USDC to BLEND.
    ///      The integral result may be MORE than the actual fixed-point
    ///      value but never less, i.e. this function may OVERESTIMATE
    ///      the required amount of BLEND.
    /// @param usdcAmount USDC amount
    /// @param price Fixed-point price (actual price * PRICE_MULTIPLIER)
    /// @return BLEND amount
    function _usdcToBlend(uint256 usdcAmount, uint256 price)
        internal
        pure
        returns (uint256 blendAmount)
    {
        uint256 usdcAmountScaled = usdcAmount.mul(PRICE_MULTIPLIER);
        return _ceilDiv(usdcAmountScaled, price);
    }

    /// @dev Divides two values and returns a ceiling of the result
    /// @param a Divident
    /// @param b Divisor
    /// @return Integral quotient, guaranteed to be not less than a / b
    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 quot = a.div(b);
        uint256 rem = a.mod(b);
        return (rem == 0) ? quot : (quot + 1);
    }

    /// @dev The minimum of two uint256 values
    /// @param a First value
    /// @param b Second value
    /// @return Minimum of two values
    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a < b) ? a : b;
    }
}
