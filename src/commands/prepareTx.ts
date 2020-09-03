import { Contract } from '@openzeppelin/upgrades'
import validFilename from 'valid-filename'
import { promptAndLoadEnv, promptIfNeeded } from '../prompt'
import { MultisigAction } from '../multisig'
import withErrors from '../utils/withErrors'
import { NetworkName, ContractName, Address, validateType } from '../types'
import inquirer = require('inquirer')


interface ContractMethodDecsription {
    name: string
    friendlyName: string
}

function getManagementMethods(
    c: ContractName
): ContractMethodDecsription[] {
    const ownable = [
        { name: 'transferOwnership', friendlyName: 'Transfer ownership' },
        { name: 'acceptOwnership',   friendlyName: 'Accept ownership'   },
    ]
    const erc20 = [
        { name: 'transfer',          friendlyName: 'Transfer your tokens'      },
        { name: 'transferFrom',      friendlyName: 'Transfer someone’s tokens' },
        { name: 'increaseAllowance', friendlyName: 'Increase allowance'   },
        { name: 'decreaseAllowance', friendlyName: 'Decrease allowance'   },
        { name: 'approve',           friendlyName: 'Approve (deprecated)' },
    ]
    const methods = {
        'Orchestrator': [
            ...ownable,
            {
                name: 'collectBlend',
                friendlyName: 'Collect BLEND tokens (fee) from Orchestrator'
            },
            {
                name: 'setDistributionBackend',
                friendlyName: 'Set distribution backend address'
            },
            {
                name: 'setUsdcPool',
                friendlyName: 'Set USDC pool address'
            },
        ],
        'Registry': [
            ...ownable,
            {
                name: 'setFeePerAddress',
                friendlyName: 'Set distribution fee per address'
            },
            {
                name: 'setRegistryBackend',
                friendlyName: 'Set registry backend'
            },
        ],
        'BlendToken': [
            ...ownable,
            ...erc20,
            { name: 'setOrchestrator', friendlyName: 'Set Orchestrator address' },
            { name: 'setRegistry',     friendlyName: 'Set Registry address'     },
        ],
    }
    return methods[c]
}

interface X {
    contract: ContractName
    address: Address
    method: string
    arguments: string[]
}

interface Field {
    name: string
    type: string
}

function getMethodInputs(c: Contract, methodName: string): Field[] {
    const contractName = c.schema.contractName
    if (!isKnownContract(contractName)) {
        throw Error(`${contractName} is not a known contract`)
    }
    const methods = c.schema.abi.filter(v => v.name == methodName)
    if (methods.length !== 1) {
        throw Error(`${methodName} method is not unique`)
    }
    return methods[0].inputs
}

function getContractNames(): ContractName[] {
    return ['Orchestrator', 'Registry', 'BlendToken']
}

function isKnownContract(name: string): name is ContractName {
    return (getContractNames() as string[]).includes(name)
}

interface PrepareTransactionArguments {
    network: NetworkName
    contractName: string
    methodName: string
    outputFile: string
}

async function prepareTransaction(options: Partial<PrepareTransactionArguments>) {
    const env = await promptAndLoadEnv({networkInOpts: options.network})
    const { outputFile } = await promptIfNeeded(options, [
        {
            type: 'input',
            name: 'outputFile',
            message: 'File to write the prepared transaction to',
            validate: async (outputFile: string) =>
                validFilename(outputFile) ||
                `${outputFile} is not a valid file name`,
        }
    ]) as { outputFile: string }

    const { contractName } = await promptIfNeeded(options, [
        {
            type: 'list',
            name: 'contractName',
            message: 'Pick a contract',
            choices: getContractNames()
        }
    ]) as { contractName: ContractName }
    const contract = env.getContract(contractName)

    const methodChoices = getManagementMethods(contractName).map(
        (method: ContractMethodDecsription) => {
            return { name: method.friendlyName, value: method.name }
        }
    )
    let { methodName } = await promptIfNeeded(options, [
        {
            type: 'list',
            name: 'methodName',
            message: 'Choose a method to call',
            choices: [...methodChoices, { name: 'Other', value: 'other' }]
        }
    ]) as { methodName: string }

    if (methodName == 'other') {
        const answer = await promptIfNeeded(options, [
            {
                type: 'input',
                name: 'methodName',
                message: 'Choose a method to call',
                validate: (v: string) => typeof getMethodInputs(contract, v) === 'object'
            }
        ]) as { methodName: string }
        methodName = answer.methodName
    }

    const inputs = getMethodInputs(contract, methodName)
    const callArgQuestions = inputs.map((field: Field) => {
        return {
            type: 'input',
            name: field.name,
            message: `${field.name} (${field.type})`,
            validate: (v: any) => validateType(v, field.type)
        }
    })
    const answers = await inquirer.prompt(callArgQuestions)
    const callArgs = inputs.map((field: Field) => {
        return answers[field.name]
    })

    const txData =
        contract.methods[methodName](...callArgs).encodeABI({ from: env.from })

    const msig = env.getContract('Multisig')
    console.log('Multisig: ', msig.address)
    const nonce = await msig.methods.nonce().call()
    console.log('Nonce: ', nonce)
    console.log('Threshold: ', await msig.methods.threshold().call())
    console.log('Owners[0]: ', await msig.methods.owners(0).call())
    const msigTx = new MultisigAction({
        action: 'transaction',
        payload: {
            multisigAddress: msig.address,
            targetAddress: contract.address,
            txValue: 0,
            txData,
            nonce
        }
    })
    await msigTx.save(outputFile)
}

function register(program: any) {
    program
        .command('prepare-tx')
        .description(
            /*'Push the new implementation of BlendToken to chain and prepare ' +
            'a transaction that upgrades the proxy to the new implementation. ' +
            'Use `sign`, `merge` and `submit` subcommands with the generated ' +
            'transaction file to actually upgrade the proxy.'*/ ''
        )
        .option('-n, --network <network_name>', 'network to use')
        .option(
            '-o, --output-file <output_file>',
            'Output file to write the generated transaction to'
        )
        .action(withErrors(prepareTransaction))
}

module.exports = { register }
