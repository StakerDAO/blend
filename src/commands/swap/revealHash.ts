import { Contract } from '@openzeppelin/upgrades'
import * as Utils from 'web3-utils'
import { promptAndLoadEnv, promptIfNeeded } from '../../prompt'
import { BlendEnvironment } from '../../utils/environment'
import withErrors from '../../utils/withErrors'
import { ensureAddress } from '../../utils/validators'
import { NetworkName, Address } from '../../types'


interface RevealHashArguments {
    network: NetworkName
    from: Address
    secretHash: string
}

type CmdlineOptions = Partial<RevealHashArguments>

async function revealHash(options: CmdlineOptions) {
    const env = await promptAndLoadEnv({networkInOpts: options.network})

    const swapContract = await env.getContract('BlendSwap')
    const blendAddress = await swapContract.methods.blend().call()

    const questions = await makeQuestions(env)
    const args = await promptIfNeeded(options, questions)

    await swapContract.methods.revealSecretHash(
        args.secretHash
    ).send({from: args.from})
}

async function makeQuestions(env: BlendEnvironment) {
    const existingAccounts = await env.web3.eth.getAccounts()
    return [
        {
            type: 'list',
            name: 'from',
            message: 'Address to reveal the hash from',
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
        .command('swap-reveal-hash')
        .usage('swap-reveal-hash')
        .description(
            'Reveal secret hash'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--from <address>', 'address to reveal the hash from')
        .option('--secret-hash', 'secret hash')
        .action(withErrors(revealHash))
}

export { register }
