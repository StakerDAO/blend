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
    mapping (bytes32 => bytes32) public secrets;
    mapping (bytes32 => Status) public status;

    IERC20 public blend;

    struct Swap {
        address from;
        address to;
        uint amount;
        uint releaseTime;
        bytes32 secretHash;
        uint256 fee;
    }

    enum Status {
        NOT_INITIALIZED,
        INITIALIZED,
        CONFIRMED,
        SECRET_REVEALED,
        REFUNDED
    }

    constructor(address blend_) public {
        blend = IERC20(blend_);
    }

    function getSwap(bytes32 secretHash) public view returns (Swap memory) {
        return swaps[secretHash];
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
        require(
            status[secretHash] == Status.NOT_INITIALIZED,
            "Lock with this secretHash already exists"
        );

        swaps[secretHash] = Swap({
            from: msg.sender,
            to: to,
            amount: amount,
            releaseTime: releaseTime,
            secretHash: secretHash,
            fee: fee
        });

        if (confirmed) {
            status[secretHash] = Status.CONFIRMED;
        } else {
            status[secretHash] = Status.INITIALIZED;
        }

        blend.transferFrom(msg.sender, address(this), amount + fee);
        emit LockEvent(secretHash, msg.sender, to, amount, releaseTime, confirmed, fee);
    }

    function confirmSwap(bytes32 secretHash) public {
        require(
            status[secretHash] == Status.INITIALIZED,
            "Wrong status"
        );

        require(
            msg.sender == swaps[secretHash].from,
            "Sender is not the initiator"
        );

        status[secretHash] = Status.CONFIRMED;
        emit ConfirmEvent(secretHash);
    }

    function redeem(bytes32 secret) public {
        bytes32 secretHash = sha256(abi.encode(secret));

        require(
            status[secretHash] == Status.CONFIRMED,
            "Wrong status"
        );

        require(
            secretHash == swaps[secretHash].secretHash,
            "Wrong secret"
        );

        status[secretHash] = Status.SECRET_REVEALED;
        secrets[secretHash] = secret;

        blend.transfer(swaps[secretHash].to, swaps[secretHash].amount + swaps[secretHash].fee);
        emit RedeemEvent(secretHash, secret);
    }

    function claimRefund(bytes32 secretHash) public {
        require(
            block.timestamp >= swaps[secretHash].releaseTime,
            "Funds still locked"
        );

        Status st = status[secretHash];
        require(
            st == Status.INITIALIZED || st == Status.CONFIRMED,
            "Wrong status"
        );

        require(
            msg.sender == swaps[secretHash].from,
            "Sender is not the initiator"
        );

        status[secretHash] = Status.REFUNDED;

        blend.transfer(swaps[secretHash].to, swaps[secretHash].fee);
        blend.transfer(swaps[secretHash].from, swaps[secretHash].amount);
        emit RefundEvent(secretHash);
    }
}
