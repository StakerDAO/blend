const inquirer = require('inquirer')
const { PathPrompt } = require('inquirer-path')
const { getNetworks, loadProjectEnv } = require('./utils/environment')

inquirer.registerPrompt('file-tree-selection', PathPrompt)

async function promptForNetwork({ networkInOpts }) {
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

async function promptAndLoadEnv({ networkInOpts }) {
    const network = await promptForNetwork({ networkInOpts })
    return await loadProjectEnv({ network })
}

async function promptIfNeeded(options, questions) {
    promptFor =
        questions
            .filter(({ name }) => !options[name] && (options[name] !== false))
            .filter(async ({ name, validate }) => {
                if (!validate) return true
                return await validate(options[name]) !== true
            })
    const answers = await inquirer.prompt(promptFor)
    return { ...options, ...answers }
}

module.exports = {
    inquirer,
    promptAndLoadEnv,
    promptIfNeeded,
}
