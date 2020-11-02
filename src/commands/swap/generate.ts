import { randomBytes, createHash } from 'crypto'
import { hexToBytes } from 'web3-utils'
import withErrors from '../../utils/withErrors'

function sha256(payload: string) {
    const data = Buffer.from(hexToBytes(payload))
    const hash = createHash('sha256')
    hash.update(data)
    return `0x${ hash.digest('hex') }`
}

function generate() {
    const secret = '0x' + randomBytes(32).toString('hex')
    const secretHash = sha256(secret)

    console.log({
        secret, secretHash
    })
}

function register(program: any) {
    program
        .command('swap-generate')
        .usage('swap-generate')
        .description(
            'Generate a secret and secret hash'
        )
        .action(withErrors(generate))
}

export { register }
