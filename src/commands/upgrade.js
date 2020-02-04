const fs = require('fs')
const { promisify } = require('util')
const Oz = require('@openzeppelin/cli')
const validFilename = require('valid-filename')
const { promptAndLoadEnv, promptIfNeeded } = require('../prompt')
const { MultisigTx } = require('../multisig')
const withErrors = require('../utils/withErrors')
const ProxyAbi = require('../assets/AdminUpgradeabilityProxy.abi.json')


async function pushNextVersion(blendEnv) {
    const oz = Oz.scripts
    oz.add({ contractsData: [{ name: 'BlendToken', alias: 'BlendToken' }] })
    await oz.push({ reupload: true, deployDependencies: true, ...blendEnv.ozOptions })

    const networkFile = blendEnv.getNetworkController().networkFile
    const newAddress = networkFile.contracts['BlendToken'].address
    console.log(
        `\nNew implementation address: ${newAddress}. \n`
    )
    return newAddress
}

function mkQuestions() {
    return [
        {
            type: 'input',
            name: 'outputFile',
            message: 'File to write the prepared transaction to',
            validate: async outputFile =>
                validFilename(outputFile) ||
                `${outputFile} is not a valid file name`,
        }
    ]
}

async function upgrade(options) {
    const blendEnv = await promptAndLoadEnv({networkInOpts: options.network})
    const args = await promptIfNeeded(options, mkQuestions())
    console.log('Publishing the new implementation')
    const nextImpl = await pushNextVersion(blendEnv)
    console.log(nextImpl)
    const blend = await blendEnv.getContract('BlendToken')
    const proxy = new blendEnv.web3.eth.Contract(ProxyAbi, blend.address)
    const from = blendEnv.from
    console.log('From: ', from)
    const tx = proxy.methods.upgradeTo(nextImpl).encodeABI({ from: from })
    console.log('Tx: ', tx)
    const msig = await blendEnv.getContract('Multisig')
    console.log('Multisig: ', msig.address)
    const nonce = (await msig.nonce()).toNumber()
    console.log('Nonce: ', nonce)
    const msigTx = new MultisigTx({
        action: 'upgrade',
        payload: {
            multisigAddress: msig.address,
            targetAddress: blend.address,
            txValue: 0,
            txData: tx,
            nonce
        }
    })
    await msigTx.save(args.outputFile)
}

function register(program) {
    program
        .command('upgrade')
        .description(
            'Push the new implementation of BlendToken to chain and prepare ' +
            'a transaction that upgrades the proxy to the new implementation. ' +
            'Use `sign`, `merge` and `submit` subcommands with the generated ' +
            'transaction file to actually upgrade the proxy.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option(
            '-o, --output-file <output_file>',
            'Output file to write the merged transaction to'
        )
        .action(withErrors(upgrade))
}

module.exports = { register }
