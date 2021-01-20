pragma solidity^0.5.13;

// This feature is considered mature enough to not cause any
// security issues, so the possible warning should be ignored.
// As per solidity developers, "The main reason it is marked
// experimental is because it causes higher gas usage."
// See: https://github.com/ethereum/solidity/issues/5397
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/IERC20.sol";

contract BlendSwap {

    mapping (bytes32 => Swap) public swaps;

    IERC20 public blend;

    struct Swap {
        address from;
        address to;
        uint amount;
        uint releaseTime;
        bool confirmed;
        uint256 fee;
    }

    constructor(address blend_) public {
        blend = IERC20(blend_);
    }

    event LockEvent(
        bytes32 indexed secretHash,
        address from,
        address to,
        uint256 amount,
        uint releaseTime,
        bool confirmed,
        uint256 fee
    );
    event ConfirmEvent(bytes32 indexed secretHash);
    event RedeemEvent(bytes32 indexed secretHash, bytes32 secret);
    event RefundEvent(bytes32 indexed secretHash);

    modifier onlyBlend() {
        require(
            msg.sender == address(blend),
            "Unauthorized: sender is not the Blend contract"
        );
        _;
    }

    function ensureLockExists(bytes32 secretHash) internal {
        require(
            swaps[secretHash].from != address(0),
            "Swap not initialized"
        );
    }

    function lockBody(
        address from,
        address to,
        uint256 amount,
        uint releaseTime,
        bytes32 secretHash,
        bool confirmed,
        uint256 fee
    ) 
        internal
    {
        require(
            swaps[secretHash].from == address(0),
            "Lock with this secretHash already exists"
        );

        swaps[secretHash] = Swap({
            from: from,
            to: to,
            amount: amount,
            releaseTime: releaseTime,
            confirmed: confirmed,
            fee: fee
        });

        blend.transferFrom(from, address(this), amount + fee);
        emit LockEvent(secretHash, from, to, amount, releaseTime, confirmed, fee);
    }

    function lock(
        address to,
        uint256 amount,
        uint releaseTime,
        bytes32 secretHash,
        bool confirmed,
        uint256 fee
    ) 
        public
    {
        lockBody(msg.sender, to, amount, releaseTime, secretHash, confirmed, fee);
    }

    function lockFrom(
        address from,
        address to,
        uint256 amount,
        uint releaseTime,
        bytes32 secretHash,
        bool confirmed,
        uint256 fee
    )
        public onlyBlend
    {
        lockBody(from, to, amount, releaseTime, secretHash, confirmed, fee);
    }

    function confirmSwap(bytes32 secretHash) public {
        ensureLockExists(secretHash);

        require(
            swaps[secretHash].confirmed == false,
            "Confirmed swap"
        );

        require(
            msg.sender == swaps[secretHash].from,
            "Sender is not the initiator"
        );

        swaps[secretHash].confirmed = true;
        emit ConfirmEvent(secretHash);
    }

    function redeem(bytes32 secret) public {
        bytes32 secretHash = sha256(abi.encode(secret));

        ensureLockExists(secretHash);

        require(
            swaps[secretHash].confirmed == true,
            "Unconfirmed swap"
        );

        blend.transfer(swaps[secretHash].to, swaps[secretHash].amount + swaps[secretHash].fee);
        delete swaps[secretHash];
        emit RedeemEvent(secretHash, secret);
    }

    function claimRefund(bytes32 secretHash) public {
        ensureLockExists(secretHash);

        require(
            block.timestamp >= swaps[secretHash].releaseTime,
            "Funds still locked"
        );

        require(
            msg.sender == swaps[secretHash].from,
            "Sender is not the initiator"
        );

        blend.transfer(swaps[secretHash].to, swaps[secretHash].fee);
        blend.transfer(swaps[secretHash].from, swaps[secretHash].amount);
        delete swaps[secretHash];
        emit RefundEvent(secretHash);
    }
}
