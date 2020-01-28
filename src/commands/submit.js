const fs = require('fs')
const { promisify } = require('util')
const readFile = promisify(fs.readFile)
const { promptAndLoadEnv, promptIfNeeded } = require('../prompt')
const { MultisigTx } = require('../multisig')
const withErrors = require('../utils/withErrors')


const caseInsensitiveCompare = (lhs, rhs) => {
    return lhs.localeCompare(rhs, 'en', {sensitivity: 'base'})
}

async function upgrade(blendEnv, tx) {
    const { payload } = tx
    const msig =
        await blendEnv.getContract('Multisig', payload.multisigAddress)

    // The contract expects signatures to be provided in author-ascending
    // order, hence we sort signatures by authors here
    const signatures =
        Object.keys(tx.signatures)
        .sort(caseInsensitiveCompare)
        .map(addr => fixSignature(tx.signatures[addr]))

    try {
        const gas = await msig.execute(
            payload.targetAddress,
            payload.txValue,
            payload.txData,
            signatures,
            { from: blendEnv.from }
        )
        console.log('Gas required: ', gas)
    } catch (err) {
        console.error(err)
    }
}

async function makeQuestions(blendEnv) {
    const existingAccounts = await blendEnv.web3.eth.getAccounts()
    return [
        {
            type: 'file-tree-selection',
            name: 'inputFile',
            message: 'Transaction to send (JSON file)',
            validate: MultisigTx.validateFile,
            cwd: process.cwd(),
        },
    ]
}

function fixSignature(signature) {
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

async function submit(inputFile, options) {
    options.inputFile = inputFile
    const blendEnv = await promptAndLoadEnv({networkInOpts: options.network})
    const questions = await makeQuestions(blendEnv)
    const args = await promptIfNeeded(options, questions)
    const tx = await MultisigTx.fromFile(args.inputFile)
    if (tx.action == 'upgrade') {
        await upgrade(blendEnv, tx, args.from)
    }
}

function register(program) {
    program
        .command('submit [input_file]')
        .description(
            'Sign a Multisig transaction JSON file. Writes the signed ' +
            'transaction to the specified output file.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .action(withErrors(submit))
}

module.exports = { register }
