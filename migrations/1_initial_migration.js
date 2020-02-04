const Migrations = artifacts.require('Migrations')

module.exports = function(deployer, network) {
    if (network == 'development') return
    deployer.deploy(Migrations)
}
