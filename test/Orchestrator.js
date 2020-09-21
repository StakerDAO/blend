const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { expectRevert, BN, constants } = require('@openzeppelin/test-helpers')
const { expect } = require('chai').use(require('chai-bn')(BN))
const { toBN } = web3.utils
const { priceToBN } = require('./common/price')
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
                    price: priceToBN('2').toString(),
                    amount: 100
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('200'))
            expect(tenderBlendBalance).to.be.bignumber.equal(toBN('0'))
        })

        it('fails on order bound by USDC', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: priceToBN('100').toString(),
                    amount: 100
                }
            ]
            await expectRevert(
                ctx.orchestrator.executeOrders(orders, {from: distributionBackend}),
                'ERC20: transfer amount exceeds allowance'
            )
        })

        it('fails on order bound by BLND', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: priceToBN('0.1').toString(),
                    amount: 150
                }
            ]
            await expectRevert(
                ctx.orchestrator.executeOrders(orders, {from: distributionBackend}),
                'Not enough balance on tender address'
            )
        })

        it('rounds USDC amount down', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: priceToBN('333.3333').toString(),
                    amount: 3
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            const blendDelta = toBN('100').sub(tenderBlendBalance)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('999'))
            expect(blendDelta).to.be.bignumber.equal(toBN('3'))
        })

        it('executes three orders', async function() {
            const orders = [
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: priceToBN('2').toString(),
                    amount: 10
                },
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: priceToBN('10').toString(),
                    amount: 80
                },
                {
                    redeemerTenderAddress: tenderAddress,
                    redeemerWallet: alice,
                    price: priceToBN('20').toString(),
                    amount: 9
                }
            ]
            await ctx.orchestrator.executeOrders(orders, {from: distributionBackend})
            const aliceUsdcBalance = await ctx.usdcToken.balanceOf(alice)
            const tenderBlendBalance = await ctx.blend.balanceOf(tenderAddress)
            expect(aliceUsdcBalance).to.be.bignumber.equal(toBN('1000'))
            expect(tenderBlendBalance).to.be.bignumber.equal(toBN('1'))
        })
    })
})
