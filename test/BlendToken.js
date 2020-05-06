const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, constants } = require('@openzeppelin/test-helpers')
const { expect } = require('chai').use(require('chai-bn')(BN))
const { toBN } = web3.utils
const Registry = contract.fromArtifact('Registry')
const BlendToken = contract.fromArtifact('BlendToken')


describe('BlendToken', async function() {
    const ctx = {}
    const [owner, registryBackend, orchestrator, alice, tenderAddress, bob] = accounts

    async function initialize() {
        ctx.registry = await Registry.new({ from: owner })
        ctx.blend = await BlendToken.new({ from: owner })

        const initializeBlend =
            ctx.blend.methods['initialize(address,uint256,address,address)']

        const initializeRegistry =
            ctx.registry.methods['initialize(address,address)']

        await initializeBlend(
            alice,
            toBN('100000'),
            ctx.registry.address,
            orchestrator,
            { from: owner }
        )

        await initializeRegistry(
            ctx.blend.address,
            registryBackend,
            { from: owner }
        )
    }

    beforeEach(async function() {
        await initialize()
        await ctx.registry.registerTenderAddress.sendTransaction(
            tenderAddress, { from: registryBackend }
        )
    })

    describe('transfers', async function() {
        it('locks tokens upon transfer to tender address', async function() {
            const amount = toBN('5000')
            await ctx.blend.transfer.sendTransaction(
                tenderAddress, amount, { from: alice }
            )
            expect(
                await ctx.registry.getLockedAmount(tenderAddress, alice)
            ).to.be.bignumber.equal(
                amount,
                'Unexpected locked amount after transfer to a tender address'
            )
        })

        it('locks tokens upon transferFrom to tender address', async function() {
            const amount = toBN('5000')
            await ctx.blend.approve.sendTransaction(
                bob, amount, { from: alice }
            )
            await ctx.blend.transferFrom.sendTransaction(
                alice, tenderAddress, amount, { from: bob }
            )
            expect(
                await ctx.registry.getLockedAmount(tenderAddress, alice)
            ).to.be.bignumber.equal(
                amount,
                'Unexpected locked amount after transfer to a tender address'
            )
        })

        it('does not lock tokens upon transfer to a regular address', async function() {
            const amount = toBN('5000')
            await ctx.blend.transfer.sendTransaction(
                bob, amount, { from: alice }
            )
            expect(
                await ctx.registry.getLockedAmount(bob, alice)
            ).to.be.bignumber.equal(
                toBN('0'),
                'Unexpected locked amount after transfer to a tender address'
            )
        })
    })

    describe('phases', async function() {
        it('is not at distribution phase initially', async function() {
            expect(await ctx.blend.distributionPhase()).to.equal(false)
        })

        it('allows orchestrator to enable distribution phase', async function() {
            await ctx.blend.startDistributionPhase.sendTransaction(
                { from: orchestrator }
            )
            expect(await ctx.blend.distributionPhase()).to.equal(true)
        })

        it('allows orchestrator to stop distribution phase', async function() {
            await ctx.blend.startDistributionPhase.sendTransaction(
                { from: orchestrator }
            )
            await ctx.blend.stopDistributionPhase.sendTransaction(
                { from: orchestrator }
            )
            expect(await ctx.blend.distributionPhase()).to.equal(false)
        })

        it('does not allow someone to enable distribution phase', async function() {
            await expectRevert(
                ctx.blend.startDistributionPhase.sendTransaction(
                    { from: bob }
                ),
                'Unauthorized: sender is not the Orchestrator'
            )
        })

        it('does not allow someone to stop distribution phase', async function() {
            await ctx.blend.startDistributionPhase.sendTransaction(
                { from: orchestrator }
            )
            await expectRevert(
                ctx.blend.startDistributionPhase.sendTransaction(
                    { from: bob }
                ),
                'Unauthorized: sender is not the Orchestrator'
            )
        })
    })

    describe('unlocks', async function() {
        beforeEach(async function() {
            await ctx.blend.transfer.sendTransaction(
                tenderAddress, toBN('100'), { from: alice }
            )
        })

        it('Unlocks are enabled at regurlar phase', async function() {
            const before = await ctx.blend.balanceOf(alice)
            await ctx.blend.unlock(tenderAddress, toBN('100'), { from: alice })
            const after = await ctx.blend.balanceOf(alice)
            expect(after.sub(before)).to.be.bignumber.equal(toBN('100'))
        })

        it('Unlocks are disabled at distribution phase', async function() {
            await ctx.blend.startDistributionPhase.sendTransaction({ from: orchestrator })
            await expectRevert(
                ctx.blend.unlock(tenderAddress, toBN('100'), { from: alice }),
                'Cannot unlock funds at distribution phase'
            )
        })

        it('Cannot unlock more than the balance of tender address', async function() {
            const tender2 = bob
            await ctx.registry.registerTenderAddress(
                tender2, { from: registryBackend }
            )
            await ctx.blend.transfer(
                tender2, toBN('100'), { from: alice }
            )
            const tenderBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(tenderBalance).to.be.bignumber.equal(toBN('100'))
            await expectRevert(
                ctx.blend.unlock(tenderAddress, toBN('150'), { from: alice }),
                'ERC20: transfer amount exceeds balance'
            )
        })

        it('Cannot unlock more than the locked amount', async function() {
            await ctx.blend.transfer.sendTransaction(
                bob, toBN('100'), { from: alice }
            )
            await ctx.blend.transfer.sendTransaction(
                tenderAddress, toBN('100'), { from: bob }
            )
            const tenderBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(tenderBalance).to.be.bignumber.equal(toBN('200'))
            await expectRevert(
                ctx.blend.unlock(tenderAddress, toBN('150'), { from: alice }),
                'Insufficient locked amount'
            )
        })
    })

    describe('burns', async function() {
        beforeEach(async function() {
            await ctx.blend.transfer.sendTransaction(
                tenderAddress, toBN('100'), { from: alice }
            )
        })

        it('Burns are enabled at distribution phase', async function() {
            await ctx.blend.startDistributionPhase({ from: orchestrator })
            await ctx.blend.burn(
                tenderAddress, toBN('50'), { from: orchestrator }
            )
            const remaining = await ctx.blend.balanceOf(tenderAddress)
            expect(remaining).to.be.bignumber.equal(toBN('50'))
        })

        it('Burns are disabled at regurlar phase', async function() {
            await expectRevert(
                ctx.blend.burn(
                    tenderAddress, toBN('50'), { from: orchestrator }
                ),
                'Burn is allowed only at distribution phase'
            )
        })

        it('Cannot burn more than the balance of tender address', async function() {
            await ctx.blend.startDistributionPhase({ from: orchestrator })
            await expectRevert(
                ctx.blend.burn(
                    tenderAddress, toBN('150'), { from: orchestrator }
                ),
                'Not enough balance on tender address'
            )
        })

        it('Cannot burn from a regurlar address', async function() {
            await ctx.blend.startDistributionPhase({ from: orchestrator })
            await expectRevert(
                ctx.blend.burn(
                    alice, toBN('100'), { from: orchestrator }
                ),
                'Burning from regular addresses is not allowed'
            )
        })
    })
})
