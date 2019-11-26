pragma solidity ^0.5.0;

import "@openzeppelin/upgrades/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/token/ERC20/ERC20Detailed.sol";

contract BlendToken is Initializable, ERC20, ERC20Detailed {
    function initialize(uint256 initialSupply) initializer public {
        ERC20Detailed.initialize("Blend Token", "BLEND", 18);
        _mint(msg.sender, initialSupply);
    }
}
