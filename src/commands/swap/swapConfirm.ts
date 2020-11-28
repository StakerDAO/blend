import { Contract } from '@openzeppelin/upgrades'
import * as Utils from 'web3-utils'
import { promptAndLoadEnv, promptIfNeeded } from '../../prompt'
import { BlendEnvironment } from '../../utils/environment'
import withErrors from '../../utils/withErrors'
import { ensureAddress } from '../../utils/validators'
import { NetworkName, Address } from '../../types'


interface SwapConfirmArguments {
    network: NetworkName
    from: Address
    secretHash: string
}

type CmdlineOptions = Partial<SwapConfirmArguments>

async function swapConfirm(options: CmdlineOptions) {
    const env = await promptAndLoadEnv({networkInOpts: options.network})

    const swapContract = await env.getContract('BlendSwap')
    const blendAddress = await swapContract.methods.blend().call()

    const questions = await makeQuestions(env)
    const args = await promptIfNeeded(options, questions)

    await swapContract.methods.confirmSwap(
        args.secretHash
    ).send({from: args.from})
}

async function makeQuestions(env: BlendEnvironment) {
    const existingAccounts = await env.web3.eth.getAccounts()
    return [
        {
            type: 'list',
            name: 'from',
            message: 'Address to confirm swap from',
            choices: existingAccounts,
            validate:
                async (address: Address) => existingAccounts.includes(address),
        },
        {
            type: 'input',
            name: 'secretHash',
            message: 'Secret hash',
        },
    ]
}

function register(program: any) {
    program
        .command('swap-confirm')
        .usage('swap-confirm')
        .description(
            'Confirm swap'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--from <address>', 'address to confirm swap from')
        .option('--secret-hash', 'secret hash')
        .action(withErrors(swapConfirm))
}

export { register }
