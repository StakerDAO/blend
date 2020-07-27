import { Contract } from '@openzeppelin/upgrades'
import { BlendEnvironment } from '../utils/environment'
import { promptAndLoadEnv } from '../prompt'
import withErrors from '../utils/withErrors'
import { NetworkName } from '../types'


async function getOwners(msig: Contract) {
    let owners = []
    for (let i = 0; ; i++) {
        try {
            owners.push(await msig.methods.owners(i).call())
        } catch (_) {
            break
        }
    }
    return owners
}

async function getContractOrFail(env: BlendEnvironment, contractName: string) {
    try {
        return await env.getContract(contractName)
    } catch (err) {
        console.log(
            'No deployed instance of BLEND found or a network error occurred'
        )
        throw err
    }
}

async function printMultisigInfo(env: BlendEnvironment) {
    const msig = await getContractOrFail(env, 'Multisig')
    console.log('Multisig: ')
    await printContractInfo(msig, ['threshold', 'nonce'])

    const owners = await getOwners(msig)
    console.log('  owners:')
    for (const owner of owners) {
        console.log(`    - ${owner}`)
    }
}

async function printTokenInfo(env: BlendEnvironment) {
    const blend = await getContractOrFail(env, 'BlendToken')
    console.log('Blend token: ')
    await printContractInfo(blend, [
        'name', 'symbol', 'decimals', 'owner', 'pendingOwner',
        'orchestrator', 'registry', 'distributionPhase'
    ])
}

async function printOrchestratorInfo(env: BlendEnvironment) {
    const orchestrator = await getContractOrFail(env, 'Orchestrator')
    console.log('Orchestrator: ')
    await printContractInfo(orchestrator, [
        'PRICE_MULTIPLIER', 'blend', 'distributionBackend',
        'owner', 'pendingOwner', 'registry', 'usdc', 'usdcPool'
    ])
}

async function printRegistryInfo(env: BlendEnvironment) {
    const registry = await getContractOrFail(env, 'Registry')
    console.log('Registry: ')
    await printContractInfo(registry, [
        'blend', 'feePerAddress', 'owner', 'pendingOwner', 'registryBackend'
    ])
}

async function printContractInfo(contract: Contract, fields: string[]) {
    console.log(`  address:  ${contract.address}`)
    for (const field of fields) {
        const value = await contract.methods[`${field}()`]().call()
        console.log(`  ${field}: ${value}`)
    }
}

async function info(options: { network?: NetworkName }) {
    const blendEnv = await promptAndLoadEnv({networkInOpts: options.network})
    await printMultisigInfo(blendEnv)
    console.log('')
    await printTokenInfo(blendEnv)
    console.log('')
    await printOrchestratorInfo(blendEnv)
    console.log('')
    await printRegistryInfo(blendEnv)
}

function register(program: any) {
    program
        .command('info')
        .description(
            'Prints the information about deployed contract instances.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .action(withErrors(info))
}

export { register }
