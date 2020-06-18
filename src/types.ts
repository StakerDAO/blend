import * as Utils from 'web3-utils'

const { _ } = Utils as any

type Address = string
type NetworkName = string
type BN = string

type ContractName
    = 'Orchestrator'
    | 'Registry'
    | 'BlendToken'

function isUint(input: any, bitWidth: number) {
    if (typeof input !== 'string' && typeof input !== 'number') return false
    try {
        const n = Utils.toBN(input)
        const overflow = Utils.toBN(1).iushln(bitWidth)
        return n.lt(overflow)
    } catch (_) {
        return false
    }
}

function validateType(value: any, type: string): true | string {
    const isValid: Record<string, (v: any) => boolean> = {
        'address': (v: any) => (typeof v === 'string') && Utils.isAddress(v),
        'uint256': (v: any) => isUint(v, 256),
        'uint': (v: any) => isUint(v, 32),
        'bytes': (v: any) => (typeof v === 'string') && Utils.isHexStrict(v),
        'address[]': (v: any) => {
            if (!Array.isArray(v)) return false
            return _.every(v, (addr: any) => {
                return typeof addr === 'string' && Utils.isAddress(addr)
            })
        },
    }
    if (type in isValid) {
        const validate = isValid[type]
        return validate(value)
               ? true
               : `${value} is not a valid value of type ${type}`
    }
    return `Logic error: ${type} is not a known type`
}

export {
    Address,
    BN,
    NetworkName,
    ContractName,
    validateType
}
