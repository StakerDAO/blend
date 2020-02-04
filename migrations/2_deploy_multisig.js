const Oz = require('@openzeppelin/cli')
const Multisig = artifacts.require('Multisig')
const { BLEND_MSIG_OWNERS, BLEND_MSIG_THRESHOLD } = process.env

module.exports = function(deployer, network) {
    if (network == 'development') return
    deployer.deploy(
        Multisig,
        JSON.parse(BLEND_MSIG_OWNERS),
        BLEND_MSIG_THRESHOLD
    )
}
