const { promptAndLoadEnv } = require('../prompt')
const withErrors = require('../utils/withErrors')


async function getOwners(msig) {
    let owners = []
    for (let i = 0; ; i++) {
        try {
            owners.push(await msig.owners(i))
        } catch (_) {
            break
        }
    }
    return owners
}


async function info(options) {
    const blendEnv = await promptAndLoadEnv({networkInOpts: options.network})
    try {
        const msig = await blendEnv.getContract('Multisig')
        const owners = await getOwners(msig)
        const threshold = await msig.threshold()
        console.log('Multisig: ')
        console.log(`  address:  ${msig.address}`)
        console.log(`  owners:`)
        for (const owner of owners) {
            console.log(`    - ${owner}`)
        }
        console.log(`  threshold: ${threshold}`)
    } catch (err) {
        console.log(
            'No deployed instance of multisig found or a network error occurred'
        )
        console.error(err)
    }

    console.log('')
    try {
        const blend = await blendEnv.getContract('BlendToken')
        const name = await blend.name()
        const symbol = await blend.symbol()
        const decimals = await blend.decimals()
        const totalSupply = await blend.totalSupply()
        console.log('Blend token: ')
        console.log(`  address:  ${blend.address}`)
        console.log(`  name:     ${name}`)
        console.log(`  symbol:   ${symbol}`)
        console.log(`  decimals: ${decimals}`)
        console.log(`  supply:   ${totalSupply}`)
    } catch (err) {
        console.log(
            'No deployed instance of BLEND found or a network error occurred'
        )
        console.error(err)
    }
}

function register(program) {
    program
        .command('info')
        .description(
            'Prints the information about deployed contract instances.'
        )
        .option('-n, --network <network_name>', 'network to use')
        .action(withErrors(info))
}

module.exports = { register }
