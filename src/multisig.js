const fs = require('fs')
const { promisify } = require('util')
const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const Utils = require('web3-utils')
const { _ } = Utils

class MultisigTx {
    constructor({ action, payload, signatures }) {
        const validationResult =
            MultisigTx.validate({ action, payload })
        if (validationResult !== true) {
            throw new Error(validationResult)
        }
        this.action = action
        this.payload = payload
        this.signatures = signatures || {}
    }

    hash() {
        return Utils.soliditySha3(
            {type: 'uint8', value: '0x19'},
            {type: 'uint8', value: '0x00'},
            ...this._extractFields()
        )
    }

    addSignature(signer, signature) {
        this.signatures[signer] = signature
    }

    _extractFields() {
        const actionSpec = actionSpecs[this.action]
        return _.map(actionSpec.fields, field => {
            return { type: field.type, value: this.payload[field.name] }
        })
    }

    static async fromFile(txFile) {
        const tx = JSON.parse(await readFile(txFile, {encoding: 'utf-8'}))
        return new MultisigTx(tx)
    }

    async save(fileName) {
        const json = JSON.stringify({
            action: this.action,
            payload: this.payload,
            signatures: this.signatures,
        })
        await writeFile(fileName, json, {encoding: 'utf-8'})
    }

    static validate({ action, payload }) {
        if (_.isUndefined(action)) return 'Action type is not specified'
        if (_.isUndefined(payload)) return 'Action payload is not specified'
        const actionSpec = actionSpecs[action]
        if (_.isUndefined(actionSpec)) return 'Action type is not supported'

        for (const field of actionSpec.fields) {
            const value = payload[field.name]
            const validationResult = validateType(value, field.type)
            if (validationResult !== true) {
                return `The supplied ${action} action is invalid, field ${field} ` +
                       `is of incorrect type: ${validationResult}`
            }
        }
        return true
    }

    static async validateFile(txFile) {
        let json = null
        try {
            json = await readFile(txFile, {'encoding': 'utf-8'})
        } catch (_) {
            return `Could not read the supplied file ${txFile}`
        }

        let tx = null
        try {
            tx = JSON.parse(json)
        } catch (_) {
            return `Could not parse the file "${txFile}" as JSON`
        }

        return MultisigTx.validate(tx)
    }
}

const actionSpecs = {
    'upgrade': {
        fields: [
            { name: 'multisigAddress', type: 'address' },
            { name: 'targetAddress', type: 'address' },
            { name: 'txValue', type: 'uint256' },
            { name: 'txData', type: 'bytes' },
            { name: 'nonce', type: 'uint' },
        ],
    },
    'rotateKeys': {
        fields: [
            { name: 'multisigAddress', type: 'address' },
            { name: 'newOwners', type: 'address[]' },
            { name: 'newThreshold', type: 'uint' },
            { name: 'nonce', type: 'uint' },
        ],
    }
}

function isUint(input, bitWidth) {
    try {
        const n = Utils.toBN(input)
        const overflow = Utils.toBN(1).iushln(bitWidth)
        return n.lt(overflow)
    } catch (_) {
        return false
    }
}

function validateType(value, type) {
    const isValid = {
        'address': Utils.isAddress,
        'uint256': v => isUint(v, 256),
        'uint': v => isUint(v, 32),
        'bytes': Utils.isHexStrict,
        'address[]': list => _.every(list, Utils.isAddress),
    }
    return isValid[type](value)
               ? true
               : `${value} is not a valid value of type ${type}`
}

module.exports = {
    MultisigTx
}
