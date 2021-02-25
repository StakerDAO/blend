
// SPDX-FileCopyrightText: 2020 StakerDAO
//
// SPDX-License-Identifier: MPL-2.0

import * as Utils from 'web3-utils'
import { promptAndLoadEnv, promptIfNeeded } from '../../prompt'
import withErrors from '../../utils/withErrors'
import { Address, NetworkName } from '../../types'
import { BlendEnvironment } from '../../utils/environment'
import { ensureAddress } from '../../utils/validators'


interface SwapDeploymentArguments {
    network: NetworkName
    blend: Address
}

type CmdlineOptions = Partial<SwapDeploymentArguments>

async function deploy(
    options: CmdlineOptions
): Promise<void> {
    let blend = options.blend ? options.blend : null
    if (blend && !Utils.isAddress(blend)) {
        throw new Error(`${options.blend} is not a valid Ethereum address`)
    }
    const env = await promptAndLoadEnv({ networkInOpts: options.network })
    if (!blend) {
        try {
            blend = env.getContractAddress('BlendToken')
            console.log(`Using BlendToken at ${blend}`)
        } catch (_) {}
    }
    console.log(blend)
    const questions = makeQuestions()
    const args = await promptIfNeeded({ blend }, questions) as SwapDeploymentArguments

    console.log('Deploying TokenSwap...')
    console.log(args)
    await deployRegularContract(
        env, 'TokenSwap', [args.blend]
    )
    env.updateController()
}

function makeQuestions() {
    return [{
        type: 'input',
        name: 'blend',
        message: 'Address of BlendToken',
        validate: ensureAddress,
    }]
}

async function deployRegularContract(
    env: BlendEnvironment,
    contractName: string,
    args: any
) {
    const nc = env.getNetworkController()

    try {
        const instance = await nc.createInstance(
            'staker-blend', contractName, args
        )
        return instance.address
    } finally {
        nc.writeNetworkPackageIfNeeded()
    }
}

function register(program: any) {
    program
        .command('swap-deploy')
        .usage('swap-deploy')
        .description(
            'Deploy TokenSwap contract.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .option('--blend <blend_address>', 'BlendToken address')
        .action(withErrors(deploy))
}

export { register }
