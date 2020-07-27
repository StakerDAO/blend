import validFilename  from 'valid-filename'
import { promptAndLoadEnv, promptIfNeeded }  from '../prompt'
import { MultisigAction }  from '../multisig'
import withErrors  from '../utils/withErrors'
import { BlendEnvironment } from '../utils/environment'
import { NetworkName, Address } from '../types'


interface SignArguments {
    network: NetworkName
    with: Address
    inputFile: string
    outputFile: string
}

async function makeQuestions(blendEnv: BlendEnvironment) {
    const existingAccounts = await blendEnv.web3.eth.getAccounts()
    return [
        {
            type: 'list',
            name: 'with',
            message: 'Pick an address',
            choices: existingAccounts,
            validate:
                async (address: Address) => existingAccounts.includes(address),
        },
        {
            type: 'file-tree-selection',
            name: 'inputFile',
            message: 'Transaction to sign (JSON file)',
            validate: MultisigAction.validateFile,
            cwd: process.cwd(),
        },
        {
            type: 'input',
            name: 'outputFile',
            message: 'File to write the signed transaction to',
            validate: async (outputFile: string) =>
                validFilename(outputFile) ||
                `${outputFile} is not a valid file name`,
        }
    ]
}

async function sign(inputFile: string, options: Partial<SignArguments>) {
    options.inputFile = inputFile
    const blendEnv = await promptAndLoadEnv({networkInOpts: options.network})
    const questions = await makeQuestions(blendEnv)
    const args = await promptIfNeeded(options, questions) as SignArguments
    const tx = await MultisigAction.fromFile(args.inputFile)
    const signature = await blendEnv.web3.eth.sign(tx.hash(), args.with)

    tx.addSignature(args.with, signature)
    await tx.save(args.outputFile)
}

function register(program: any) {
    program
        .command('sign [input_file]')
        .description(
            'Sign a Multisig transaction JSON file. Writes the signed ' +
            'transaction to the specified output file.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--with <address>', 'address of the signer')
        .option(
            '-o, --output-file <output_file>',
            'output file to write the signed transaction to'
        )
        .action(withErrors(sign))
}

export { register }
