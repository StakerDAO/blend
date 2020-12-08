import { Contract } from '@openzeppelin/upgrades'
import * as Utils from 'web3-utils'
import { promptAndLoadEnv, promptIfNeeded } from '../../prompt'
import { BlendEnvironment } from '../../utils/environment'
import withErrors from '../../utils/withErrors'
import { ensureAddress } from '../../utils/validators'
import { NetworkName, Address } from '../../types'


interface LockArguments {
    network: NetworkName
    from: Address
    to: Address
    amount: string
    secretHash: string
    confirmed: boolean
    fee: string
}

type CmdlineOptions = Partial<LockArguments>

async function lock(options: CmdlineOptions) {
    const env = await promptAndLoadEnv({networkInOpts: options.network})

    const swapContract = await env.getContract('BlendSwap')
    const blendAddress = await swapContract.methods.blend().call()
    const blend = await env.getContract('BlendToken', blendAddress)

    const questions = await makeQuestions(env)
    const args = await promptIfNeeded(options, questions)

    const timeout = 60 * 60  // seconds
    const releaseTime = Math.floor(Date.now() / 1000) + timeout

    const amount = Utils.toWei(args.amount)
    const fee = Utils.toWei(args.fee)

    await blend.methods.approve(
        swapContract.address, amount.add(fee)
    ).send({from: args.from})

    await swapContract.methods.lock(
        args.to, amount, releaseTime, args.secretHash, args.confirmed, fee
    ).send({from: args.from})
}

async function makeQuestions(env: BlendEnvironment) {
    const existingAccounts = await env.web3.eth.getAccounts()
    return [
        {
            type: 'list',
            name: 'from',
            message: 'Address to lock the tokens from',
            choices: existingAccounts,
            validate:
                async (address: Address) => existingAccounts.includes(address),
        },
        {
            type: 'input',
            name: 'to',
            message: 'Address to send the tokens to',
            validate: ensureAddress,
        },
        {
            type: 'input',
            name: 'amount',
            message: 'The amount to lock',
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
            name: 'secretHash',
            message: 'Secret hash',
        },
        {
            type: 'input',
            name: 'confirmed',
            message: 'Set true if you are not the initiator',
        },
        {
            type: 'input',
            name: 'fee',
            message: 'The fee of the swap',
            validate: async (value: string) => {
                try {
                    Utils.toWei(value)
                    return true
                } catch (err) {
                    return `${value} is not a valid fee`
                }
            },
        },
    ]
}

function register(program: any) {
    program
        .command('swap-lock')
        .usage('swap-lock')
        .description(
            'Lock tokens for future swap'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--from <address>', 'address to lock tokens from')
        .option('--to <address>', 'address to send tokens to')
        .option('--amount <amount>', 'the amount of tokens to send (e.g., 12.9876)')
        .option('--secret-hash', 'secret hash')
        .option('--confirmed', 'confirmed or not')
        .option('--fee <fee>', 'the fee of the swap (e.g., 12.9876)')
        .action(withErrors(lock))
}

export { register }
