pragma solidity 0.5.13;

// This feature is considered mature enough to not cause any
// security issues, so the possible warning should be ignored.
// As per solidity developers, "The main reason it is marked
// experimental is because it causes higher gas usage."
// See: https://github.com/ethereum/solidity/issues/5397
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";

import {BlendToken} from "./BlendToken.sol";
import {Ownable} from "./Ownable.sol";
import {Registry} from "./Registry.sol";

contract Orchestrator is Ownable {
    IERC20 public usdc;
    BlendToken public blend;
    Registry public registry;
    address public distributionBackend;
    address public usdcPool;

    uint256 public constant PRICE_MULTIPLIER = 10_000;

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
    function setDistributionBackend(address newBackend) external onlyOwner {
        distributionBackend = newBackend;
    }

    /// @notice Sets a new USDC pool address. Tokens from USDC pool
    ///         will be used during orders execution.
    /// @param pool The address of the pool
    function setUsdcPool(address pool) external onlyOwner {
        usdcPool = pool;
    }

    /// @notice Sends all BLEND tokens associated with the Orchestrator
    ///         to the owner of the contract.
    function collectBlend() external onlyOwner {
        blend.transfer(owner(), blend.balanceOf(address(this)));
    }

    /// @notice Starts token distribution. This prohibits token
    ///         unlocks and allows burning tokens from tender
    ///         addresses.
    function startDistribution() external onlyBackend {
        blend.startDistributionPhase();
    }

    /// @notice Ends token distribution. This action reverts BLND
    ///         to the regurlar phase, i.e. unlocks are allowed,
    ///         and burns are prohibited.
    function stopDistribution() external onlyBackend {
        blend.stopDistributionPhase();
    }

    /// @notice Executes orders from lowest price to highest.
    ///         If there is not enough USDC, the order is executed
    ///         partially. In case of other errors, the transaction
    ///         fails.
    /// @param orders The orders to execute
    function executeOrders(Order[] calldata orders) external onlyBackend {
        require(
            blend.distributionPhase(),
            "Current phase does not allow distribution"
        );
        uint256 lastPrice = 0;
        uint ordersCount = orders.length;
        for (uint i = 0; i < ordersCount; i++) {
            require(orders[i].price >= lastPrice, "Orders must be sorted");
            _executeOrder(orders[i]);
            lastPrice = orders[i].price;
        }
    }

    /// @dev Executes a single order, possibly partially in case of not enough
    ///      USDC. Fails in case the order can not be executed (due to
    ///      insufficient BLND balance or non-existent tender address).
    /// @param order The order to execute
    /// @return Whether the order has been executed
    function _executeOrder(Order memory order) private {
        uint256 blendAmount = order.amount;
        uint256 usdcAmount = _blendToUsdc(blendAmount, order.price);

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
        private
        pure
        returns (uint256 usdcAmount)
    {
        uint256 usdcAmountScaled = blendAmount.mul(price);
        return usdcAmountScaled.div(PRICE_MULTIPLIER);
    }

    /// @dev Divides two values and returns a ceiling of the result
    /// @param a Divident
    /// @param b Divisor
    /// @return Integral quotient, guaranteed to be not less than a / b
    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        uint256 quot = a.div(b);
        uint256 rem = a.mod(b);
        return (rem == 0) ? quot : (quot + 1);
    }

    /// @dev The minimum of two uint256 values
    /// @param a First value
    /// @param b Second value
    /// @return Minimum of two values
    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return (a < b) ? a : b;
    }
}
