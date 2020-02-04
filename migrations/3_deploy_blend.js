const Oz = require('@openzeppelin/cli')
const { loadProjectEnv } = require('../src/utils/environment')
const Multisig = artifacts.require('Multisig')
const { BLEND_MINTER, BLEND_SUPPLY } = process.env

async function deployBlend(msigAddress, networkName, accounts) {
    const from = accounts[0]
    const blendEnv = await loadProjectEnv({ network: networkName, from })
    const { network, txParams } = blendEnv.ozOptions

    const oz = Oz.scripts
    oz.add({ contractsData: [{ name: 'BlendToken', alias: 'BlendToken' }] })
    await oz.push({ network, txParams })

    await oz.create({
        contractAlias: 'BlendToken',
        network, txParams
    })

    const blend = await blendEnv.getContract('BlendToken')

    console.log('Initializing BLEND token...')
    // initialize is overloaded, so we must make sure that we
    // call the method with the right signature
    const initialize = blend.methods['initialize(address,uint256)']
    await initialize(BLEND_MINTER, BLEND_SUPPLY, { from: from })

    await oz.setAdmin({
        contractAlias: 'BlendToken',
        newAdmin: msigAddress,
        network, txParams
    })
}

module.exports = function(deployer, network, accounts) {
    deployer.then(async () => {
        const msig = await Multisig.deployed()
        await deployBlend(msig.address, network, accounts)
    })
}
