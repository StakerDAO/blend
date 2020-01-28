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
    const blendEnv = await promptAndLoadEnv({ networkInOpts: options.network })
    const questions = makeQuestions(blendEnv, owners)
    const args = await promptIfNeeded(options, questions)

    // We spawn a `truffle migrate` process because truffle doesn't
    // expose any javascript utilities to invoke migrations from
    // JS code so far. We pass deployment options via environment
    // variables because currently `truffle migrate` doesn't support
    // user-defined command line arguments.
    // Since it is the last action executed, we can safely invoke
    // the synchronous version of the comand.
    console.log('Invoking `truffle migrate` with the supplied options...')
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
            name: 'minter',
            message: 'Address of the BLEND token minter',
            validate: async address => {
                return Utils.isAddress(address) ||
                       `${address} is not a valid Ethereum address`
            },
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
            }
        },
    ]
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
        .option('--minter <address>', 'BLEND minter address')
        .option('--supply <amount>', 'BLEND token supply')
        .action(withErrors(deploy))
}

module.exports = { register }
