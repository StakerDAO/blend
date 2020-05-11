const { accounts, contract } = require('@openzeppelin/test-environment')
const { expectRevert, constants } = require('@openzeppelin/test-helpers')
const { expect } = require('chai')
const Ownable = contract.fromArtifact('Ownable')

describe('Ownable', async function() {
    const [owner, newOwner, eva] = accounts
    const ctx = {}

    beforeEach(async function() {
        ctx.ownable = await Ownable.new({from: owner})
        await ctx.ownable.initialize(owner, {from: owner})
    })

    describe('Initialization', async function() {
        it('Sets the owner upon initialization', async function() {
            expect(await ctx.ownable.owner()).to.equal(owner)
        })

        it('Does not set the pending owner upon initialization',
            async function() {
                expect(
                    await ctx.ownable.pendingOwner()
                ).to.equal(constants.ZERO_ADDRESS)
            }
        )
    })

    describe('transferOwnership', async function() {
        it('Sets the pending owner if called by current owner',
            async function() {
                await ctx.ownable.transferOwnership(newOwner, {from: owner})
                expect(await ctx.ownable.pendingOwner()).to.equal(newOwner)
                expect(
                    await ctx.ownable.isPendingOwner({from: newOwner})
                ).to.equal(true)
            }
        )

        it('Does not change the current owner', async function() {
            await ctx.ownable.transferOwnership(newOwner, {from: owner})
            expect(await ctx.ownable.owner()).to.equal(owner)
            expect(
                await ctx.ownable.isOwner({from: owner})
            ).to.equal(true)
        })

        it('Fails if called by Eva', async function() {
            await expectRevert(
                ctx.ownable.transferOwnership(newOwner, {from: eva}),
                'Ownable: caller is not the owner'
            )
        })

        it('Fails if called by pending owner', async function() {
            await ctx.ownable.transferOwnership(newOwner, {from: owner})
            await expectRevert(
                ctx.ownable.transferOwnership(eva, {from: newOwner}),
                'Ownable: caller is not the owner'
            )
        })
    })

    describe('acceptOwnership', async function() {
        it('Fails if pending owner has not been set', async function() {
            await expectRevert(
                ctx.ownable.acceptOwnership({from: newOwner}),
                'Ownable: caller is not the pending owner'
            )
        })

        it('Fails if not called by pending owner', async function() {
            await ctx.ownable.transferOwnership(newOwner, {from: owner})
            await expectRevert(
                ctx.ownable.acceptOwnership({from: eva}),
                'Ownable: caller is not the pending owner'
            )
        })

        it('Transfers ownership if called by pending owner', async function() {
            await ctx.ownable.transferOwnership(newOwner, {from: owner})
            await ctx.ownable.acceptOwnership({from: newOwner})

            expect(
                await ctx.ownable.pendingOwner()
            ).to.equal(constants.ZERO_ADDRESS)

            expect(
                await ctx.ownable.isPendingOwner({from: newOwner})
            ).to.equal(false)

            expect(await ctx.ownable.owner()).to.equal(newOwner)

            expect(
                await ctx.ownable.isOwner({from: newOwner})
            ).to.equal(true)

            expect(
                await ctx.ownable.isOwner({from: owner})
            ).to.equal(false)
        })
    })
})
