const validFilename = require('valid-filename')
const { promptIfNeeded } = require('../prompt')
const { MultisigTx } = require('../multisig')
const withErrors = require('../utils/withErrors')

async function merge(inputFile1, inputFile2, otherInputs, options) {
    const inputFiles = [inputFile1, inputFile2, ...otherInputs]
    const inputTxs = await Promise.all(
        inputFiles.map(file => MultisigTx.fromFile(file))
    )
    checkAllEqual(inputTxs)

    const questions = [{
        type: 'input',
        name: 'outputFile',
        message: 'File to write the merged transaction to',
        validate: async outputFile =>
            validFilename(outputFile) ||
            `${outputFile} is not a valid file name`,
    }]
    const args = await promptIfNeeded(options, questions)

    const mergedTx = new MultisigTx({
        action: inputTxs[0].action,
        payload: inputTxs[0].payload,
        signatures: inputTxs.reduce((acc, tx) => {
            return { ...acc, ...tx.signatures }
        }, {})
    })

    await mergedTx.save(args.outputFile)
}

function checkAllEqual(inputTxs) {
    const hashes = inputTxs.map(tx => tx.hash())
    const allEqual = hashes.every(h => h === hashes[0])
    if (!allEqual) {
        throw new Error(
            'Failed to merge: the supplied files contain different transactions'
        )
    }
}

function register(program) {
    program
        .command('merge <file_1> <file_2> [file_N...]')
        .description(
            'Merge several half-signed Multisig transaction files. The input ' +
            'files must be provided via command line arguments (separated by ' +
            'spaces). The signatures must correspond to the same transaction.'
        )
        .option(
            '-o, --output-file <output_file>',
            'Output file to write the merged transaction to'
        )
        .action(withErrors(merge))
}

module.exports = {
    register
}
