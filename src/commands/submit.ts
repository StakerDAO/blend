import * as fs from 'fs'
import { promisify } from 'util'
import { promptAndLoadEnv, promptIfNeeded } from '../prompt'
import { MultisigAction, TransactionPayload } from '../multisig'
import withErrors from '../utils/withErrors'
import { BlendEnvironment } from '../utils/environment'
import { NetworkName } from '../types'
const readFile = promisify(fs.readFile)


interface SubmitArguments {
    network: NetworkName
    inputFile: string
}

const caseInsensitiveCompare = (lhs: string, rhs: string) => {
    return lhs.localeCompare(rhs, 'en', {sensitivity: 'base'})
}

async function makeTransaction(env: BlendEnvironment, tx: MultisigAction) {
    const payload = tx.payload as TransactionPayload
    const msig =
        env.getContract('Multisig', payload.multisigAddress)

    // The contract expects signatures to be provided in author-ascending
    // order, hence we sort signatures by authors here
    const signatures =
        Object.keys(tx.signatures)
        .sort(caseInsensitiveCompare)
        .map(addr => fixSignature(tx.signatures[addr]))

    try {
        const result = await msig.methods.execute(
            payload.targetAddress,
            payload.txValue,
            payload.txData,
            signatures
        ).send({ from: env.from })
        console.log(`Transaction submitted, txhash: ${result.transactionHash}`)
    } catch (err) {
        console.error(err)
    }
}

async function makeQuestions(env: BlendEnvironment) {
    const existingAccounts = await env.web3.eth.getAccounts()
    return [
        {
            type: 'file-tree-selection',
            name: 'inputFile',
            message: 'Transaction to send (JSON file)',
            validate: MultisigAction.validateFile,
            cwd: process.cwd(),
        },
    ]
}

function fixSignature(signature: string) {
    // in geth its always 27/28, in ganache its 0/1. Change to 27/28 to prevent
    // signature malleability if version is 0/1
    // see https://github.com/ethereum/go-ethereum/blob/v1.8.23/internal/ethapi/api.go#L465
    let v = parseInt(signature.slice(130, 132), 16);
    if (v < 27) {
        v += 27;
    }
    const vHex = v.toString(16);
    return signature.slice(0, 130) + vHex;
}

async function submit(inputFile: string, options: Partial<SubmitArguments>) {
    options.inputFile = inputFile
    const blendEnv = await promptAndLoadEnv({networkInOpts: options.network})
    const questions = await makeQuestions(blendEnv)
    const args = await promptIfNeeded(options, questions as any) as SubmitArguments
    const tx = await MultisigAction.fromFile(args.inputFile)
    if (tx.action == 'transaction') {
        await makeTransaction(blendEnv, tx)
    }
}

function register(program: any) {
    program
        .command('submit [input_file]')
        .description(
            'Sign a Multisig transaction JSON file. Writes the signed ' +
            'transaction to the specified output file.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .action(withErrors(submit))
}

export { register }
