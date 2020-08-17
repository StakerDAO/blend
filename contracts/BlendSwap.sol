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
    mapping (bytes32 => bytes32) public hashlocks;
    mapping (bytes32 => bytes32) public secrets;
    mapping (bytes32 => Status) public status;

    IERC20 public blend;

    struct Swap {
        address from;
        address to;
        uint amount;
        uint releaseTime;
    }

    enum Status {
        NOT_INITIALIZED,
        INITIALIZED,
        HASH_REVEALED,
        SECRET_REVEALED,
        REFUNDED
    }

    constructor(address blend_) public {
        blend = IERC20(blend_);
    }

    function lock(
        bytes32 lockId,
        address to,
        uint256 amount,
        uint releaseTime,
        bytes32 secretHash
    )
        public
    {
        require(
            status[lockId] == Status.NOT_INITIALIZED,
            "Lock with this id already exists"
        );

        swaps[lockId] = Swap({
            from: msg.sender,
            to: to,
            amount: amount,
            releaseTime: releaseTime
        });


        if (secretHash == 0x00) {
            status[lockId] = Status.INITIALIZED;
        } else {
            status[lockId] = Status.HASH_REVEALED;
            hashlocks[lockId] = secretHash;
        }

        blend.transferFrom(msg.sender, address(this), amount);
    }

    function revealSecretHash(bytes32 lockId, bytes32 secretHash) public {
        require(
            status[lockId] == Status.INITIALIZED,
            "Wrong status"
        );
        require(
            msg.sender == swaps[lockId].from,
            "Sender is not the initiator"
        );

        status[lockId] = Status.HASH_REVEALED;
        hashlocks[lockId] = secretHash;
    }

    function redeem(bytes32 lockId, bytes32 secret) public {
        require(
            status[lockId] == Status.HASH_REVEALED,
            "Wrong status"
        );
        require(
            sha256(abi.encode(secret)) == hashlocks[lockId],
            "Wrong secret"
        );

        status[lockId] = Status.SECRET_REVEALED;
        secrets[lockId] = secret;

        blend.transfer(swaps[lockId].to, swaps[lockId].amount);
    }

    function claimRefund(bytes32 lockId) public {
        require(
            block.timestamp >= swaps[lockId].releaseTime,
            "Funds still locked"
        );
        Status st = status[lockId];
        require(
            st == Status.INITIALIZED || st == Status.HASH_REVEALED,
            "Wrong status"
        );

        status[lockId] = Status.REFUNDED;

        blend.transfer(swaps[lockId].from, swaps[lockId].amount);
    }
}
