// SPDX-FileCopyrightText: 2020 StakerDAO
//
// SPDX-License-Identifier: MPL-2.0

const oz = require('@openzeppelin/cli')
const { Loggy, Contracts, ZWeb3 } = require('@openzeppelin/upgrades')


class BlendEnvironment {
    constructor({network, ozOptions}) {
        this.network = network
        this.ozOptions = ozOptions
        this.txParams = ozOptions.txParams
        this.from = ozOptions.txParams.from
        this.web3 = ZWeb3
        this._nc = new oz.network.NetworkController(network, ozOptions)
    }

    updateController() {
        this._nc = new oz.network.NetworkController(
            this.network, this.ozOptions
        )
    }

    getNetworkController() {
        return this._nc
    }

    getImplementation(name) {
        return this._nc.networkFile.contracts[name]
    }

    getContractInfo(name) {
        const candidates = this._nc.networkFile.getProxies({
            package: 'staker-blend',
            contract: name
        })
        if (candidates.length < 1) {
            throw Error('Could not find contract')
        }
        if (candidates.length > 1) {
            console.log(candidates)
            throw Error('Contract name is not unique')
        }
        return candidates[0]
    }

    getContractAddress(name) {
        return this.getContractInfo(name).address
    }

    getContract(name, address) {
        const contract = Contracts.getFromLocal(name)
        if (!address) {
            try {
                address = this.getContractAddress(name)
            } catch (err) {
                console.log(
                    `The CLI was unable to find the address of the "${name}" ` +
                    `contract on "${ this.network }" network. Make sure to run ` +
                    `\`blend deploy\` to deploy the "${name}" contract.\n`
                )
                throw err
            }
        }
        return contract.at(address)
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

        return new BlendEnvironment({ network, ozOptions })
    } catch (err) {
        console.log(
            'There was an error while accessing the node. ' +
            `Please check that the specified network (${ network }) ` +
            'is accessible and the configuration is in line with ' +
            'your `networks.js` file. \n'
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
