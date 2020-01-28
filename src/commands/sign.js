const validFilename = require('valid-filename')
const { promptAndLoadEnv, promptIfNeeded } = require('../prompt')
const { MultisigTx } = require('../multisig')
const withErrors = require('../utils/withErrors')


async function makeQuestions(blendEnv) {
    const existingAccounts = await blendEnv.web3.eth.getAccounts()
    return [
        {
            type: 'list',
            name: 'with',
            message: 'Pick an address',
            choices: existingAccounts,
            validate: async address => existingAccounts.includes(address),
        },
        {
            type: 'file-tree-selection',
            name: 'inputFile',
            message: 'Transaction to sign (JSON file)',
            validate: MultisigTx.validateFile,
            cwd: process.cwd(),
        },
        {
            type: 'input',
            name: 'outputFile',
            message: 'File to write the signed transaction to',
            validate: async outputFile =>
                validFilename(outputFile) ||
                `${outputFile} is not a valid file name`,
        }
    ]
}

async function sign(inputFile, options) {
    options.inputFile = inputFile
    const blendEnv = await promptAndLoadEnv({networkInOpts: options.network})
    const questions = await makeQuestions(blendEnv)
    const args = await promptIfNeeded(options, questions)

    const tx = await MultisigTx.fromFile(args.inputFile)
    const signature = await blendEnv.web3.eth.sign(tx.hash(), args.with)

    tx.addSignature(args.with, signature)
    await tx.save(args.outputFile)
}

function register(program) {
    program
        .command('sign [input_file]')
        .description(
            'Sign a Multisig transaction JSON file. Writes the signed ' +
            'transaction to the specified output file.'
        )
        .option('--with <address>', 'address of the signer')
        .option('-n, --network <network_name>', 'network to use')
        .option(
            '-o, --output-file <output_file>',
            'output file to write the signed transaction to'
        )
        .action(withErrors(sign))
}

module.exports = { register }
