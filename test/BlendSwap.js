const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, expectEvent, time } = require('@openzeppelin/test-helpers')
const { expect } = require('chai').use(require('chai-bn')(BN))
const { toBN, hexToBytes } = web3.utils
const crypto = require('crypto')

const Registry = contract.fromArtifact('Registry')
const BlendToken = contract.fromArtifact('BlendToken')
const BlendSwap = contract.fromArtifact('BlendSwap')


const Status = {
    NOT_INITIALIZED: 0,
    INITIALIZED: 1,
    HASH_REVEALED: 2,
    SECRET_REVEALED: 3,
    REFUNDED: 4
}

function hash(payload) {
    const data = Buffer.from(hexToBytes(payload))
    const hash = crypto.createHash('sha256')
    hash.update(data)
    return `0x${ hash.digest('hex') }`
}

const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
const dummySwapId = '0x1234567812345678123456781234567812345678123456781234567812345678'
const dummySecret = '0x1234567812345678123456781234567812345678123456781234567812345678'
const dummySecretHash = hash(dummySecret)

describe('BlendToken', async function() {
    const ctx = {}
    const [owner, registryBackend, orchestrator, alice, tenderAddress, bob] = accounts
    const initialBalance = toBN('100000')

    async function testDeploy(initialHolder) {
        ctx.registry = await Registry.new({ from: owner })
        ctx.blend = await BlendToken.new({ from: owner })

        const BLEND_INIT = 'initialize(address,uint256,address,address)'
        const initializeBlend = ctx.blend.methods[BLEND_INIT]

        const REGISTRY_INIT = 'initialize(address,address)'
        const initializeRegistry = ctx.registry.methods[REGISTRY_INIT]

        await initializeBlend(
            initialHolder,
            initialBalance,
            ctx.registry.address,
            orchestrator,
            { from: owner }
        )

        await initializeRegistry(
            ctx.blend.address,
            registryBackend,
            { from: owner }
        )

        ctx.swap = await BlendSwap.new(ctx.blend.address, { from: owner })
    }

    it('initializes BLEND address correctly', async function() {
        await testDeploy(alice)
        expect(await ctx.swap.blend()).to.equal(ctx.blend.address)
    })

    describe('Empty secret flow ("Bob\'s flow")', async function() {

        const amount = toBN('100')
        const delta = 10 * 60 * 1000
        const t = 30 * 60 * 1000
        const releaseTime = toBN(Date.now() + delta + t)

        describe('creates a swap with an empty secret', async function() {
            before(async function() {
                await testDeploy(bob)
                await ctx.blend.approve(ctx.swap.address, amount, {from: bob})
                await ctx.swap.lock(
                    dummySwapId,
                    alice,
                    amount,
                    releaseTime,
                    '0x00',
                    {from: bob}
                )
            })

            it('should hold correct swap info', async function() {
                const result = await ctx.swap.swaps(dummySwapId)
                expect(result.from).to.equal(bob)
                expect(result.to).to.equal(alice)
                expect(result.amount).to.be.bignumber.equal(amount)
                expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            })

            it('should have INITIALIZED status', async function() {
                const status = (await ctx.swap.status(dummySwapId)).toNumber()
                expect(status).to.equal(Status.INITIALIZED)
            })

            it('should not hold secret hash', async function() {
                expect(await ctx.swap.hashlocks(dummySwapId)).to.equal(ZERO_BYTES32)
            })

            it('should not hold secret', async function() {
                expect(await ctx.swap.secrets(dummySwapId)).to.equal(ZERO_BYTES32)
            })

            it('should decrease Bob\'s token balance', async function() {
                const bobBalance = await ctx.blend.balanceOf(bob)
                const expected = toBN(initialBalance).sub(amount)
                expect(bobBalance).to.be.bignumber.equal(expected)
            })

            it('should increase Swap contract\'s token balance', async function() {
                const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
                expect(lockBalance).to.be.bignumber.equal(amount)
            })
        })

        describe('allows to unlock funds after timeout', async function() {
            beforeEach(async function() {
                await testDeploy(bob)
                await ctx.blend.approve(ctx.swap.address, amount, {from: bob})
                await ctx.swap.lock(
                    dummySwapId,
                    alice,
                    amount,
                    releaseTime,
                    '0x00',
                    {from: bob}
                )
            })

            it('should refund if claimed before revealing secret', async function() {
                await time.increaseTo(releaseTime)
                await ctx.swap.claimRefund(dummySwapId, {from: bob})
            })

            it('should refund if claimed before revealing secret hash', async function() {
                await ctx.swap.revealSecretHash(dummySwapId, dummySecretHash, {from: bob})
                await time.increaseTo(releaseTime)
                await ctx.swap.claimRefund(dummySwapId, {from: bob})
            })

            it('should reject refund if claimed after revealing secret', async function() {
                await ctx.swap.revealSecretHash(dummySwapId, dummySecretHash, {from: bob})
                await ctx.swap.redeem(dummySwapId, dummySecret, {from: alice})
                await time.increaseTo(releaseTime)
                await expectRevert(
                    ctx.swap.claimRefund(dummySwapId, {from: bob}),
                    "Wrong status"
                )
            })
        })

        describe('allows to supply secret hash', async function() {
            before(async function() {
                await testDeploy(bob)
                await ctx.blend.approve(ctx.swap.address, amount, {from: bob})
                await ctx.swap.lock(
                    dummySwapId,
                    alice,
                    amount,
                    releaseTime,
                    '0x00',
                    {from: bob}
                )
                await ctx.swap.revealSecretHash(dummySwapId, dummySecretHash, {from: bob})
            })

            it('should hold correct swap info', async function() {
                const result = await ctx.swap.swaps(dummySwapId)
                expect(result.from).to.equal(bob)
                expect(result.to).to.equal(alice)
                expect(result.amount).to.be.bignumber.equal(amount)
                expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            })

            it('should have HASH_REVEALED status', async function() {
                const status = (await ctx.swap.status(dummySwapId)).toNumber()
                expect(status).to.equal(Status.HASH_REVEALED)
            })

            it('should hold secret hash', async function() {
                expect(await ctx.swap.hashlocks(dummySwapId)).to.equal(dummySecretHash)
            })

            it('should not hold secret', async function() {
                expect(await ctx.swap.secrets(dummySwapId)).to.equal(ZERO_BYTES32)
            })

            it('should decrease Bob\'s token balance', async function() {
                const bobBalance = await ctx.blend.balanceOf(bob)
                const expected = toBN(initialBalance).sub(amount)
                expect(bobBalance).to.be.bignumber.equal(expected)
            })

            it('should increase Swap contract\'s token balance', async function() {
                const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
                expect(lockBalance).to.be.bignumber.equal(amount)
            })
        })

        describe('allows Alice to redeem', async function() {
            before(async function() {
                await testDeploy(bob)
                await ctx.blend.approve(ctx.swap.address, amount, {from: bob})
                await ctx.swap.lock(
                    dummySwapId,
                    alice,
                    amount,
                    releaseTime,
                    '0x00',
                    {from: bob}
                )
                await ctx.swap.revealSecretHash(dummySwapId, dummySecretHash, {from: bob})
                await ctx.swap.redeem(dummySwapId, dummySecret, {from: alice})
            })

            it('should hold correct swap info', async function() {
                const result = await ctx.swap.swaps(dummySwapId)
                expect(result.from).to.equal(bob)
                expect(result.to).to.equal(alice)
                expect(result.amount).to.be.bignumber.equal(amount)
                expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            })

            it('should have SECRET_REVEALED status', async function() {
                const status = (await ctx.swap.status(dummySwapId)).toNumber()
                expect(status).to.equal(Status.SECRET_REVEALED)
            })

            it('should preserve secret hash', async function() {
                expect(await ctx.swap.hashlocks(dummySwapId)).to.equal(dummySecretHash)
            })

            it('should expose secret', async function() {
                expect(await ctx.swap.secrets(dummySwapId)).to.equal(dummySecret)
            })

            it('should decrease Bob\'s token balance', async function() {
                const bobBalance = await ctx.blend.balanceOf(bob)
                const expected = toBN(initialBalance).sub(amount)
                expect(bobBalance).to.be.bignumber.equal(expected)
            })

            it('should increase Alice\'s token balance', async function() {
                const aliceBalance = await ctx.blend.balanceOf(alice)
                expect(aliceBalance).to.be.bignumber.equal(amount)
            })

            it('should decrease Swap contract\'s token balance', async function() {
                const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
                expect(lockBalance).to.be.bignumber.equal(toBN('0'))
            })
        })
    })
})
