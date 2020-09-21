const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, expectEvent } = require('@openzeppelin/test-helpers')
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

        const BLEND_INIT = 'initialize(address,uint256,address,address)'
        const initializeBlend = ctx.blend.methods[BLEND_INIT]

        const REGISTRY_INIT = 'initialize(address,address)'
        const initializeRegistry = ctx.registry.methods[REGISTRY_INIT]

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

    describe('Setting registry address', async function() {
        it('allows owner to change registry address', async function() {
            await ctx.blend.setRegistry(bob, {from: owner})
            const newRegistry = await ctx.blend.registry()
            expect(newRegistry).to.equal(bob)
        })

        it('prohibits someone else to change the registry address',
            async function() {
                await expectRevert(
                    ctx.blend.setRegistry(bob, {from: registryBackend}),
                    'Ownable: caller is not the owner'
                )
            }
        )
    })

    describe('Setting orchestrator address', async function() {
        it('allows owner to change orchestrator address', async function() {
            await ctx.blend.setOrchestrator(bob, {from: owner})
            const newOrchestrator = await ctx.blend.orchestrator()
            expect(newOrchestrator).to.equal(bob)
        })

        it('prohibits someone else to change the orchestrator address',
            async function() {
                await expectRevert(
                    ctx.blend.setOrchestrator(bob, {from: registryBackend}),
                    'Ownable: caller is not the owner'
                )
            }
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

        it('emits TokensLocked event upon transfer to tender address',
            async function() {
                const amount = toBN('5000')
                const receipt = await ctx.blend.transfer.sendTransaction(
                    tenderAddress, amount, { from: alice }
                )

                expectEvent(
                    receipt, 'TokensLocked',
                    {wallet: alice, tenderAddress, amount}
                )
            }
        )

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

        it('emits TokensLocked event upon transferFrom to tender address',
            async function() {
                const amount = toBN('5000')
                await ctx.blend.approve.sendTransaction(
                    bob, amount, { from: alice }
                )
                const receipt = await ctx.blend.transferFrom.sendTransaction(
                    alice, tenderAddress, amount, { from: bob }
                )

                expectEvent(
                    receipt, 'TokensLocked',
                    {wallet: alice, tenderAddress, amount}
                )
            }
        )

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

    describe('unlock', async function() {
        beforeEach(async function() {
            await ctx.blend.transfer.sendTransaction(
                tenderAddress, toBN('100'), { from: alice }
            )
        })

        it('is enabled at regurlar phase', async function() {
            const before = await ctx.blend.balanceOf(alice)
            await ctx.blend.unlock(tenderAddress, toBN('100'), { from: alice })
            const after = await ctx.blend.balanceOf(alice)
            expect(after.sub(before)).to.be.bignumber.equal(toBN('100'))
        })

        it('is disabled at distribution phase', async function() {
            await ctx.blend.startDistributionPhase.sendTransaction({ from: orchestrator })
            await expectRevert(
                ctx.blend.unlock(tenderAddress, toBN('100'), { from: alice }),
                'Cannot unlock funds at distribution phase'
            )
        })

        it('emits TokensUnlocked event upon unlock', async function() {
            const receipt = await ctx.blend.unlock(
                tenderAddress, toBN('100'), { from: alice }
            )

            expectEvent(
                receipt, 'TokensUnlocked',
                {wallet: alice, tenderAddress, amount: toBN('100')}
            )
        })

        it('cannot unlock more than the balance of tender address',
            async function() {
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
            }
        )

        it('cannot unlock more than the locked amount', async function() {
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

    describe('burn from tender address', async function() {
        beforeEach(async function() {
            await ctx.blend.transfer.sendTransaction(
                tenderAddress, toBN('100'), { from: alice }
            )
        })

        it('is enabled at distribution phase', async function() {
            await ctx.blend.startDistributionPhase({ from: orchestrator })
            await ctx.blend.burn(
                tenderAddress, toBN('50'), { from: orchestrator }
            )
            const remaining = await ctx.blend.balanceOf(tenderAddress)
            expect(remaining).to.be.bignumber.equal(toBN('50'))
        })

        it('is disabled at regurlar phase', async function() {
            await expectRevert(
                ctx.blend.burn(
                    tenderAddress, toBN('50'), { from: orchestrator }
                ),
                'Burn is allowed only at distribution phase'
            )
        })

        it('cannot burn more than the balance of tender address', async function() {
            await ctx.blend.startDistributionPhase({ from: orchestrator })
            await expectRevert(
                ctx.blend.burn(
                    tenderAddress, toBN('150'), { from: orchestrator }
                ),
                'Not enough balance on tender address'
            )
        })

        it('cannot burn from a someone\'s regular address', async function() {
            await ctx.blend.startDistributionPhase({ from: orchestrator })
            await expectRevert(
                ctx.blend.burn(
                    alice, toBN('100'), { from: orchestrator }
                ),
                'Burning from regular addresses is not allowed'
            )
        })
    })

    describe('burn from sender', async function() {
        it('should burn my tokens', async function() {
            const oldBalance = await ctx.blend.balanceOf(alice)
            await ctx.blend.burn(toBN('22222'), { from: alice })
            const newBalance = await ctx.blend.balanceOf(alice)
            const balanceDelta = newBalance.sub(oldBalance)
            expect(balanceDelta).to.be.bignumber.equal(toBN('-22222'))
        })

        it('should decrease total supply', async function() {
            const oldSupply = await ctx.blend.totalSupply()
            await ctx.blend.burn(alice, toBN('22222'), { from: owner })
            const newSupply = await ctx.blend.totalSupply()
            const supplyDelta = newSupply.sub(oldSupply)
            expect(supplyDelta).to.be.bignumber.equal(toBN('-22222'))
        })

        it('should not burn more than available', async function() {
            await ctx.blend.transfer(bob, toBN('22222'), { from: alice })
            await expectRevert(
                ctx.blend.burn(toBN('22223'), { from: bob }),
                "Boom"
            )
        })
    })

    describe('mint', async function() {
        it('should increase the balance of beneficiary', async function() {
            await ctx.blend.transfer(bob, toBN('22222'), { from: alice })
            await ctx.blend.mint(bob, toBN('22222'), { from: owner })
            const newBalance = await ctx.blend.balanceOf(bob)
            expect(newBalance).to.be.bignumber.equal(toBN('44444'))
        })

        it('should increase total supply', async function() {
            const oldSupply = await ctx.blend.totalSupply()
            await ctx.blend.mint(bob, toBN('22222'), { from: owner })
            const newSupply = await ctx.blend.totalSupply()
            const supplyDelta = newSupply.sub(oldSupply)
            expect(supplyDelta).to.be.bignumber.equal(toBN('22222'))
        })

        it('should reject minting if called by a non-owner', async function() {
            await
            await expectRevert(
                ctx.blend.mint(alice, toBN('22222'), { from: alice }),
                "Boom"
            )
        })
    })
})
