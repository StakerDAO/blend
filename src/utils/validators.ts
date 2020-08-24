import { isAddress } from 'web3-utils'
import { Address } from '../types'


async function ensureAddress(address: Address) {
    return isAddress(address) ||
           `${address} is not a valid Ethereum address`
}

export { ensureAddress }
