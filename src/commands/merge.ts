import validFilename from 'valid-filename'
import { promptIfNeeded } from '../prompt'
import { MultisigAction } from '../multisig'
import withErrors from '../utils/withErrors'
import { NetworkName } from '../types'


interface MergeArguments {
    network: NetworkName
    outputFile: string
}

async function merge(
    inputFile1: string,
    inputFile2: string,
    otherInputs: string[],
    options: Partial<MergeArguments>
) {
    const inputFiles = [inputFile1, inputFile2, ...otherInputs]
    const inputTxs = await Promise.all(
        inputFiles.map(file => MultisigAction.fromFile(file))
    )
    checkAllEqual(inputTxs)

    const questions = [{
        type: 'input',
        name: 'outputFile',
        message: 'File to write the merged transaction to',
        validate: async (outputFile: string) =>
            validFilename(outputFile) ||
            `${outputFile} is not a valid file name`,
    }]
    const args = await promptIfNeeded(options, questions) as MergeArguments

    const mergedTx = new MultisigAction({
        action: inputTxs[0].action,
        payload: inputTxs[0].payload,
        signatures: inputTxs.reduce((acc, tx) => {
            return { ...acc, ...tx.signatures }
        }, {})
    })

    await mergedTx.save(args.outputFile)
}

function checkAllEqual(inputTxs: MultisigAction[]) {
    const hashes = inputTxs.map((tx: MultisigAction) => tx.hash())
    const allEqual = hashes.every((h: string) => h === hashes[0])
    if (!allEqual) {
        throw new Error(
            'Failed to merge: the supplied files contain different transactions'
        )
    }
}

function register(program: any) {
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

export {
    register
}
