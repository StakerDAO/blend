const assert = require('assert')

const isRevert = error => {
    const REVERT_MSGS = [
        'Returned error: VM Exception while processing transaction: revert',
        'Returned error: execution error: revert',
        'Returned error: VM Exception while processing transaction: invalid opcode'
    ]
    return REVERT_MSGS.some(msg => error.message.startsWith(msg))
}

module.exports = {
    isRevert: isRevert,
    ignoreRevert: async promise => {
        try {
            return await promise
        } catch (error) {
            if (!isRevert(error)) {
                throw error
            }
        }
    },
    assertRevert: async (promise, expectedReason) => {
        try {
            await promise
        } catch (error) {
            assert(
                isRevert(error),
                `Expected "revert", got ${error} instead`
            )
            assert.equal(
                error.reason, expectedReason,
                "The transaction failed with unexpected reason"
            )

            return
        }
        assert.fail('Expected revert not received')
    },

    fixSignature: signature => {
        // in geth its always 27/28, in ganache its 0/1. Change to 27/28 to prevent
        // signature malleability if version is 0/1
        // see https://github.com/ethereum/go-ethereum/blob/v1.8.23/internal/ethapi/api.go#L465
        let v = parseInt(signature.slice(130, 132), 16);
        if (v < 27) {
            v += 27;
        }
        const vHex = v.toString(16);
        return signature.slice(0, 130) + vHex;
    },

    expectConsumerStorage: async (consumer, fields) => {
        for (const [fieldName, expectedValue] of Object.entries(fields)) {
            const actualValue = await consumer.contract.methods[fieldName]().call()
            assert.equal(
                actualValue, expectedValue,
                `Field ${fieldName} has unexpected value`
            )
        }
    },
}
