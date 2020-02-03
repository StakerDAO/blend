pragma solidity ^0.5.0;

// This feature is considered mature enough to not cause any
// security issues, so the possible warning should be ignored.
// As per solidity developers, "The main reason it is marked
// experimental is because it causes higher gas usage."
// See: https://github.com/ethereum/solidity/issues/5397
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/cryptography/ECDSA.sol";

contract Multisig {
    uint public nonce;
    address[] public owners;
    mapping(address => bool) public isOwner;
    uint public threshold;

    constructor(address[] memory _owners, uint _threshold) public {
        updateOwners(_owners);
        threshold = _threshold;
        nonce = 0;
    }

    function execute(
        address destination,
        uint256 value,
        bytes memory data,
        bytes[] memory signatures
    )
        public
    {
        // Note that `data` is the only variable-length parameter, so
        // we can safely use `encodePacked` here. If this wasn't the case,
        // since length is not encoded, it would be possible to craft
        // the parameters in such a way that they would mix up, and
        // the whole setting would become insecure.
        bytes memory toSign = abi.encodePacked(
            uint8(0x19), uint8(0x00), address(this),
            destination, value, data, nonce
        );
        checkSignatures(toSign, signatures);
        nonce = nonce + 1;

        // Since Istanbul update, the best practice has changed [1],
        // now it's recommended to use call.value instead of transfer.
        // Thus, the security/no-call-value warning is just wrong.
        // For more information, see [2].
        //
        // [1]: https://diligence.consensys.net/blog/2019/09/stop-using-soliditys-transfer-now
        // [2]: https://github.com/ConsenSys/smart-contract-best-practices/pull/226/files

        /* solium-disable-next-line security/no-call-value */
        (bool txSuccessful, ) = destination.call.value(value)(data);
        require(txSuccessful, "Failed to call the requested contract");
    }

    function rotateKeys(
        address[] memory newOwners,
        uint newThreshold,
        bytes[] memory signatures
    )
        public
    {
        // Note that `newOwners` is the only variable-length parameter, so
        // we can safely use `encodePacked` here. If this wasn't the case,
        // since length is not encoded, it would be possible to craft
        // the parameters in such a way that they would mix up, and
        // the whole setting would become insecure.
        bytes memory toSign = abi.encodePacked(
            byte(0x19), byte(0), address(this),
            newOwners, newThreshold, nonce
        );
        checkSignatures(toSign, signatures);
        nonce = nonce + 1;
        updateOwners(newOwners);
        threshold = newThreshold;
    }

    function checkSignatures(bytes memory dataToSign, bytes[] memory signatures)
        internal
        view
    {
        // We fail on duplicate signatures, so this condition is sufficient, no need
        // to check for the number of unique signers.
        require(signatures.length >= threshold, "Threshold not met");
        bytes32 hashToSign = ECDSA.toEthSignedMessageHash(keccak256(dataToSign));
        address lastAddress = address(0);
        uint len = signatures.length;
        for (uint i = 0; i < len; i++) {
            address recovered = ECDSA.recover(hashToSign, signatures[i]);
            require(isOwner[recovered], "Invalid signature");
            require(
                recovered > lastAddress,
                "The addresses must be provided in the ascending order"
            );
            lastAddress = recovered;
        }
    }

    function updateOwners(address[] memory newOwners) internal {
        for (uint i = 0; i < owners.length; i++) {
            delete isOwner[owners[i]];
        }
        for (uint i = 0; i < newOwners.length; i++) {
            isOwner[newOwners[i]] = true;
        }
        owners = newOwners;
    }
}
