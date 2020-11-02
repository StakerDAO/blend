import { Contract } from '@openzeppelin/upgrades'
import * as Utils from 'web3-utils'
import { promptAndLoadEnv, promptIfNeeded } from '../../prompt'
import { BlendEnvironment } from '../../utils/environment'
import withErrors from '../../utils/withErrors'
import { ensureAddress } from '../../utils/validators'
import { NetworkName, Address } from '../../types'


interface RedeemArguments {
    network: NetworkName
    from: Address
    secret: string
}

type CmdlineOptions = Partial<RedeemArguments>

async function redeem(options: CmdlineOptions) {
    const env = await promptAndLoadEnv({networkInOpts: options.network})

    const swapContract = await env.getContract('BlendSwap')
    const blendAddress = await swapContract.methods.blend().call()

    const questions = await makeQuestions(env)
    const args = await promptIfNeeded(options, questions)

    await swapContract.methods.redeem(
        args.secret
    ).send({from: args.from})
}

async function makeQuestions(env: BlendEnvironment) {
    const existingAccounts = await env.web3.eth.getAccounts()
    return [
        {
            type: 'list',
            name: 'from',
            message: 'Address to redeem the tokens to',
            choices: existingAccounts,
            validate:
                async (address: Address) => existingAccounts.includes(address),
        },
        {
            type: 'input',
            name: 'secret',
            message: 'Secret',
        },
    ]
}

function register(program: any) {
    program
        .command('swap-redeem')
        .usage('swap-redeem')
        .description(
            'Redeem'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--from <address>', 'address to redeem tokens to')
        .option('--secret', 'secret')
        .action(withErrors(redeem))
}

export { register }
