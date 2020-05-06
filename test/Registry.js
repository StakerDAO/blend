const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, constants } = require('@openzeppelin/test-helpers')
const { expect } = require('chai').use(require('chai-bn')(BN))
const { toBN } = web3.utils
const Registry = contract.fromArtifact('Registry')


describe('Registry', async function() {
    const ctx = {}
    const [owner, blend, registryBackend, alice, bob, evil] = accounts

    beforeEach(async function() {
        ctx.registry = await Registry.new({ from: owner })
        const initialize = ctx.registry.methods['initialize(address,address)']
        await initialize(blend, registryBackend, { from: owner })
    })

    describe('Setting backend address', async function() {
        it('Allows owner to change registry backend', async function() {
            await ctx.registry.setRegistryBackend(bob, {from: owner})
            const newBackend = await ctx.registry.registryBackend()
            expect(newBackend).to.equal(bob)
        })

        it('Prohibits someone else to change the backend', async function() {
            await expectRevert(
                ctx.registry.setRegistryBackend(bob, {from: registryBackend}),
                'Ownable: caller is not the owner'
            )
        })
    })

    describe('Tender address registration', async function() {
        it('Registers an address if called by a registry backend', async function() {
            await ctx.registry.registerTenderAddress.sendTransaction(
                alice, {from: registryBackend}
            )
            expect(
                await ctx.registry.isTenderAddress.call(alice)
            ).to.equal(
                true,
                'Tender address was not registered'
            )
        })

        it('Fails if called from arbitrary address', async function() {
            await expectRevert(
                ctx.registry.registerTenderAddress.sendTransaction(
                    alice, { from: evil }
                ),
                'Unauthorized: sender is not a registry backend'
            )
        })

        it('Fails if called by owner', async function() {
            await expectRevert(
                ctx.registry.registerTenderAddress
                            .sendTransaction(alice, { from: owner }),
                'Unauthorized: sender is not a registry backend'
            )
        })

        it('Fails if called twice', async function() {
            await ctx.registry.registerTenderAddress.sendTransaction(
                alice, { from: registryBackend }
            )
            await expectRevert(
                ctx.registry.registerTenderAddress.sendTransaction(
                    alice, { from: registryBackend }
                ),
                'Tender address already registered'
            )
        })

        it('isTenderAddress returns false for an unregistered address', async function() {
            expect(
                await ctx.registry.isTenderAddress.call(alice)
            ).to.equal(
                false,
                `Expected ${alice} to be NOT registered as a tender address ` +
                `but isTenderAddress returned true`
            )
        })
    })

    describe('recordTransfer', async function() {
        const wallet = alice
        const tenderAddress = bob

        it('Updates the internal balances upon calling recordTransfer', async function() {
            const amount = web3.utils.toBN('100000')
            await ctx.registry.registerTenderAddress.sendTransaction(
                tenderAddress, { from: registryBackend }
            )
            await ctx.registry.recordTransfer.sendTransaction(
                wallet, tenderAddress, amount, { from: blend }
            )
            const locked = await ctx.registry.getLockedAmount(tenderAddress, wallet)
            expect(
                locked
            ).to.be.bignumber.equal(
                amount,
                `Expected to have ${amount} tokens locked, got ${locked}`
            )
        })

        it('Adds the amount if called several times', async function() {
            await ctx.registry.registerTenderAddress.sendTransaction(
                tenderAddress, { from: registryBackend }
            )
            for (let i = 0; i < 5; i++) {
                await ctx.registry.recordTransfer.sendTransaction(
                    wallet, tenderAddress, web3.utils.toBN('5000000'), { from: blend }
                )
            }
            const locked = await ctx.registry.getLockedAmount(tenderAddress, wallet)
            const expected = web3.utils.toBN('25000000')
            expect(
                locked
            ).to.be.bignumber.equal(
                expected,
                `Expected to have ${expected} tokens locked, got ${locked}`
            )
        })

        it('Fails on overflow', async function() {
            await ctx.registry.registerTenderAddress.sendTransaction(
                tenderAddress, { from: registryBackend }
            )
            await ctx.registry.recordTransfer.sendTransaction(
                wallet, tenderAddress, constants.MAX_UINT256, { from: blend }
            )
            await expectRevert(
                ctx.registry.recordTransfer.sendTransaction(
                    wallet, tenderAddress, 1, { from: blend }
                ),
                'SafeMath: addition overflow'
            )
        })

        it('Fails if tender address is not registered', async function() {
            await expectRevert(
                ctx.registry.recordTransfer.sendTransaction(
                    wallet, tenderAddress, constants.MAX_UINT256, { from: blend }
                ),
                'Tender address is not registered'
            )
        })

        it('Fails if called not by Blend', async function() {
            await ctx.registry.registerTenderAddress.sendTransaction(
                tenderAddress, { from: registryBackend }
            )
            await expectRevert(
                ctx.registry.recordTransfer.sendTransaction(
                    wallet, tenderAddress, constants.MAX_UINT256, { from: evil }
                ),
                'Unauthorized: sender is not a Blend token contract'
            )
        })
    })

    describe('recordUnlock', async function() {
        const wallet = alice
        const tenderAddress = bob
        const initialAmount = web3.utils.toBN('100000')

        async function registerAndLock() {
            await ctx.registry.registerTenderAddress.sendTransaction(
                tenderAddress, { from: registryBackend }
            )
            await ctx.registry.recordTransfer.sendTransaction(
                wallet, tenderAddress, initialAmount, { from: blend }
            )
        }

        it('Subtracts the locked amount several times', async function() {
            await registerAndLock()
            // Subtract 33333 three times = 99999 total
            for (let i = 0; i < 3; i++) {
                await ctx.registry.recordUnlock.sendTransaction(
                    tenderAddress, wallet, web3.utils.toBN('33333'), { from: blend }
                )
            }
            const locked = await ctx.registry.getLockedAmount(tenderAddress, wallet)
            const expected = web3.utils.toBN('1')
            expect(
                locked
            ).to.be.bignumber.equal(
                expected,
                `Expected to have ${expected} tokens locked, got ${locked}`
            )
        })

        it('Allows to unlock all tokens', async function() {
            await registerAndLock()
            await ctx.registry.recordUnlock.sendTransaction(
                tenderAddress, wallet, web3.utils.toBN('100000'), { from: blend }
            )
            const locked = await ctx.registry.getLockedAmount(tenderAddress, wallet)
            const expected = web3.utils.toBN('0')
            expect(
                locked
            ).to.be.bignumber.equal(
                expected,
                `Expected to have ${expected} tokens locked, got ${locked}`
            )
        })

        it('Fails if tender address is not registered', async function() {
            // Accroding to the contract logic, this can never happen because
            // you can't lock funds into a non-registered tender address, and
            // it is not possible to UNregister a tender address. However, we
            // leave this check here and in the contract in case the contract
            // logic changes during an upgrade.
            await expectRevert(
                ctx.registry.recordUnlock.sendTransaction(
                    tenderAddress, wallet, web3.utils.toBN('1'), { from: blend }
                ),
                'Tender address is not registered'
            )
        })

        it('Fails if called not by Blend', async function() {
            await registerAndLock()
            await expectRevert(
                ctx.registry.recordUnlock.sendTransaction(
                    tenderAddress, wallet, web3.utils.toBN('99999'), { from: evil }
                ),
                'Unauthorized: sender is not a Blend token contract'
            )
        })

        it('Fails if not enough locked tokens', async function() {
            await registerAndLock()
            await expectRevert(
                ctx.registry.recordUnlock.sendTransaction(
                    tenderAddress, wallet, web3.utils.toBN('100001'), { from: blend }
                ),
                'Insufficient locked amount'
            )
        })
    })
})
