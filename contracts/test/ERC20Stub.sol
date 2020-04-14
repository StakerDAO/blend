pragma solidity ^0.5.13;

import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/StandaloneERC20.sol";

contract ERC20Stub is StandaloneERC20 {
    function initialize(address initialHolder, uint256 initialSupply)
        public
        initializer
    {
        address[] memory minters;
        address[] memory pausers;
        super.initialize(
            "USDC", "USDC", 18, initialSupply,
            initialHolder, minters, pausers
        );
    }
}
