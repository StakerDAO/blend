const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, constants } = require('@openzeppelin/test-helpers')
const assert = require('assert')
const Multisig = contract.fromArtifact('Multisig')
const Consumer = contract.fromArtifact('Consumer')
const {
    fixSignature, expectConsumerStorage
} = require('./common/helpers')

const caseInsensitiveCompare = (lhs, rhs) => {
    return lhs.localeCompare(rhs, 'en', {sensitivity: 'base'})
}

function signaturesToList(signatures) {
    return Object.keys(signatures)
                .sort(caseInsensitiveCompare)
                .map(addr => fixSignature(signatures[addr]))
}

async function signHash(txHash, signers) {
    return signers.reduce(async (signatures, addr) => {
        return {
            [addr]: await web3.eth.sign(txHash, addr),
            ...await signatures
        }
    }, {})
}

async function signRotateKeysTx(tx, signers) {
    const txHash = web3.utils.soliditySha3(
        {type: 'uint8', value: '0x19'},
        {type: 'uint8', value: '0x00'},
        {type: 'address', value: tx.msigAddress},
        {type: 'address[]', value: tx.newOwners},
        {type: 'uint256', value: tx.threshold},
        {type: 'uint', value: tx.nonce}
    )
    return await signHash(txHash, signers)
}

async function rotateKeys(tx, signaturesList, from) {
    return await tx.msig.rotateKeys.sendTransaction(
        tx.newOwners,
        tx.threshold,
        signaturesList,
        { from, gas: 1000000 }
    )
}

async function signExecuteTx(tx, signers) {
    const txHash = web3.utils.soliditySha3(
        {type: 'uint8', value: '0x19'},
        {type: 'uint8', value: '0x00'},
        {type: 'address', value: tx.msigAddress},
        {type: 'address', value: tx.targetContract},
        {type: 'uint256', value: tx.value},
        {type: 'bytes', value: tx.data},
        {type: 'uint', value: tx.nonce}
    )
    return await signHash(txHash, signers)
}

async function msigExecute(tx, signaturesList, from) {
    return await tx.msig.execute.sendTransaction(
        tx.targetContract,
        tx.value,
        tx.data,
        signaturesList,
        { from, gas: 1000000 }
    )
}

function splitAccounts() {
    assert(
        accounts.length >= 9,
        'Running multisig tests require at least 9 active accounts'
    )

    const a = accounts.slice(0, 9).sort(caseInsensitiveCompare)
    const evil1 = a.splice(0, 1)[0]  // start
    const evil2 = a.splice(3, 1)[0]  // owners middle
    const evil3 = a.splice(-1, 1)[0] // end
    return {
        evils: [evil1, evil2, evil3],
        owners: a.slice(0, 5),
        newOwners: a.slice(1),
    }
}

