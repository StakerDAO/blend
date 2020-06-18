import * as fs from 'fs'
import { promisify } from 'util'
import * as Utils from 'web3-utils'
import { Address, validateType } from './types'

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const { _ } = Utils as any

interface TransactionPayload {
    multisigAddress: Address
    targetAddress: Address
    txValue: number
    txData: string
    nonce: number
}

interface RotateKeysPayload {
    multisigAddress: Address
    newOwners: Address[]
    newThreshold: number | string
    nonce: number | string
}

type ActionType = 'transaction' | 'rotateKeys'
type ActionPayload = RotateKeysPayload | TransactionPayload

interface MultisigActionData {
    action: ActionType
    payload: ActionPayload
    signatures: Record<Address, string>
}

interface Field {
    type: string
    name: string
}

interface FieldValue {
    type: string
    value: string
}

function conformsTo(
    payload: Record<string, any>,
    fields: Field[]
): true | string {
    for (let field of fields) {
        if (field.name in payload) {
            const value = payload[field.name]
            const validationResult = validateType(value, field.type)
            if (validationResult !== true) {
                return (
                    `The supplied action is invalid, field ${field} ` +
                    `is of incorrect type: ${validationResult}`
                )
            }
        } else {
            return `${field.name} does not exist in ${payload}`
        }
    }
    return true
}

function extractFields(
    payload: Record<string, any>,
    fields: Field[]
): FieldValue[] {
    return fields.map((field: Field) => {
        if (field.name in payload) {
            return {
                type: field.type,
                value: payload[field.name]
            }
        } else {
            throw Error(`${field.name} does not exist in ${payload}`)
        }
    })
}

function getFieldsFor(action: ActionType): Field[] {
    const actionSpecs: Record<ActionType, Field[]> = {
        'transaction': [
            { name: 'multisigAddress', type: 'address' },
            { name: 'targetAddress', type: 'address' },
            { name: 'txValue', type: 'uint256' },
            { name: 'txData', type: 'bytes' },
            { name: 'nonce', type: 'uint' },
        ],
        'rotateKeys': [
            { name: 'multisigAddress', type: 'address' },
            { name: 'newOwners', type: 'address[]' },
            { name: 'newThreshold', type: 'uint' },
            { name: 'nonce', type: 'uint' },
        ],
    }
    return actionSpecs[action]
}

function isValidActionType(action: string): action is ActionType {
    return action === 'transaction' || action === 'rotateKeys'
}

function parseMultisigActionData(tx: Record<string, any>): MultisigActionData {
    if (!('action' in tx)) throw Error('Action type is not specified')
    if (!('payload' in tx)) throw Error('Action payload is not specified')

    const action = tx['action']
    if (!isValidActionType(action)) {
        throw Error('Action type is not supported')
    }

    const fields = getFieldsFor(action)
    if (!fields) throw Error()
    const validationResult = conformsTo(tx['payload'], fields)
    if (validationResult !== true) {
        throw Error(validationResult)
    }

    return {
        action,
        payload: tx['payload'] as ActionPayload,
        signatures: tx['signatures'] || {}
    }
}

class MultisigAction {
    action: ActionType
    payload: ActionPayload
    signatures: Record<Address, string>

    constructor(actionData: Record<string, any>) {
        const { action, payload, signatures } =
            parseMultisigActionData(actionData)
        this.action = action
        this.payload = payload
        this.signatures = signatures
    }

    hash() {
        const fields = [
            {type: 'uint8', value: '0x19'},
            {type: 'uint8', value: '0x00'},
            ...extractFields(this.payload, getFieldsFor(this.action))
        ]
        console.log(fields)
        return Utils.soliditySha3(
            ...fields
        )
    }

    addSignature(signer: Address, signature: string) {
        this.signatures[signer] = signature
    }

    static async fromFile(txFile: string) {
        const tx = JSON.parse(await readFile(txFile, {encoding: 'utf-8'}))
        return new MultisigAction(tx)
    }

    async save(fileName: string) {
        const json = JSON.stringify({
            action: this.action,
            payload: this.payload,
            signatures: this.signatures,
        })
        await writeFile(fileName, json, {encoding: 'utf-8'})
    }

    static validate(actionData: Record<string, any>): true | string {
        try {
            parseMultisigActionData(actionData)
            return true
        } catch (e) {
            return e.message
        }
    }

    static async validateFile(txFile: string): Promise<true | string> {
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

        return MultisigAction.validate(tx)
    }
}

export {
    ActionType,
    ActionPayload,
    RotateKeysPayload,
    TransactionPayload,
    MultisigAction
}
