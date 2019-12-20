const Multisig = artifacts.require("Multisig");

module.exports = function(deployer) {
  deployer.deploy(Multisig, [], 1);
};
