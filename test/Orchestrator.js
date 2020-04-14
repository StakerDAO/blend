const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, constants } = require('@openzeppelin/test-helpers')
const { expect } = require('chai').use(require('chai-bn')(BN))
const { toBN } = web3.utils
const BlendToken = contract.fromArtifact('BlendToken')
const Orchestrator = contract.fromArtifact('Orchestrator')
const Registry = contract.fromArtifact('Registry')
const ERC20Stub = contract.fromArtifact('ERC20Stub')


describe('Orchestrator', async function() {
    const ctx = {}
    const [
        alice, owner, usdcPool, distributionBackend,
        someone, registryBackend, tenderAddress
    ] = accounts

    beforeEach(async function() {
        ctx.registry = await Registry.new({ from: owner })
        ctx.blend = await BlendToken.new({ from: owner })
        ctx.usdcToken = await ERC20Stub.new({ from: owner })
        ctx.orchestrator = await Orchestrator.new(
            distributionBackend,
            ctx.blend.address,
            ctx.registry.address,
            usdcPool,
            ctx.usdcToken.address,
            { from: owner }
        )
        const initializeBlend =
            ctx.blend.methods['initialize(address,uint256,address,address)']

        const initializeRegistry =
            ctx.registry.methods['initialize(address,address)']

        const initializeUsdc =
            ctx.usdcToken.methods['initialize(address,uint256)']
        await initializeUsdc(usdcPool, toBN('100000000'))

        await initializeBlend(
            alice,
            toBN('100000'),
            ctx.registry.address,
            ctx.orchestrator.address,
            { from: owner }
        )

        await initializeRegistry(
            ctx.blend.address,
            registryBackend,
            { from: owner }
        )
    })

    it('allows owner to set a USDC pool', async function() {
        await ctx.orchestrator.setUsdcPool(someone, {from: owner})
        const newPool = await ctx.orchestrator.usdcPool()
        expect(newPool).to.equal(someone)
    })

    it('prohibits non-owner to set a USDC pool', async function() {
        await expectRevert(
            ctx.orchestrator.setUsdcPool(someone, {from: someone}),
            'Ownable: caller is not the owner'
        )
    })

    it('allows owner to rotate distribution backend key', async function() {
        await ctx.orchestrator.setDistributionBackend(someone, {from: owner})
        const newBackend = await ctx.orchestrator.distributionBackend()
        expect(newBackend).to.equal(someone)
    })

    it('prohibits non-owner to rotate distribution backend key', async function() {
        await expectRevert(
            ctx.orchestrator.setDistributionBackend(someone, {from: someone}),
            'Ownable: caller is not the owner'
        )
    })

    it('allows backend to start distribution', async function() {
        await ctx.orchestrator.startDistribution({from: distributionBackend})
        expect(await ctx.blend.distributionPhase()).to.equal(true)
    })

    it('prohibits non-backend to start distribution', async function() {
        await expectRevert(
            ctx.orchestrator.startDistribution({from: owner}),
            'Unauthorized: sender is not a distribution backend'
        )
    })

    it('allows backend to stop distribution', async function() {
        await ctx.orchestrator.startDistribution({from: distributionBackend})
        await ctx.orchestrator.stopDistribution({from: distributionBackend})
        expect(await ctx.blend.distributionPhase()).to.equal(false)
    })

    it('prohibits non-backend to stop distribution', async function() {
        await ctx.orchestrator.startDistribution({from: distributionBackend})
        await expectRevert(
            ctx.orchestrator.startDistribution({from: owner}),
            'Unauthorized: sender is not a distribution backend'
        )
    })

    describe('distribution', async function() {
        function scalePrice(price, decimals = '4') {
            const scaleFactor = toBN('10').pow(toBN(decimals))
            return toBN(price).mul(scaleFactor)
        }

        beforeEach(async function() {
            await ctx.registry.registerTenderAddress(tenderAddress, {from: registryBackend})
            await ctx.blend.transfer(tenderAddress, toBN('100'), {from: alice})
            await ctx.usdcToken.approve(ctx.orchestrator.address, toBN('1000'), {from: usdcPool})
            await ctx.orchestrator.startDistribution({from: distributionBackend})
        })

        it('executes a full order', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: scalePrice(2, 4).toString(),
                    amount: 100
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('200'))
            expect(tenderBlendBalance).to.be.bignumber.equal(toBN('0'))
        })

        it('executes a partial order bound by USDC', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: scalePrice(100, 4).toString(),
                    amount: 100
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('1000'))
            expect(tenderBlendBalance).to.be.bignumber.equal(toBN('90'))
        })

        it('executes a partial order bound by BLEND', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: scalePrice(1000, 0).toString(),
                    amount: 150
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('10'))
            expect(tenderBlendBalance).to.be.bignumber.equal(toBN('0'))
        })

        it('rounds BLEND amount up', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: scalePrice(333, 4).toString(),
                    amount: 150
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            const blendDelta = toBN('100').sub(tenderBlendBalance)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('1000'))
            expect(blendDelta).to.be.bignumber.equal(toBN('4'))
        })

        it('executes two orders: full & partial', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: scalePrice(2, 4).toString(),
                    amount: 50
                },
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: scalePrice(100, 4).toString(),
                    amount: 100
                },
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: scalePrice(100, 4).toString(),
                    amount: 100
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('1000'))
            expect(tenderBlendBalance).to.be.bignumber.equal(toBN('41'))
        })
    })
})
