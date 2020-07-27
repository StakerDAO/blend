import * as oz from '@openzeppelin/cli'
import validFilename from 'valid-filename'
import { promptAndLoadEnv, promptIfNeeded } from '../prompt'
import { MultisigAction } from '../multisig'
import withErrors from '../utils/withErrors'
import * as ProxyAbi from '../assets/AdminUpgradeabilityProxy.abi.json'
import { BlendEnvironment } from '../utils/environment'
import { Address, NetworkName, ContractName } from '../types'


interface UpgradeArguments {
    network: NetworkName
    contractName: ContractName
    outputFile: string
}

async function pushNextVersion(
    env: BlendEnvironment,
    contractName: ContractName
): Promise<Address> {
    oz.scripts.add({
        contractsData: [{ name: contractName, alias: contractName }]
    })
    await oz.scripts.push({
        reupload: true, deployDependencies: true, ...env.ozOptions
    })

    const newAddress = env.getImplementation(contractName).address
    console.log(
        `\nNew implementation address: ${newAddress}. \n`
    )
    return newAddress
}

async function upgrade(options: Partial<UpgradeArguments>) {
    const env = await promptAndLoadEnv({networkInOpts: options.network})
    const args = await promptIfNeeded(options, [
        {
            type: 'input',
            name: 'outputFile',
            message: 'File to write the prepared transaction to',
            validate: async (outputFile: string) =>
                validFilename(outputFile) ||
                `${outputFile} is not a valid file name`,
        },
        {
            type: 'input',
            name: 'contractName',
            message: 'Choose a contract to upgrade',
            choices: ['BlendToken', 'Orchestrator'],
        },
    ]) as UpgradeArguments
    console.log('Publishing the new implementation')
    const nextImpl = await pushNextVersion(env, args.contractName)
    console.log(nextImpl)
    const proxy = env.getContractAddress(args.contractName)
    const proxyAdmin = {} as any  // env.getProxyAdmin()
    console.log('From: ', env.from)
    const tx = proxyAdmin.methods.upgrade(proxy, nextImpl).encodeABI({
        from: env.from
    })
    console.log('Tx: ', tx)
    const msig = env.getContract('Multisig')
    console.log('Multisig: ', msig.address)
    const nonce = (await msig.methods.nonce().call()).toNumber()
    console.log('Nonce: ', nonce)
    const msigTx = new MultisigAction({
        action: 'upgrade',
        payload: {
            multisigAddress: msig.address,
            targetAddress: proxyAdmin.address,
            txValue: 0,
            txData: tx,
            nonce
        }
    })
    await msigTx.save(args.outputFile)
}

function register(program: any) {
    program
        .command('upgrade')
        .description(
            'Push the new implementation of BlendToken or Registry to chain ' +
            'and prepare a transaction that upgrades the proxy to the new ' +
            'implementation. Use `sign`, `merge` and `submit` subcommands ' +
            'with the generated transaction file to actually upgrade the ' +
            'proxy.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--contract <contract_name>', 'contract to upgrade')
        .option(
            '-o, --output-file <output_file>',
            'Output file to write the generated transaction to'
        )
        .action(withErrors(upgrade))
}

module.exports = { register }
