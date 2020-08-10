// SPDX-FileCopyrightText: 2020 StakerDAO
//
// SPDX-License-Identifier: MPL-2.0

import * as oz from '@openzeppelin/cli'
import { Loggy, Contract, Contracts, ProxyAdmin, ZWeb3 } from '@openzeppelin/upgrades'
import { Address, NetworkName } from '../types'


type ContractInfo = any

class _BlendEnvironment {
    network: NetworkName
    ozOptions: any
    txParams: any
    from: Address
    web3: typeof ZWeb3
    _nc: any

    constructor(args: {network: NetworkName, ozOptions: any}) {
        const {network, ozOptions} = args
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

    getProxyAdmin() {
        return ProxyAdmin.fetch(this._nc.proxyAdminAddress, this.txParams)
    }

    getImplementation(name: string): ContractInfo {
        return this._nc.networkFile.contracts[name]
    }

    getContractInfo(name: string): ContractInfo {
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

    getContractAddress(name: string): Address {
        return this.getContractInfo(name).address
    }

    getContract(name: string, address?: Address): Contract {
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

type BlendEnvironment = _BlendEnvironment
type EnvironmentParameters = {
    network: NetworkName,
    from?: Address
}

// Loads network configuration, Openzeppelin CLI and
// a compatible Web3 instance for the specified network
async function loadProjectEnv({ network, from }: EnvironmentParameters) {
    try {
        oz.stdout.silent(false)
        Loggy.silent(false)
        Loggy.verbose(true)

        const ozOptions =
            await oz.ConfigManager.initNetworkConfiguration({ network, from })

        return new _BlendEnvironment({ network, ozOptions })
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

export {
    BlendEnvironment,
    loadProjectEnv,
    getNetworks,
}
