const Resolver = require('@truffle/resolver')
const oz = require('@openzeppelin/cli')
const Web3 = require('web3')
const { Loggy } = require('@openzeppelin/upgrades')


class BlendEnvironment {
    constructor({network, ozOptions, truffleOptions}) {
        this.network = network
        this.ozOptions = ozOptions
        this.from = ozOptions.txParams.from
        this.truffleOptions = oz.ConfigManager.config.getConfig()
        this.web3 = new Web3(truffleOptions.provider)
        this.artifacts = new Resolver(truffleOptions)
    }

    getNetworkController() {
        return new oz.network.NetworkController(
            this.ozOptions.network, this.ozOptions.txParams
        )
    }

    async getContract(name, address) {
        try {
            const Contract = this.artifacts.require(name)
            if (address) {
                return await Contract.at(address)
            }
            return await Contract.deployed()
        } catch (err) {
            console.log(
                `The CLI was unable to find the address of the "${name}" ` +
                `contract on "${ this.network }" network. Make sure to run ` +
                `\`truffle migrate\` to deploy the "${name}" contract.\n`
            )
            throw err
        }
    }
}

// Loads Truffle resolver, Openzeppelin CLI and
// a compatible Web3 instance for the specified network
async function loadProjectEnv({ network, from }) {
    try {
        oz.stdout.silent(false)
        Loggy.silent(false)
        Loggy.verbose(true)

        const ozOptions =
            await oz.ConfigManager.initNetworkConfiguration({ network, from })

        const truffleOptions = oz.ConfigManager.config.getConfig()
        return new BlendEnvironment({
            network, ozOptions, truffleOptions
        })
    } catch (err) {
        console.log(
            'There was an error while accessing the node. ' +
            `Please check that the specified network (${ network }) ` +
            'is accessible and the configuration is in line with ' +
            'your `truffle-config.js` file. \n'
        )
        throw err
    }
}

function getNetworks() {
    return oz.ConfigManager.getNetworkNamesFromConfig()
}

module.exports = {
    loadProjectEnv,
    getNetworks,
}
