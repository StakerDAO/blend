import * as inquirer from 'inquirer'
import { PathPrompt } from 'inquirer-path'
import { getNetworks, loadProjectEnv, BlendEnvironment } from './utils/environment'
import { NetworkName } from './types'

inquirer.registerPrompt('file-tree-selection', PathPrompt)

async function promptForNetwork(
    { networkInOpts }: { networkInOpts?: NetworkName}
): Promise<NetworkName> {
    const availableNetworks = getNetworks()
    if (networkInOpts) {
        if (availableNetworks.includes(networkInOpts)) {
            return networkInOpts
        } else {
            console.log(
                'The supplied network does not exist in `truffle-config.js`. ' +
                'Please pick a configured network from the list.'
            )
        }
    }
    const answers = await inquirer.prompt([{
        type: 'list',
        name: 'network',
        message: 'Pick a network',
        choices: getNetworks(),
    }])
    return answers.network
}

async function promptAndLoadEnv(
    { networkInOpts }: { networkInOpts?: NetworkName}
): Promise<BlendEnvironment> {
    const network = await promptForNetwork({ networkInOpts })
    return await loadProjectEnv({ network })
}

async function promptIfNeeded(
    options: Record<string, any>,
    questions: any[]
): Promise<Record<string, any>> {
    const promptFor =
        questions.filter(async q => {
            if (!('name' in q)) return false
            const name = q.name

            if (!name) return false
            if (options[name] === false) return false
            if (!options[name]) return false

            if ('validate' in q && q.validate) {
                if (await q.validate(options[name]) !== true) {
                    return false
                }
            }
            if ('choices' in q && Array.isArray(q.choices)) {
                let choices = q.choices
                if (typeof choices === 'object') {
                    choices = choices.map((v: {value: string}) => v.value)
                }
                if (!choices.includes(options[name])) {
                    return false
                }
            }
            return true
        })
    const answers = await inquirer.prompt(promptFor)
    return { ...options, ...answers as object }
}

export {
    inquirer,
    promptAndLoadEnv,
    promptIfNeeded,
}
