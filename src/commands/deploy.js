// SPDX-FileCopyrightText: 2020 StakerDAO
//
// SPDX-License-Identifier: MPL-2.0

const oz = require('@openzeppelin/cli')
const { spawnSync } = require('child_process')
const Utils = require('web3-utils')
const { promptAndLoadEnv, promptIfNeeded } = require('../prompt')
const withErrors = require('../utils/withErrors')

async function deploy(owner1, otherOwners, options) {
    const owners = [owner1, ...otherOwners]
    owners.forEach(owner => {
        if (!Utils.isAddress(owner)) {
            throw new Error(`${owner} is not a valid Ethereum address`)
        }
    })
    const env = await promptAndLoadEnv({ networkInOpts: options.network })
    const questions = makeQuestions(env, owners)
    const args = await promptIfNeeded(options, questions)

    // We spawn a `truffle migrate` process because truffle doesn't
    // expose any javascript utilities to invoke migrations from
    // JS code so far. We pass deployment options via environment
    // variables because currently `truffle migrate` doesn't support
    // user-defined command line arguments.
    // Since it is the last action executed, we can safely invoke
    // the synchronous version of the comand.
    /*console.log('Invoking `truffle migrate` with the supplied options...')
    spawnSync(
        'npx truffle migrate',
        ['--network', blendEnv.network],
        {
            stdio: 'inherit',
            shell: true,
            env: {
                BLEND_MSIG_OWNERS: JSON.stringify(owners),
                BLEND_MSIG_THRESHOLD: args.threshold,
                BLEND_MINTER: args.minter,
                BLEND_SUPPLY: Utils.toWei(args.supply),
                ...process.env
            }
        }
    )
    */

    updateProjectFile()
    await deployToNetwork(env, { owners, ...args })
    await initialize(env, args)
}

async function deployRegularContract(env, contractName, deployArgs) {
    const nc = env.getNetworkController()

    try {
        const instance = await nc.createInstance(
            'staker-blend', contractName, deployArgs
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

async function deployToNetwork(env, args) {
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
            env.getContractAddress('BlendToken'), //'0x594f4860Aa89939f8BD69fd38d09FB75DC92C909', // args.usdc,
        ]
    )
    env.updateController()
}

async function initialize(env, {initialHolder, supply, registryBackend}) {
    const blend = await env.getContract('BlendToken')
    const registry = await env.getContract('Registry')
    const orchestrator = await env.getContract('Orchestrator')

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

function makeQuestions(blendEnv, owners) {
    return [
        {
            type: 'number',
            name: 'threshold',
            message: `Multisig threshold (1 <= N <= ${owners.length})`,
            validate: async threshold => {
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
            validate: async value => {
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

async function ensureAddress(address) {
    return Utils.isAddress(address) ||
           `${address} is not a valid Ethereum address`
}

function register(program) {
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
        .action(withErrors(deploy))
}

module.exports = { register }