describe('Multisig', function() {
    // We want to test evil keys at different positions but since the signers
    // are sorted before calling multisig, we need evil keys to be in different
    // positions _lexicographically_. We first fetch the evil keys, and then
    // use the remaining ones as multisig owners/newOwners.
    const { evils, owners, newOwners } = splitAccounts()
    const from = accounts[0]

    describe('rotateKeys', async function() {
        const context = {}

        beforeEach(async function() {
            context.msig = await Multisig.new(owners, 2, { from })
        })

        function getValidTx(context) {
            return {
                msig: context.msig,
                msigAddress: context.msig.address,
                newOwners,
                threshold: 2,
                nonce: 0,
            }
        }

        failuresSpec.call(this, context, {
            makeTx: getValidTx,
            signTx: signRotateKeysTx,
            execTx: rotateKeys,
        })

        it('changes owner set if everything is correct', async () => {
            const tx = getValidTx(context)
            const signatures = await signRotateKeysTx(tx, owners)
            await rotateKeys(tx, signaturesToList(signatures), from)
            // Check that each owner from `newOwners` is listed and is in
            // the correct position:
            for (let i = 0; i < newOwners.length; ++i) {
                const owner = await context.msig.owners.call(i)
                assert.equal(
                    owner,
                    newOwners[i],
                    `Expected owner ${i} to be ${newOwners[i]} but got ${owner}`
                )
            }
            // Check that there are no more owners except `newOwners`:
            await expectRevert(
                context.msig.owners.call(newOwners.length),
                'invalid opcode'
            )
        })
    })

    describe('call', async () => {
        const context = {}

        beforeEach(async function() {
            context.msig = await Multisig.new(owners, 2, { from })
            context.consumer = await Consumer.new({ from })
            const cp = {
                lastFixedBytes: '0x0123456789abcdeffedcba',
                lastVarBytes: '0x2019deadbeef2020',
                lastUint: 123456789,
                lastString: 'Hello world'
            }
            context.updateDataTxEncoded =
                context.consumer.contract.methods.updateData(
                    cp.lastFixedBytes, cp.lastVarBytes,
                    cp.lastUint, cp.lastString
                ).encodeABI()
            context.expectedConsumerStorage = cp
        })

        function getValidTx(context) {
            return {
                msig: context.msig,
                msigAddress: context.msig.address,
                value: '0',
                targetContract: context.consumer.address,
                data: context.updateDataTxEncoded,
                nonce: 0,
            }
        }

        failuresSpec.call(this, context, {
            makeTx: getValidTx,
            signTx: signExecuteTx,
            execTx: msigExecute,
        })

        it('fails if target contract is incorrect (in signature)', async () => {
            const tx = getValidTx(context)
            const sigTx = { ...tx, targetContract: evils[0] }
            const signatures = await signExecuteTx(sigTx, owners)
            await expectRevert(
                msigExecute(tx, signaturesToList(signatures), from),
                'Invalid signature'
            )
        })

        it('makes a requested call if everything is correct', async () => {
            const tx = getValidTx(context)
            const signatures = await signExecuteTx(tx, owners)
            await msigExecute(tx, signaturesToList(signatures), from),
            await expectConsumerStorage(
                context.consumer,
                context.expectedConsumerStorage
            )
        })
    })

    describe('isOwner', async function() {
        const context = {}

        beforeEach(async function() {
            context.msig = await Multisig.new(owners, 2, { from })
        })

        it('should return true for all owners', async function() {
            for (let owner of owners) {
                assert.equal(
                    await context.msig.isOwner.call(owner), true,
                    `Multisig owner ${owner} is non-owner`
                )
            }
        })
        it('should return false for non-owners', async function() {
            for (let evil of evils) {
                assert.equal(
                    await context.msig.isOwner.call(evil), false,
                    `Multisig non-owner ${evil} is owner`
                )
            }
        })
    })

    function failuresSpec(context, { makeTx, signTx, execTx }) {
        it('fails if multisig address is incorrect', async function() {
            const tx = { ...makeTx(context), msigAddress: evils[0] }
            const signatures = await signTx(tx, owners)
            await expectRevert(
                execTx(tx, signaturesToList(signatures), from),
                'Invalid signature'
            )
        })

        it('fails if msig address is incorrect (in signature)', async function() {
            const tx = makeTx(context)
            const sigTx = { ...tx, msigAddress: evils[0] }
            const signatures = await signTx(sigTx, owners)
            await expectRevert(
                execTx(tx, signaturesToList(signatures), from),
                'Invalid signature'
            )
        })

        it('fails if nonce is incorrect', async function() {
            const tx = { ...makeTx(context), nonce: 1 }
            const signatures = await signTx(tx, owners)
            await expectRevert(
                execTx(tx, signaturesToList(signatures), from),
                'Invalid signature'
            )
        })

        it('fails if signed by a non-owner (start pos)', async function() {
            const tx = makeTx(context)
            const signers = [evils[0], ...owners.slice(1)]
            const signatures = await signTx(tx, signers)
            await expectRevert(
                execTx(tx, signaturesToList(signatures), from),
                'Invalid signature'
            )
        })

        it('fails if signed by a non-owner (middle pos)', async function() {
            const tx = makeTx(context)
            const signers = [evils[1], ...owners.slice(1)]
            const signatures = await signTx(tx, signers)
            await expectRevert(
                execTx(tx, signaturesToList(signatures), from),
                'Invalid signature'
            )
        })

        it('fails if signed by a non-owner (end pos)', async function() {
            const tx = makeTx(context)
            const signers = [evils[2], ...owners.slice(1)]
            const signatures = await signTx(tx, signers)
            await expectRevert(
                execTx(tx, signaturesToList(signatures), from),
                'Invalid signature'
            )
        })

        it('fails if same key signs twice (start pos)', async function() {
            const tx = makeTx(context)
            const signaturesList = signaturesToList(await signTx(tx, owners))
            signaturesList[1] = signaturesList[0]
            await expectRevert(
                execTx(tx, signaturesList, from),
                'The addresses must be provided in the ascending order'
            )
        })

        it('fails if same key signs twice (middle pos)', async function() {
            const tx = makeTx(context)
            const signaturesList = signaturesToList(await signTx(tx, owners))
            const middle = Math.floor(signaturesList.length / 2)
            signaturesList[middle + 1] = signaturesList[middle]
            await expectRevert(
                execTx(tx, signaturesList, from),
                'The addresses must be provided in the ascending order'
            )
        })

        it('fails if same key signs twice (last pos)', async function() {
            const tx = makeTx(context)
            const signaturesList = signaturesToList(await signTx(tx, owners))
            const last = signaturesList.length - 1
            signaturesList[last - 1] = signaturesList[last]
            await expectRevert(
                execTx(tx, signaturesList, from),
                'The addresses must be provided in the ascending order'
            )
        })

        it('fails if signature is corrupted (start pos)', async function() {
            const tx = makeTx(context)
            const signaturesList = signaturesToList(await signTx(tx, owners))
            signaturesList[0] = '0x00'
            await expectRevert(
                execTx(tx, signaturesList, from),
                'Invalid signature'
            )
        })

        it('fails if signature is corrupted (middle pos)', async function() {
            const tx = makeTx(context)
            const signaturesList = signaturesToList(await signTx(tx, owners))
            const middle = Math.floor(signaturesList.length / 2)
            signaturesList[middle] = '0x00'
            await expectRevert(
                execTx(tx, signaturesList, from),
                'Invalid signature'
            )
        })

        it('fails if signature is corrupted (end pos)', async function() {
            const tx = makeTx(context)
            const signaturesList = signaturesToList(await signTx(tx, owners))
            const last = signaturesList.length - 1
            signaturesList[last] = '0x00'
            await expectRevert(
                execTx(tx, signaturesList, from),
                'Invalid signature'
            )
        })
    }
})
