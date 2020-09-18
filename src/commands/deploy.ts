
// SPDX-FileCopyrightText: 2020 StakerDAO
//
// SPDX-License-Identifier: MPL-2.0

import { spawnSync } from 'child_process'
import * as oz from '@openzeppelin/cli'
import * as Utils from 'web3-utils'
import { promptAndLoadEnv, promptIfNeeded } from '../prompt'
import withErrors from '../utils/withErrors'
import { Address, BN, NetworkName } from '../types'
import { BlendEnvironment } from '../utils/environment'
import { ensureAddress } from '../utils/validators'


interface DeploymentArguments {
    network: NetworkName
    owners: Address[]
    threshold: Number
    initialHolder: Address
    supply: BN
    distributionBackend: Address
    registryBackend: Address
    usdcPool: Address
    usdc: Address
}

type CmdlineOptions = Partial<DeploymentArguments>

async function deploy(
    owner1: Address,
    otherOwners: Address[],
    options: CmdlineOptions
): Promise<void> {
    options.owners = [owner1, ...otherOwners]
    options.owners.forEach(owner => {
        if (!Utils.isAddress(owner)) {
            throw new Error(`${owner} is not a valid Ethereum address`)
        }
    })
    const env = await promptAndLoadEnv({ networkInOpts: options.network })
    const questions = makeQuestions(options.owners)
    const args = await promptIfNeeded(options, questions) as DeploymentArguments

    updateProjectFile()
    await deployToNetwork(env, args)
    await initialize(env, args)
}

async function deployRegularContract(
    env: BlendEnvironment,
    contractName: string,
    args: any
) {
    const nc = env.getNetworkController()

    try {
        const instance = await nc.createInstance(
            'staker-blend', contractName, args
        )
        return instance.address
    } finally {
        nc.writeNetworkPackageIfNeeded()
    }
}

function updateProjectFile() {
    oz.scripts.add({
        contractsData: [
            { name: 'BlendToken', alias: 'BlendToken' },
            { name: 'Registry', alias: 'Registry' },
        ]
    })
}

async function deployToNetwork(
    env: BlendEnvironment,
    args: DeploymentArguments
) {
    const { network, txParams } = env

    console.log('Deploying Multisig...')
    await deployRegularContract(
        env, 'Multisig', [args.owners, args.threshold]
    )

    console.log(
        'Deploying BlendToken and Registry implementations to the network'
    )
    await oz.scripts.push({ network, txParams })

    console.log('Creating an upgradeable proxy for BlendToken')
    console.log(txParams)
    await oz.scripts.create({
        contractAlias: 'BlendToken',
        network, txParams
    })

    console.log('Creating an upgradeable proxy for Registry')
    await oz.scripts.create({
        contractAlias: 'Registry',
        network, txParams
    })
    env.updateController()


    console.log('Deploying Orchestrator to the network')
    await deployRegularContract(
        env,
        'Orchestrator',
        [
            args.distributionBackend,
            env.getContractAddress('BlendToken'),
            env.getContractAddress('Registry'),
            args.usdcPool,
            args.usdc,
        ]
    )
    env.updateController()
}

async function initialize(
    env: BlendEnvironment,
    {initialHolder, supply, registryBackend}: DeploymentArguments
) {
    const blend = env.getContract('BlendToken')
    const registry = env.getContract('Registry')
    const orchestrator = env.getContract('Orchestrator')

    const initializeBlend =
        blend.methods['initialize(address,uint256,address,address)']

    const initializeRegistry =
        registry.methods['initialize(address,address)']

    console.log('Initializing BLEND')

    console.log(
        [
            initialHolder,
            supply,
            registry.address,
            orchestrator.address
        ]
    )

    await initializeBlend(
        initialHolder,
        supply,
        registry.address,
        orchestrator.address
    ).send({ from: env.from })

    await initializeRegistry(
        blend.address,
        registryBackend,
    ).send({ from: env.from })
}

function makeQuestions(owners: Address[]) {
    return [
        {
            type: 'number',
            name: 'threshold',
            message: `Multisig threshold (1 <= N <= ${owners.length})`,
            validate: async (threshold: Number) => {
                if (threshold < 1 || threshold > owners.length) {
                    return `Threshold must be in range [1, ${owners.length}]`
                }
                if (!Number.isInteger(Number(threshold))) {
                    return 'Threshold must be a natural number'
                }
                return true
            },
        },
        {
            type: 'input',
            name: 'initialHolder',
            message: 'Address of BLEND initial holder',
            validate: ensureAddress,
        },
        {
            type: 'input',
            name: 'supply',
            message: 'Total supply (in BLEND tokens)',
            validate: async (value: string) => {
                try {
                    Utils.toWei(value)
                    return true
                } catch (err) {
                    return `${value} is not a valid token amount`
                }
            },
        },
        {
            type: 'input',
            name: 'distributionBackend',
            message: 'Distribution backend address',
            validate: ensureAddress,
        },
        {
            type: 'input',
            name: 'registryBackend',
            message: 'Registry backend address',
            validate: ensureAddress,
        },
        {
            type: 'input',
            name: 'usdcPool',
            message: 'USDC pool address',
            validate: ensureAddress,
        },
        {
            type: 'input',
            name: 'usdc',
            message: 'Address of USDC token',
            validate: ensureAddress,
        },
    ]
}

function register(program: any) {
    program
        .command('deploy <owner1> [owners...]')
        .usage('deploy <keys...>')
        .description(
            'Deploy Multisig and BlendToken using the provided migration ' +
            'scripts. Since it uses `truffle migrate` under the hood, ' +
            'the migrations will not be run twice on the same network.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--threshold <threshold>', 'signatures threshold')
        .option('--initial-holder <address>', 'BLEND initial holder address')
        .option('--supply <amount>', 'BLEND token supply')
        .option('--registry-backend <address>', 'Registry backend address')
        .option('--distribution-backend <address>', 'Distribution backend address')
        .option('--usdc-pool <address>', 'USDC pool address')
        .option('--usdc <address>', 'USDC token contract address')
        .action(withErrors(deploy))
}

export { register }
