const Eth = require('web3-eth')
const Utils = require('web3-utils')
const Multisig = artifacts.require('Multisig')
const Consumer = artifacts.require('Consumer')
const {
    ignoreRevert, assertRevert, fixSignature, expectConsumerStorage
} = require('./helpers')


const eth = new Eth(Eth.givenProvider)

const caseInsensitiveCompare = (lhs, rhs) => {
    return lhs.localeCompare(rhs, 'en', {sensitivity: 'base'})
}

const msigCall = async ({msig, value, targetContract, data, nonce, signers}, rewrites) => {
    const hashToSign = Utils.soliditySha3(
        {type: 'uint8', value: '0x19'},
        {type: 'uint8', value: '0x00'},
        {type: 'address', value: rewrites.sigAddress || msig.address},
        {type: 'address', value: rewrites.sigTargetContract || targetContract},
        {type: 'uint256', value: rewrites.sigValue || value},
        {type: 'bytes', value: rewrites.sigData || data},
        {type: 'uint', value: rewrites.sigNonce || nonce}
    )

    let signatures = await Promise.all(
        [...signers]
            .sort(caseInsensitiveCompare)
            .map(async addr => {
                return fixSignature(await eth.sign(hashToSign, addr))
            })
    )
    if (rewrites.corruptSignatures) {
        signatures = rewrites.corruptSignatures(signatures)
    }


    const execParams = [
        rewrites.txTargetContract || targetContract,
        rewrites.txValue || value,
        rewrites.txData || data,
        signatures
    ]

    const defaultGas = 1000000
    // We still want failed transactions to be recorded on chain for
    // debug purposes, so we ignore any failures that may occur at
    // this stage and just substitute the default value.
    const gas = await ignoreRevert(
        msig.execute.estimateGas(
            ...execParams, { from: signers[0] }
        )
    ) || defaultGas
    await msig.execute.sendTransaction(
        ...execParams, { from: signers[0], gas: gas }
    )
}

const msigRotateKeys = ({msig, newOwners, newThreshold, nonce, signers}, rewrites) => {
    const hashToSign = Utils.soliditySha3(
        {type: 'uint8', value: '0x19'},
        {type: 'uint8', value: '0x00'},
        {type: 'address', value: rewrites.sigAddress || msig.address},
        {type: 'address[]', value: rewrites.sigNewOwners || newOwners},
        {type: 'uint', value: rewrites.sigNewThreshold || newThreshold},
        {type: 'uint', value: rewrites.sigNonce || nonce}
    )
}

const splitAccounts = accounts => {
    assert(
        accounts.length >= 9,
        "Running multisig tests require at least 9 active accounts"
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

contract('Multisig', accounts => {
    // We want to test evil keys at different positions but since the signers
    // are sorted before calling multisig, we need evil keys to be in different
    // positions _lexicographically_. We first fetch the evil keys, and then
    // use the remaining ones as multisig owners/newOwners.
    const { evils, owners, newOwners } = splitAccounts(accounts)

    beforeEach(async () => {
        this.msig = await Multisig.new(owners, 2)
        this.consumer = await Consumer.new()
    })

    describe('rotateKeys', async () => {
        const callRotateKeysWithMultisig = async (msig, signers, newOwners, rewrites) => {

        }
    })

    describe('call', async () => {
        const callConsumerWithMultisig = async (msig, consumer, signers, rewrites) => {
            const consumerParam =
                consumer.contract.methods.updateData(
                    '0x0123456789abcdeffedcba', '0x2019deadbeef2020',
                    123456789, "Hello world"
                ).encodeABI()

            const params = {
                msig: msig,
                value: '0',
                targetContract: consumer.address,
                data: consumerParam,
                nonce: 0,
                signers: signers
            }
            return await msigCall(params, rewrites || {})
        }

        it('makes a requested call if everything is correct', async () => {
            await callConsumerWithMultisig(this.msig, this.consumer, owners)
            await expectConsumerStorage(
                this.consumer,
                {
                    lastFixedBytes: '0x0123456789abcdeffedcba',
                    lastVarBytes: '0x2019deadbeef2020',
                    lastUint: 123456789,
                    lastString: "Hello world"
                }
            )
        })

        it('fails if nonce is incorrect', async () => {
            await assertRevert(
                callConsumerWithMultisig(
                    this.msig, this.consumer, owners,
                    { sigNonce: 1 }
                ),
                "Invalid signature"
            )
        })

        it('fails if target contract is incorrect (in signature)', async () => {
            await assertRevert(
                callConsumerWithMultisig(
                    this.msig, this.consumer, owners,
                    { sigTargetContract: evils[0] }
                ),
                "Invalid signature"
            )
        })

        it('fails if signed by a non-owner (start pos)', async () => {
            const signers = [evils[0], ...owners.slice(1)]
            await assertRevert(
                callConsumerWithMultisig(this.msig, this.consumer, signers),
                "Invalid signature"
            )
        })

        it('fails if signed by a non-owner (middle pos)', async () => {
            const signers = [evils[1], ...owners.slice(1)]
            await assertRevert(
                callConsumerWithMultisig(this.msig, this.consumer, signers),
                "Invalid signature"
            )
        })

        it('fails if signed by a non-owner (end pos)', async () => {
            const signers = [evils[2], ...owners.slice(1)]
            await assertRevert(
                callConsumerWithMultisig(this.msig, this.consumer, signers),
                "Invalid signature"
            )
        })

        it('fails if signature is corrupted (start pos)', async () => {
            const corruptFirst = signatures => {
                return ['0x00', ...signatures.slice(1)]
            }
            await assertRevert(
                callConsumerWithMultisig(
                    this.msig, this.consumer, owners,
                    { corruptSignatures: corruptFirst }
                ),
                "Invalid signature"
            )
        })

        it('fails if signature is corrupted (middle pos)', async () => {
            const corruptMiddle = signatures => {
                const middle = signatures.length / 2
                const start = signatures.slice(0, middle)
                const rest = signatures.slice(middle + 1)
                return [...start, '0x00', ...rest]
            }
            await assertRevert(
                callConsumerWithMultisig(
                    this.msig, this.consumer, owners,
                    { corruptSignatures: corruptMiddle }
                ),
                "Invalid signature"
            )
        })

        it('fails if signature is corrupted (end pos)', async () => {
            const corruptLast = signatures => {
                return [...signatures.slice(0, -1), '0x00']
            }
            await assertRevert(
                callConsumerWithMultisig(
                    this.msig, this.consumer, owners,
                    { corruptSignatures: corruptLast }
                ),
                "Invalid signature"
            )
        })
    })

    describe('isOwner', async () => {
        it('should return true for all owners', async () => {
            for (let owner of owners) {
                assert.equal(
                    await this.msig.isOwner.call(owner), true,
                    `Multisig owner ${owner} is non-owner`
                )
            }
        })
        it('should return false for non-owners', async () => {
            for (let evil of evils) {
                assert.equal(
                    await this.msig.isOwner.call(evil), false,
                    `Multisig non-owner ${evil} is owner`
                )
            }
        })
    })
})
