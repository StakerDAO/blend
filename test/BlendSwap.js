const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, time } = require('@openzeppelin/test-helpers')
const { expect } = require('chai').use(require('chai-bn')(BN))
const { toBN, hexToBytes } = web3.utils
const crypto = require('crypto')

const Registry = contract.fromArtifact('Registry')
const BlendToken = contract.fromArtifact('BlendToken')
const BlendSwap = contract.fromArtifact('BlendSwap')

function hash(payload) {
    const data = Buffer.from(hexToBytes(payload))
    const hash = crypto.createHash('sha256')
    hash.update(data)
    return `0x${ hash.digest('hex') }`
}

describe('BlendSwap', async function() {
    const ctx = {}
    const [owner, registryBackend, orchestrator, alice, tenderAddress, bob, bob2] = accounts
    const initialBalance = toBN('100000')

    async function testDeploy(initialHolder) {
        ctx.registry = await Registry.new({ from: owner })
        ctx.blend = await BlendToken.new({ from: owner })

        const BLND_INIT = 'initialize(address,uint256,address,address)'
        const initializeBlend = ctx.blend.methods[BLND_INIT]

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

    it('initializes BLND address correctly', async function() {
        await testDeploy(alice)
        expect(await ctx.swap.blend()).to.equal(ctx.blend.address)
    })

    const zeroAddress = '0x0000000000000000000000000000000000000000'
    const dummySecret = '0x1234567812345678123456781234567812345678123456781234567812345678'
    const dummySecretHash = hash(dummySecret)

    const amount = toBN('90')
    const fee = toBN('10')
    const delta = 10 * 60 * 1000
    const t = 30 * 60 * 1000
    let releaseTime = toBN(Date.now() + delta + t)

    describe('creates a confirmed swap', async function() {
        before(async function() {
            await testDeploy(bob)
            await ctx.blend.approveAndLock(
                ctx.swap.address,
                alice,
                amount,
                releaseTime,
                dummySecretHash,
                true,
                fee,
                {from: bob}
            )
        })

        it('should hold correct swap info', async function() {
            const result = await ctx.swap.swaps(dummySecretHash, bob)
            expect(result.to).to.equal(alice)
            expect(result.amount).to.be.bignumber.equal(amount)
            expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            expect(result.fee).to.be.bignumber.equal(fee)
            expect(result.confirmed).to.equal(true)
        })

        it('should decrease Bob\'s token balance', async function() {
            const bobBalance = await ctx.blend.balanceOf(bob)
            const expected = toBN(initialBalance).sub(amount.add(fee))
            expect(bobBalance).to.be.bignumber.equal(expected)
        })

        it('should increase Swap contract\'s token balance', async function() {
            const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
            expect(lockBalance).to.be.bignumber.equal(amount.add(fee))
        })

        it('should be able to lock with the same secretHash', async function() {
            await ctx.blend.mint(bob2, initialBalance, {from: owner})
            await ctx.blend.approveAndLock(
                ctx.swap.address,
                alice,
                amount,
                releaseTime,
                dummySecretHash,
                true,
                fee,
                {from: bob2}
            )
            const result = await ctx.swap.swaps(dummySecretHash, bob2)
            expect(result.to).to.equal(alice)
            expect(result.amount).to.be.bignumber.equal(amount)
            expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            expect(result.fee).to.be.bignumber.equal(fee)
            expect(result.confirmed).to.equal(true)
        })
    })

    describe('creates non confirmed swap', async function() {
        before(async function() {
            await testDeploy(bob)
            await ctx.blend.approveAndLock(
                ctx.swap.address,
                alice,
                amount,
                releaseTime,
                dummySecretHash,
                false,
                fee,
                {from: bob}
            )
        })

        it('should hold correct swap info', async function() {
            const result = await ctx.swap.swaps(dummySecretHash, bob)
            expect(result.to).to.equal(alice)
            expect(result.amount).to.be.bignumber.equal(amount)
            expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            expect(result.fee).to.be.bignumber.equal(fee)
            expect(result.confirmed).to.equal(false)
        })

        it('should decrease Bob\'s token balance', async function() {
            const bobBalance = await ctx.blend.balanceOf(bob)
            const expected = toBN(initialBalance).sub(amount.add(fee))
            expect(bobBalance).to.be.bignumber.equal(expected)
        })

        it('should increase Swap contract\'s token balance', async function() {
            const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
            expect(lockBalance).to.be.bignumber.equal(amount.add(fee))
        })
    })

    describe('allows to lock without blend', async function() {
        before(async function() {
            await testDeploy(bob)
        })

        it('should hold correct swap info', async function() {
            await ctx.blend.approve(ctx.swap.address, amount.add(fee), {from: bob})
            await ctx.swap.lock(
                alice,
                amount,
                releaseTime,
                dummySecretHash,
                true,
                fee,
                {from: bob}
            )
            const result = await ctx.swap.swaps(dummySecretHash, bob)
            expect(result.to).to.equal(alice)
            expect(result.amount).to.be.bignumber.equal(amount)
            expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            expect(result.fee).to.be.bignumber.equal(fee)
            expect(result.confirmed).to.equal(true)
        })

        it('should reject lockFrom call not from blend', async function() {
            await expectRevert(
                ctx.swap.lockFrom(
                    ctx.swap.address,
                    alice,
                    amount,
                    releaseTime,
                    dummySecretHash,
                    true,
                    fee,
                    {from: bob}
                ),
                "Unauthorized: sender is not the Blend contract"
            )
        })
    })

    describe('allows to confirm swap', async function() {
        before(async function() {
            await testDeploy(bob)
            await ctx.blend.approveAndLock(
                ctx.swap.address,
                alice,
                amount,
                releaseTime,
                dummySecretHash,
                false,
                fee,
                {from: bob}
            )
            await ctx.swap.confirmSwap(dummySecretHash, {from: bob})
        })

        it('should hold correct swap info', async function() {
            const result = await ctx.swap.swaps(dummySecretHash, bob)
            expect(result.to).to.equal(alice)
            expect(result.amount).to.be.bignumber.equal(amount)
            expect(result.releaseTime).to.be.bignumber.equal(releaseTime)
            expect(result.fee).to.be.bignumber.equal(fee)
            expect(result.confirmed).to.equal(true)
        })

        it('should decrease Bob\'s token balance', async function() {
            const bobBalance = await ctx.blend.balanceOf(bob)
            const expected = toBN(initialBalance).sub(amount.add(fee))
            expect(bobBalance).to.be.bignumber.equal(expected)
        })

        it('should increase Swap contract\'s token balance', async function() {
            const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
            expect(lockBalance).to.be.bignumber.equal(amount.add(fee))
        })
    })

    describe('allows Alice to redeem', async function() {
        before(async function() {
            await testDeploy(bob)
            await ctx.blend.approveAndLock(
                ctx.swap.address,
                alice,
                amount,
                releaseTime,
                dummySecretHash,
                false,
                fee,
                {from: bob}
            )
            await ctx.swap.confirmSwap(dummySecretHash, {from: bob})
            await ctx.swap.redeem(dummySecret, bob, {from: alice})
        })

        it('should remove swap from mapping', async function() {
            const result = await ctx.swap.swaps(dummySecretHash, bob)
            expect(result.to).to.equal(zeroAddress)
        })

        it('should decrease Bob\'s token balance', async function() {
            const bobBalance = await ctx.blend.balanceOf(bob)
            const expected = toBN(initialBalance).sub(amount.add(fee))
            expect(bobBalance).to.be.bignumber.equal(expected)
        })

        it('should increase Alice\'s token balance', async function() {
            const aliceBalance = await ctx.blend.balanceOf(alice)
            expect(aliceBalance).to.be.bignumber.equal(amount.add(fee))
        })

        it('should not change Swap contract\'s token balance', async function() {
            const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
            expect(lockBalance).to.be.bignumber.equal(toBN('0'))
        })
    })

    describe('allows to unlock funds after timeout', async function() {
        beforeEach(async function() {
            await testDeploy(bob)
            releaseTime = releaseTime.addn(delta + t)
            await ctx.blend.approveAndLock(
                ctx.swap.address,
                alice,
                amount,
                releaseTime,
                dummySecretHash,
                false,
                fee,
                {from: bob}
            )
        })

        it('should refund if claimed before swap confirmation', async function() {
            await time.increaseTo(releaseTime)
            await ctx.swap.claimRefund(dummySecretHash, {from: bob})
            const result = await ctx.swap.swaps(dummySecretHash, bob)
            expect(result.to).to.equal(zeroAddress)
        })

        it('should refund if claimed before redeem', async function() {
            await ctx.swap.confirmSwap(dummySecretHash, {from: bob})
            await time.increaseTo(releaseTime)
            await ctx.swap.claimRefund(dummySecretHash, {from: bob})
        })

        it('should reject refund if claimed after revealing secret', async function() {
            await ctx.swap.confirmSwap(dummySecretHash, {from: bob})
            await ctx.swap.redeem(dummySecret, bob, {from: alice})
            await time.increaseTo(releaseTime)
            await expectRevert(
                ctx.swap.claimRefund(dummySecretHash, {from: bob}),
                "Swap not initialized"
            )
        })

        it('should decrease Bob\'s token balance', async function() {
            await time.increaseTo(releaseTime)
            await ctx.swap.claimRefund(dummySecretHash, {from: bob})
            const bobBalance = await ctx.blend.balanceOf(bob)
            const expected = toBN(initialBalance).sub(fee)
            expect(bobBalance).to.be.bignumber.equal(expected)
        })

        it('should increase Alice\'s token balance', async function() {
            await time.increaseTo(releaseTime)
            await ctx.swap.claimRefund(dummySecretHash, {from: bob})
            const aliceBalance = await ctx.blend.balanceOf(alice)
            expect(aliceBalance).to.be.bignumber.equal(fee)
        })

        it('should not change Swap contract\'s token balance', async function() {
            await time.increaseTo(releaseTime)
            await ctx.swap.claimRefund(dummySecretHash, {from: bob})
            const lockBalance = await ctx.blend.balanceOf(ctx.swap.address)
            expect(lockBalance).to.be.bignumber.equal(toBN('0'))
        })
    })
})
