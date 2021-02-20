import * as fs from 'fs'
import { promisify } from 'util'
import * as Utils from 'web3-utils'
import { promptAndLoadEnv, promptIfNeeded } from '../prompt'
import withErrors from '../utils/withErrors'
import { Address, NetworkName, ContractName, BN, validateType } from '../types'

const readFile = promisify(fs.readFile)


interface TenderBatchArguments {
    network: NetworkName
    from: Address
    registry: Address
    file: string
    gasPrice: BN
}

async function readAddressesFrom(file: string) {
    const batch =
        (await readFile(file))
            .toString()
            .split('\n')
            .map(s => s.trim())
            .filter(s => s !== '')
    for (let addr of batch) {
        if (validateType(addr, 'address') !== true) {
            throw new Error(`${addr} is not a valid Ethereum address`)
        }
    }
    console.log(`Batch: ${batch}`)
    return batch
}

async function registerTenderAddressBatch(
    options: Partial<TenderBatchArguments>
) {
    const env = await promptAndLoadEnv({networkInOpts: options.network})
    const existingAccounts = await env.web3.eth.getAccounts()
    let registryAddr = null
    try {
        env.getContractAddress('Registry')
    } catch (_) { }
    const args = await promptIfNeeded(options, [
        {
            type: 'list',
            name: 'from',
            message: 'Send the tx from (should be "registry backend" address)',
            choices: existingAccounts,
            validate:
                async (address: Address) => existingAccounts.includes(address),
        },
        {
            type: 'input',
            name: 'registry',
            message: 'Address of the registry contract',
            default: registryAddr,
            validate:
                async (addr: string) => validateType(addr, 'address'),
        },
        {
            type: 'file-tree-selection',
            name: 'file',
            message: 'File with tender addresses to register',
        },
        {
            type: 'number',
            name: 'gasPrice',
            message: 'Gas price (in GWei)',
            default: Utils.fromWei(env.txParams.gasPrice.toString(), 'gwei')
        },
    ]) as TenderBatchArguments

    const registry = env.getContract('Registry', args.registry)
    const batch = await readAddressesFrom(args.file)
    await registry.methods
            .registerTenderAddressBatch(batch)
            .send({
                from: args.from,
                gasPrice: Utils.toWei(args.gasPrice, 'gwei')
            })
}

function register(program: any) {
    program
        .command('tender-batch')
        .description(
            'Register several tender addresses in batch.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option(
            '--from <address>',
            'address from which you send the transaction'
        )
        .option(
            '--registry <address>',
            'the address of the registry contract'
        )
        .option(
            '--file <output_file>',
            'the file to read the tender addresses from'
        )
        .action(withErrors(registerTenderAddressBatch))
}

module.exports = { register }
